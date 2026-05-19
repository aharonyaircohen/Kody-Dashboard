/**
 * @fileType hook
 * @domain kody
 * @pattern messages-hooks
 * @ai-summary React Query hooks for the team messaging feature. Channels =
 *   `#`-titled GitHub Discussions; threads reuse the goal-discussion comment
 *   feed. Polling cadence stays >=15s per the GitHub rate-limit rules.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type GoalDiscussionComment,
  type MessageChannel,
  type MessageChannelsPayload,
  type MessageThreadPayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const messageQueryKeys = {
  channels: ["kody-messages", "channels"] as const,
  thread: (n: number) => ["kody-messages", "thread", n] as const,
};

const noRetryOnAuth = (failureCount: number, error: unknown) => {
  if (error instanceof SessionExpiredError) return false;
  if (error instanceof NoTokenError) return false;
  return failureCount < 2;
};

/** List of channels. Polled every 30s — channels change rarely. */
export function useMessageChannels() {
  return useQuery<MessageChannelsPayload>({
    queryKey: messageQueryKeys.channels,
    queryFn: () => kodyApi.messages.listChannels(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: noRetryOnAuth,
  });
}

/**
 * Message feed for one channel. Polled every 15s (the rate-limit floor for
 * GitHub-touching endpoints) so new messages appear without a refresh.
 */
export function useChannelThread(channelNumber: number | null) {
  return useQuery<MessageThreadPayload>({
    queryKey: channelNumber
      ? messageQueryKeys.thread(channelNumber)
      : ["kody-messages", "thread", "__none__"],
    queryFn: () => kodyApi.messages.fetchThread(channelNumber!),
    enabled: channelNumber !== null && !!getStoredAuth(),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: noRetryOnAuth,
  });
}

export function useCreateChannel(actorLogin?: string) {
  const queryClient = useQueryClient();
  return useMutation<
    MessageChannel,
    Error,
    { name: string; topic?: string }
  >({
    mutationFn: (data) =>
      kodyApi.messages.createChannel({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<MessageChannelsPayload>(
        messageQueryKeys.channels,
        (prev) => {
          if (!prev || !prev.enabled) return prev;
          if (prev.channels.some((c) => c.number === created.number))
            return prev;
          return { ...prev, channels: [created, ...prev.channels] };
        },
      );
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.channels });
    },
    onError: (error) => {
      toast.error("Failed to create channel", { description: error.message });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (channelNumber) =>
      kodyApi.messages.deleteChannel(channelNumber),
    onSuccess: (_void, channelNumber) => {
      queryClient.setQueryData<MessageChannelsPayload>(
        messageQueryKeys.channels,
        (prev) => {
          if (!prev || !prev.enabled) return prev;
          return {
            ...prev,
            channels: prev.channels.filter((c) => c.number !== channelNumber),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: messageQueryKeys.channels });
      toast.success("Channel deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete channel", { description: error.message });
    },
  });
}

export function usePostChannelMessage(
  channelNumber: number,
  actorLogin?: string,
) {
  const queryClient = useQueryClient();
  return useMutation<GoalDiscussionComment, Error, string>({
    mutationFn: (body) =>
      kodyApi.messages.postMessage(channelNumber, body, actorLogin),
    onSuccess: (created) => {
      queryClient.setQueryData<MessageThreadPayload>(
        messageQueryKeys.thread(channelNumber),
        (prev) => {
          if (!prev) return prev;
          if (prev.comments.some((c) => c.id === created.id)) return prev;
          return { ...prev, comments: [...prev.comments, created] };
        },
      );
      queryClient.invalidateQueries({
        queryKey: messageQueryKeys.thread(channelNumber),
      });
    },
    onError: (error) => {
      toast.error("Failed to send message", { description: error.message });
    },
  });
}
