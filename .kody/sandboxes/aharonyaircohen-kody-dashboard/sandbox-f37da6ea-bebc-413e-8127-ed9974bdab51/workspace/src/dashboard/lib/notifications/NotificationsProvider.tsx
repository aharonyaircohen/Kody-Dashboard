/**
 * @fileType component
 * @domain notifications
 * @pattern notifications-provider
 * @ai-summary Single source of truth for the in-memory notification store
 *   and the browser-permission state. Mounted once near the root
 *   (ChatRailShell) so every page sees the same unread count and prefs.
 *
 *   Why a provider: prior to this, KodyDashboard and VibePage each called
 *   `useNotificationStore()` directly, producing two independent in-memory
 *   copies of the same localStorage-persisted state. Counts and prefs
 *   would drift between the two surfaces until reload.
 *
 *   `useNotifications()` returns a no-op surface when called outside the
 *   provider so unauthenticated renders (e.g. the empty-state RepoManager) don't crash.
 */
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useBrowserNotifications } from "../hooks/useBrowserNotifications";
import { useNotificationStore } from "./useNotificationStore";
import type { UseNotificationStoreReturn } from "./useNotificationStore";

export interface NotificationsApi {
  store: UseNotificationStoreReturn;
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => void;
}

const NOOP_STORE: UseNotificationStoreReturn = {
  notifications: [],
  unreadCount: 0,
  prefs: { inAppEnabled: false, disabledTypes: [] } as never,
  addNotification: () => null,
  markAsRead: () => {},
  markAllAsRead: () => {},
  clearAll: () => {},
  removeNotification: () => {},
  updatePrefs: () => {},
  toggleType: () => {},
  isTypeEnabled: () => false,
};

const NOOP_API: NotificationsApi = {
  store: NOOP_STORE,
  permission: "default",
  isSupported: false,
  requestPermission: () => {},
};

const NotificationsContext = createContext<NotificationsApi | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const store = useNotificationStore();
  const { permission, isSupported, requestPermission } =
    useBrowserNotifications({
      store,
    });

  const value = useMemo<NotificationsApi>(
    () => ({ store, permission, isSupported, requestPermission }),
    [store, permission, isSupported, requestPermission],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

/** Read the shared notifications API. Returns a no-op surface when called
 *  outside the provider so unauthenticated routes don't crash. */
export function useNotifications(): NotificationsApi {
  return useContext(NotificationsContext) ?? NOOP_API;
}
