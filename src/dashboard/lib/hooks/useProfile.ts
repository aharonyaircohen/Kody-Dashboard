/**
 * @fileType hook
 * @domain kody
 * @pattern profile-control-hooks
 * @ai-summary React Query hooks for the Company Profile page.
 *   Backed by `.kody/profile/<slug>.md` files in the connected repo via
 *   the contents API. Each section carries an `audience:` list (chat
 *   and/or qa) that decides which consumers load it. Mirrors useStaff.ts.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type ProfileAudience,
  type ProfileSection,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const profileQueryKeys = {
  list: ["kody-profile"] as const,
  detail: (slug: string) => ["kody-profile-section", slug] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: profileQueryKeys.list,
    queryFn: () => kodyApi.profile.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useProfileSection(slug: string | null) {
  return useQuery({
    queryKey: profileQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.profile.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateProfile(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    ProfileSection,
    Error,
    {
      slug: string;
      body: string;
      audience: ProfileAudience[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.profile.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKeys.list });
      toast.success("Profile section created");
    },
    onError: (error) => {
      toast.error("Failed to create profile section", {
        description: error.message,
      });
    },
  });
}

export function useUpdateProfile(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    ProfileSection,
    Error,
    {
      body?: string;
      audience?: ProfileAudience[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.profile.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (section) => {
      queryClient.invalidateQueries({ queryKey: profileQueryKeys.list });
      queryClient.setQueryData(profileQueryKeys.detail(slug), section);
      toast.success("Profile section updated");
    },
    onError: (error) => {
      toast.error("Failed to update profile section", {
        description: error.message,
      });
    },
  });
}

export function useDeleteProfile(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.profile.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: profileQueryKeys.list });
      queryClient.removeQueries({ queryKey: profileQueryKeys.detail(slug) });
      toast.success("Profile section deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete profile section", {
        description: error.message,
      });
    },
  });
}
