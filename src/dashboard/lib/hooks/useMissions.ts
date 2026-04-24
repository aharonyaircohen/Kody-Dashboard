/**
 * @fileType hook
 * @domain kody
 * @pattern mission-control-hooks
 * @ai-summary React Query hooks for the Mission Control page.
 *   Mirrors the useTaskActions shape: query + mutate + invalidate.
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
  detail: (number: number) => ['kody-mission', number] as const,
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

export function useMission(number: number | null) {
  return useQuery({
    queryKey: missionQueryKeys.detail(number ?? -1),
    queryFn: () => kodyApi.missions.get(number!),
    enabled: !!getStoredAuth() && !!number,
    staleTime: 30_000,
  })
}

export function useCreateMission(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<Mission, Error, { title: string; body: string }>({
    mutationFn: (data) =>
      kodyApi.missions.create({
        title: data.title,
        body: data.body,
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

export function useUpdateMission(number: number, actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<Mission, Error, { title?: string; body?: string }>({
    mutationFn: (data) =>
      kodyApi.missions.update(number, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: missionQueryKeys.list })
      queryClient.setQueryData(missionQueryKeys.detail(number), mission)
      toast.success('Mission updated')
    },
    onError: (error) => {
      toast.error('Failed to update mission', { description: error.message })
    },
  })
}

export function useDeleteMission(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, number>({
    mutationFn: (number) => kodyApi.missions.remove(number, actorLogin),
    onSuccess: (_, number) => {
      queryClient.invalidateQueries({ queryKey: missionQueryKeys.list })
      queryClient.removeQueries({ queryKey: missionQueryKeys.detail(number) })
      toast.success('Mission closed')
    },
    onError: (error) => {
      toast.error('Failed to close mission', { description: error.message })
    },
  })
}
