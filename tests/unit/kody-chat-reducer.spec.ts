/**
 * Unit tests for the Kody Live session reducer. The reducer is the single
 * owner of session-lifecycle truth — every UI bug in the audit
 * (stuck-on-thinking, lost session on issue switch, etc.) was a missed
 * mutation in one of the old fragmented setters. These tests pin the
 * transition table so that regressions surface immediately instead of
 * silently re-introducing stuck-state hazards.
 */
import { describe, it, expect } from 'vitest'

import {
  liveReducer,
  initialLiveState,
  isComposerLocked,
  isAwaitingReply,
  isRecoverable,
  isWatchdogActive,
  type LiveSessionState,
} from '@dashboard/lib/components/kody-chat-reducer'

const withState = (
  patch: Partial<LiveSessionState>,
): LiveSessionState => ({ ...initialLiveState, ...patch })

describe('liveReducer', () => {
  describe('START', () => {
    it('goes idle → booting and pins the session id + boot timestamp', () => {
      const next = liveReducer(initialLiveState, {
        type: 'START',
        sessionId: 'vibe-42-abc',
        scopeKey: 'vibe-42',
        startedAt: 1000,
      })
      expect(next.phase).toBe('booting')
      expect(next.sessionId).toBe('vibe-42-abc')
      expect(next.scopeKey).toBe('vibe-42')
      expect(next.bootStartedAt).toBe(1000)
      expect(next.lastEventAt).toBe(1000)
      expect(next.errorMessage).toBeNull()
    })

    it('wipes a leftover error from a previous attempt', () => {
      const prev = withState({ phase: 'error', errorMessage: 'old' })
      const next = liveReducer(prev, {
        type: 'START',
        sessionId: 's',
        scopeKey: 'global',
        startedAt: 2000,
      })
      expect(next.phase).toBe('booting')
      expect(next.errorMessage).toBeNull()
    })
  })

  describe('RUNNER_READY', () => {
    it('clears bootStartedAt and lands in ready', () => {
      const prev = withState({
        phase: 'booting',
        sessionId: 's',
        bootStartedAt: 5,
      })
      const next = liveReducer(prev, {
        type: 'RUNNER_READY',
        runUrl: 'https://github.com/o/r/actions/runs/1',
      })
      expect(next.phase).toBe('ready')
      expect(next.bootStartedAt).toBeNull()
      expect(next.runUrl).toBe('https://github.com/o/r/actions/runs/1')
    })

    it('does not yank an awaiting turn back to ready (engine re-fires ready mid-turn)', () => {
      const prev = withState({ phase: 'awaiting', sessionId: 's' })
      const next = liveReducer(prev, { type: 'RUNNER_READY' })
      expect(next.phase).toBe('awaiting')
    })
  })

  describe('MESSAGE_RECEIVED — hazard D', () => {
    it('flips awaiting → ready so the typing indicator can not outlive the reply', () => {
      const prev = withState({ phase: 'awaiting', sessionId: 's' })
      const next = liveReducer(prev, { type: 'MESSAGE_RECEIVED' })
      expect(next.phase).toBe('ready')
      expect(next.lastEventAt).not.toBeNull()
    })

    it('bumps lastEventAt even when not in awaiting (still proves runner is alive)', () => {
      const prev = withState({
        phase: 'ready',
        sessionId: 's',
        lastEventAt: 100,
      })
      const next = liveReducer(prev, { type: 'MESSAGE_RECEIVED' })
      expect(next.phase).toBe('ready')
      expect(next.lastEventAt).toBeGreaterThan(100)
    })
  })

  describe('RUNNER_EXIT', () => {
    it('clears the session id and lands in ended', () => {
      const prev = withState({ phase: 'ready', sessionId: 's' })
      const next = liveReducer(prev, { type: 'RUNNER_EXIT' })
      expect(next.phase).toBe('ended')
      expect(next.sessionId).toBeNull()
    })
  })

  describe('TURN_SENT', () => {
    it('promotes ready → awaiting', () => {
      const prev = withState({ phase: 'ready', sessionId: 's' })
      const next = liveReducer(prev, { type: 'TURN_SENT' })
      expect(next.phase).toBe('awaiting')
    })

    it('does not overwrite ended (clicking send after exit is a no-op until restart)', () => {
      const prev = withState({ phase: 'ended', sessionId: null })
      const next = liveReducer(prev, { type: 'TURN_SENT' })
      expect(next.phase).toBe('ended')
    })
  })

  describe('REHYDRATE — scope changes (hazard C)', () => {
    it('switching to a scope with no saved session resets to idle for that scope', () => {
      const prev = withState({
        phase: 'ready',
        sessionId: 'old-session',
        scopeKey: 'vibe-1',
      })
      const next = liveReducer(prev, {
        type: 'REHYDRATE_IDLE',
        scopeKey: 'vibe-2',
      })
      expect(next.phase).toBe('idle')
      expect(next.sessionId).toBeNull()
      expect(next.scopeKey).toBe('vibe-2')
      // No partial state leaks from the previous scope.
      expect(next.target).toBeNull()
      expect(next.runUrl).toBeNull()
    })

    it('restores a saved booting session for a scope', () => {
      const next = liveReducer(initialLiveState, {
        type: 'REHYDRATE_RESTORED',
        scopeKey: 'vibe-7',
        sessionId: 'vibe-7-xyz',
        phase: 'booting',
        bootStartedAt: 12345,
        target: { owner: 'o', repo: 'r' },
        runUrl: null,
      })
      expect(next.phase).toBe('booting')
      expect(next.sessionId).toBe('vibe-7-xyz')
      expect(next.target).toEqual({ owner: 'o', repo: 'r' })
    })
  })

  describe('KICKOFF queue (Vibe auto-execute)', () => {
    it('queues a kickoff with the target issue number', () => {
      const next = liveReducer(initialLiveState, {
        type: 'KICKOFF_QUEUED',
        content: 'Implement #99 now',
        issueNumber: 99,
      })
      expect(next.pendingKickoff).toEqual({
        content: 'Implement #99 now',
        issueNumber: 99,
      })
    })

    it('clears the queue on KICKOFF_FIRED', () => {
      const prev = withState({
        pendingKickoff: { content: 'x', issueNumber: 1 },
      })
      const next = liveReducer(prev, { type: 'KICKOFF_FIRED' })
      expect(next.pendingKickoff).toBeNull()
    })
  })

  describe('STATUS_RESULT — watchdog reconciliation', () => {
    it('flips an active phase to stuck when the server reports the runner is gone', () => {
      const prev = withState({ phase: 'awaiting', sessionId: 's' })
      const next = liveReducer(prev, {
        type: 'STATUS_RESULT',
        runnerAlive: false,
        lastEventAt: null,
        errorMessage: 'last event 200s ago',
      })
      expect(next.phase).toBe('stuck')
      expect(next.errorMessage).toBe('last event 200s ago')
    })

    it('does NOT override an already-terminal phase (avoids racing END/EXIT)', () => {
      const prev = withState({ phase: 'ended' })
      const next = liveReducer(prev, {
        type: 'STATUS_RESULT',
        runnerAlive: false,
        lastEventAt: null,
      })
      expect(next.phase).toBe('ended')
    })

    it('uses server lastEventAt when present (alive case)', () => {
      const prev = withState({
        phase: 'ready',
        sessionId: 's',
        lastEventAt: 100,
      })
      const next = liveReducer(prev, {
        type: 'STATUS_RESULT',
        runnerAlive: true,
        lastEventAt: 200,
      })
      expect(next.phase).toBe('ready')
      expect(next.lastEventAt).toBe(200)
    })

    it('bumps lastEventAt to Date.now() when server reports alive but no events', () => {
      // Critical for re-firing the watchdog after a false-alarm check —
      // without this bump, the effect dependency list doesn't change and
      // the watchdog stays silent for the rest of the session.
      const start = Date.now()
      const prev = withState({
        phase: 'awaiting',
        sessionId: 's',
        lastEventAt: 100,
      })
      const next = liveReducer(prev, {
        type: 'STATUS_RESULT',
        runnerAlive: true,
        lastEventAt: null,
      })
      expect(next.lastEventAt).toBeGreaterThanOrEqual(start)
    })
  })

  describe('FORCE_RESET / END', () => {
    it('resets state but preserves the current scope', () => {
      const prev = withState({
        phase: 'stuck',
        sessionId: 'zombie',
        scopeKey: 'vibe-42',
        errorMessage: 'gone',
      })
      const next = liveReducer(prev, { type: 'FORCE_RESET' })
      expect(next).toEqual({ ...initialLiveState, scopeKey: 'vibe-42' })
    })
  })
})

