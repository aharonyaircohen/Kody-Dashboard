/**
 * @fileType hook
 * @domain kody
 * @pattern job-control-hooks
 * @ai-summary React Query hooks for the Job Control page.
 *   Backed by `.kody/jobs/<slug>.md` files in the connected repo via the
 *   contents API; jobs are no longer GitHub issues.
 */
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  kodyApi,
  type Job,
  type JobSchedule,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from '../api'

export const jobQueryKeys = {
  list: ['kody-jobs'] as const,
  detail: (slug: string) => ['kody-job', slug] as const,
}

export function useJobs() {
  return useQuery({
    queryKey: jobQueryKeys.list,
    queryFn: () => kodyApi.jobs.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false
      if (error instanceof NoTokenError) return false
      return failureCount < 2
    },
  })
}

export function useJob(slug: string | null) {
  return useQuery({
    queryKey: jobQueryKeys.detail(slug ?? ''),
    queryFn: () => kodyApi.jobs.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  })
}

export function useCreateJob(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<
    Job,
    Error,
    { slug?: string; title: string; body: string; schedule?: JobSchedule | null }
  >({
    mutationFn: (data) =>
      kodyApi.jobs.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobQueryKeys.list })
      toast.success('Job created')
    },
    onError: (error) => {
      toast.error('Failed to create job', { description: error.message })
    },
  })
}

export function useUpdateJob(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<
    Job,
    Error,
    { title?: string; body?: string; schedule?: JobSchedule | null }
  >({
    mutationFn: (data) =>
      kodyApi.jobs.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: jobQueryKeys.list })
      queryClient.setQueryData(jobQueryKeys.detail(slug), job)
      toast.success('Job updated')
    },
    onError: (error) => {
      toast.error('Failed to update job', { description: error.message })
    },
  })
}

export function useRunJob() {
  return useMutation<
    { sessionId: string; workflowId: string },
    Error,
    { slug: string; title: string; body: string }
  >({
    mutationFn: (job) => kodyApi.jobs.run(job),
    onSuccess: () => {
      toast.success('Job dispatched to kody engine')
    },
    onError: (error) => {
      toast.error('Failed to dispatch job', { description: error.message })
    },
  })
}

export function useDeleteJob(actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.jobs.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: jobQueryKeys.list })
      queryClient.removeQueries({ queryKey: jobQueryKeys.detail(slug) })
      toast.success('Job deleted')
    },
    onError: (error) => {
      toast.error('Failed to delete job', { description: error.message })
    },
  })
}
