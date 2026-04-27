/**
 * @fileType hook
 * @domain kody
 * @pattern mission-control-hooks
 * @ai-summary React Query hooks for the Mission Control page.
 *   Backed by `.kody/missions/<slug>.md` files in the connected repo via the
 *   contents API; missions are no longer GitHub issues.
 */
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  kodyApi,
  type Mission,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from '../api'

export const missionQueryKeys = {
  list: ['kody-missions'] as const,
  detail: (slug: string) => ['kody-mission', slug] as const,
}

export function useMissions() {
  return useQuery({
    queryKey: missionQueryKeys.list,
    queryFn: () => kodyApi.missions.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false
      if (error instanceof NoTokenError) return false
      return failureCount < 2
    },
  })
}

export function useMission(slug: string | null) {
  return useQuery({
    queryKey: missionQueryKeys.detail(slug ?? ''),
    queryFn: () => kodyApi.missions.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  })
}

export function useCreateMission(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<Mission, Error, { slug?: string; title: string; body: string }>({
    mutationFn: (data) =>
      kodyApi.missions.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: missionQueryKeys.list })
      toast.success('Mission created')
    },
    onError: (error) => {
      toast.error('Failed to create mission', { description: error.message })
    },
  })
}

export function useUpdateMission(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<Mission, Error, { title?: string; body?: string }>({
    mutationFn: (data) =>
      kodyApi.missions.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: missionQueryKeys.list })
      queryClient.setQueryData(missionQueryKeys.detail(slug), mission)
      toast.success('Mission updated')
    },
    onError: (error) => {
      toast.error('Failed to update mission', { description: error.message })
    },
  })
}

export function useRunMission() {
  return useMutation<
    { sessionId: string; workflowId: string },
    Error,
    { slug: string; title: string; body: string }
  >({
    mutationFn: (mission) => kodyApi.missions.run(mission),
    onSuccess: () => {
      toast.success('Mission dispatched to kody engine')
    },
    onError: (error) => {
      toast.error('Failed to dispatch mission', { description: error.message })
    },
  })
}

export function useDeleteMission(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.missions.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: missionQueryKeys.list })
      queryClient.removeQueries({ queryKey: missionQueryKeys.detail(slug) })
      toast.success('Mission deleted')
    },
    onError: (error) => {
      toast.error('Failed to delete mission', { description: error.message })
    },
  })
}
