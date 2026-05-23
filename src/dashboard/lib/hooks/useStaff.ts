/**
 * @fileType hook
 * @domain kody
 * @pattern staff-control-hooks
 * @ai-summary React Query hooks for the Staff Control page.
 *   Backed by `.kody/staff/<slug>.md` files in the connected repo via
 *   the contents API. Duplicated from useDuties.ts.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Staff,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const staffQueryKeys = {
  list: ["kody-staff"] as const,
  detail: (slug: string) => ["kody-staff-member", slug] as const,
};

export function useStaff() {
  return useQuery({
    queryKey: staffQueryKeys.list,
    queryFn: () => kodyApi.staff.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useStaffMember(slug: string | null) {
  return useQuery({
    queryKey: staffQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.staff.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateStaff(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Staff,
    Error,
    {
      slug?: string;
      title: string;
      body: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.staff.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list });
      toast.success("Staff member created");
    },
    onError: (error) => {
      toast.error("Failed to create staff member", {
        description: error.message,
      });
    },
  });
}

export function useUpdateStaff(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Staff,
    Error,
    {
      title?: string;
      body?: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.staff.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (staffMember) => {
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list });
      queryClient.setQueryData(staffQueryKeys.detail(slug), staffMember);
      toast.success("Staff member updated");
    },
    onError: (error) => {
      toast.error("Failed to update staff member", {
        description: error.message,
      });
    },
  });
}

export function useDeleteStaff(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.staff.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list });
      queryClient.removeQueries({ queryKey: staffQueryKeys.detail(slug) });
      toast.success("Staff member deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete staff member", {
        description: error.message,
      });
    },
  });
}

/**
 * Dispatch an ad-hoc message to a staff member — runs the persona one-shot
 * (like a duty) and replies on the control issue. When `actorLogin` is set,
 * the reply @-mentions the requester so it lands in their inbox.
 */
export function useDispatchStaff(actorLogin?: string) {
  return useMutation<
    { issueNumber: number; commentId: number; commentUrl: string },
    Error,
    { slug: string; message: string }
  >({
    mutationFn: ({ slug, message }) =>
      kodyApi.staff.dispatch(slug, {
        message,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      toast.success("Task sent", {
        description:
          "The staff member is running it now — the reply will appear on the control issue" +
          (actorLogin ? " and in your inbox." : "."),
      });
    },
    onError: (error) => {
      toast.error("Failed to send task", { description: error.message });
    },
  });
}
