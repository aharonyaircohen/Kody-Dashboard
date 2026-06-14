/**
 * @fileType hook
 * @domain kody
 * @pattern notifications-hooks
 * @ai-summary React Query hooks for notification rules. Mirrors useGoals:
 *   list query + create/update/delete mutations + a test action.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import type {
  NotificationRule,
  NotificationEvent,
  NotificationChannel,
} from "../notifications";

export const notificationQueryKeys = {
  list: ["kody-notifications"] as const,
};

export function useNotifications() {
  return useQuery<NotificationRule[]>({
    queryKey: notificationQueryKeys.list,
    queryFn: () => kodyApi.notifications.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useCreateNotification(actorLogin?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      enabled?: boolean;
      event: NotificationEvent;
      channel: NotificationChannel;
      template?: string;
    }) => kodyApi.notifications.create({ ...input, actorLogin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
      toast.success("Notification rule created");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create rule");
    },
  });
}

export function useUpdateNotification(id: string, actorLogin?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      enabled?: boolean;
      event?: NotificationEvent;
      channel?: NotificationChannel;
      template?: string | null;
    }) => kodyApi.notifications.update(id, { ...input, actorLogin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update rule");
    },
  });
}

export function useDeleteNotification(actorLogin?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => kodyApi.notifications.remove(id, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
      toast.success("Notification rule removed");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete rule");
    },
  });
}

export function useTestNotification(actorLogin?: string) {
  return useMutation({
    mutationFn: (input: { channel: NotificationChannel; text: string }) =>
      kodyApi.notifications.test({ ...input, actorLogin }),
    onSuccess: () => {
      toast.success("Test message sent");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Test failed");
    },
  });
}
