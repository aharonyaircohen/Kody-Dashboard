/**
 * @fileType hook
 * @domain kody
 * @pattern goals-hooks
 * @ai-summary React Query hooks for the Goals feature. Mirrors useMissions:
 *   list query + create/update/delete mutations.
 */
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  kodyApi,
  type Goal,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from '../api'

export const goalQueryKeys = {
  list: ['kody-goals'] as const,
}

export function useGoals() {
  return useQuery({
    queryKey: goalQueryKeys.list,
    queryFn: () => kodyApi.goals.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false
      if (error instanceof NoTokenError) return false
      return failureCount < 2
    },
  })
}

export function useCreateGoal(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<
    Goal,
    Error,
    { name: string; description?: string; dueDate?: string }
  >({
    mutationFn: (data) =>
      kodyApi.goals.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (created) => {
      // Insert the new goal directly so it appears instantly, regardless of
      // GitHub eventual consistency or any downstream cache. The invalidation
      // below schedules a background refetch to reconcile.
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) => {
        if (!prev) return [created]
        if (prev.some((g) => g.id === created.id)) return prev
        return [...prev, created]
      })
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list })
      toast.success('Goal created')
    },
    onError: (error) => {
      toast.error('Failed to create goal', { description: error.message })
    },
  })
}

export function useUpdateGoal(id: string, actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<
    Goal,
    Error,
    { name?: string; description?: string | null; dueDate?: string | null }
  >({
    mutationFn: (data) =>
      kodyApi.goals.update(id, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) =>
        prev ? prev.map((g) => (g.id === updated.id ? updated : g)) : prev,
      )
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list })
      toast.success('Goal updated')
    },
    onError: (error) => {
      toast.error('Failed to update goal', { description: error.message })
    },
  })
}

export function useDeleteGoal(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: (id) => kodyApi.goals.remove(id, actorLogin),
    onSuccess: (_, removedId) => {
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) =>
        prev ? prev.filter((g) => g.id !== removedId) : prev,
      )
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list })
      toast.success('Goal removed')
    },
    onError: (error) => {
      toast.error('Failed to remove goal', { description: error.message })
    },
  })
}
