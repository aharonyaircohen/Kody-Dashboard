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
import { useAuth } from "../auth-context";

export interface StaffQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function staffQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): StaffQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const staffQueryKeys = {
  all: ["kody-staff"] as const,
  list: (scope: StaffQueryScope = {}) =>
    ["kody-staff", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: StaffQueryScope = {}) =>
    [
      "kody-staff-member",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function useStaffQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: staffQueryScopeFromAuth(currentAuth),
  };
}

export function useStaff() {
  const { currentAuth, scope } = useStaffQueryScope();
  return useQuery({
    queryKey: staffQueryKeys.list(scope),
    queryFn: () => kodyApi.staff.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useStaffMember(slug: string | null) {
  const { currentAuth, scope } = useStaffQueryScope();
  return useQuery({
    queryKey: staffQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.staff.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateStaff(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useStaffQueryScope();

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
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list(scope) });
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
  const { scope } = useStaffQueryScope();

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
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list(scope) });
      queryClient.setQueryData(staffQueryKeys.detail(slug, scope), staffMember);
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
  const { scope } = useStaffQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.staff.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: staffQueryKeys.list(scope) });
      queryClient.removeQueries({
        queryKey: staffQueryKeys.detail(slug, scope),
      });
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
