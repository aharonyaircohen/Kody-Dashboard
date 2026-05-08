/**
 * @fileType component
 * @domain kody
 * @pattern page-shell
 * @ai-summary Default page shell for secondary dashboard routes
 *   (reports, notifications, secrets, scenario, …). Always pairs the
 *   page content with KodyChat:
 *     - Desktop (md+): a fixed 400px left rail hosts the chat next to
 *       the page content.
 *     - Mobile (<md): chat is hidden by default and accessible through a
 *       floating action button that opens a right-side Sheet.
 *
 *   The chat is "global" by default (no `context`) — pages may pass a
 *   `chatContext` prop later if they want to scope the assistant to a
 *   specific resource (e.g. a selected report).
 *
 *   Pages with their own custom chat layout (e.g. JobControl, KodyDashboard)
 *   should NOT use this shell — they integrate KodyChat themselves.
 */
'use client'

import { useState, type ReactNode } from 'react'
import { MessageSquare, X as XIcon } from 'lucide-react'
import { Button } from '@dashboard/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@dashboard/ui/sheet'
import { KodyChat } from './KodyChat'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import type { ChatContext } from '../chat-types'
import { cn } from '../utils'

interface PageWithChatProps {
  children: ReactNode
  /** Optional scoped context for the chat. Defaults to global chat. */
  chatContext?: ChatContext | null
  /** Override left-rail width on desktop. Default 400px. */
  railWidthClass?: string
}

export function PageWithChat({
  children,
  chatContext = null,
  railWidthClass = 'w-[400px]',
}: PageWithChatProps) {
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const { githubUser } = useGitHubIdentity()

  return (
    <>
      <div className="h-screen flex overflow-hidden bg-background text-foreground">
        {/* Desktop left rail — hidden below md. */}
        <aside
          className={cn(
            'hidden md:flex flex-col shrink-0 border-r border-border bg-black/20',
            railWidthClass,
          )}
          aria-label="Kody chat"
        >
          <KodyChat context={chatContext} actorLogin={githubUser?.login} />
        </aside>

        {/* Page content fills the remaining width. Children are expected
            to use h-full / min-h-0 / overflow-y-auto as needed. */}
        <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
          {children}
        </div>
      </div>

      {/* Mobile floating chat trigger — only renders below md. */}
      <Button
        type="button"
        size="icon"
        onClick={() => setMobileChatOpen(true)}
        className={cn(
          'md:hidden fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg',
          'bg-emerald-600 hover:bg-emerald-700 text-white',
        )}
        aria-label="Open chat"
      >
        <MessageSquare className="w-5 h-5" />
      </Button>

      <Sheet open={mobileChatOpen} onOpenChange={setMobileChatOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-sm font-semibold">Chat</SheetTitle>
            <button
              type="button"
              onClick={() => setMobileChatOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close chat"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {mobileChatOpen ? (
              <KodyChat
                context={chatContext}
                actorLogin={githubUser?.login}
                onClose={() => setMobileChatOpen(false)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