describe('liveReducer selectors', () => {
  it('isComposerLocked is true for every non-ready phase', () => {
    expect(isComposerLocked('idle')).toBe(true)
    expect(isComposerLocked('booting')).toBe(true)
    expect(isComposerLocked('ready')).toBe(false)
    expect(isComposerLocked('awaiting')).toBe(true)
    expect(isComposerLocked('ended')).toBe(true)
    expect(isComposerLocked('error')).toBe(true)
    expect(isComposerLocked('stuck')).toBe(true)
  })

  it('isAwaitingReply covers booting + awaiting', () => {
    expect(isAwaitingReply('booting')).toBe(true)
    expect(isAwaitingReply('awaiting')).toBe(true)
    expect(isAwaitingReply('ready')).toBe(false)
  })

  it('isRecoverable surfaces stuck/error/ended (where a Restart button is useful)', () => {
    expect(isRecoverable('stuck')).toBe(true)
    expect(isRecoverable('error')).toBe(true)
    expect(isRecoverable('ended')).toBe(true)
    expect(isRecoverable('ready')).toBe(false)
  })

  it('isWatchdogActive only fires for booting + awaiting (active waiting phases)', () => {
    expect(isWatchdogActive('booting')).toBe(true)
    expect(isWatchdogActive('awaiting')).toBe(true)
    expect(isWatchdogActive('ready')).toBe(false)
    expect(isWatchdogActive('idle')).toBe(false)
  })
})
