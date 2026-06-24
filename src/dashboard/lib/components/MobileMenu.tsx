/**
 * @fileType component
 * @domain kody
 * @pattern mobile-nav-sheet
 * @ai-summary Shared mobile navigation sheet used by both Dashboard and Vibe pages.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Github, LogOut, Plus, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";

import { useAuth, type KodyRepoEntry } from "../auth-context";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { cn } from "../utils";
import { AddRepoForm } from "./AddRepoForm";
import { ConfirmDialog } from "./ConfirmDialog";
import { InboxBadge } from "./InboxBadge";
import { SimpleTooltip } from "./SimpleTooltip";
import {
  MOBILE_NAV_SECTIONS,
  PRIMARY_NAV_TITLE,
  PRIMARY_VIEW_TITLE,
} from "./settings-nav";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

interface MobileMenuProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Primary action shown above workspace tiles. */
  workspacePrimary?: ReactNode;
  /** Extra sections rendered above the sticky bottom CTA. */
  extras?: ReactNode;
  /** Sticky CTA pinned at bottom. */
  bottomCta?: ReactNode;
}

export function MobileMenu({
  open,
  onOpenChange,
  workspacePrimary,
  extras,
  bottomCta,
}: MobileMenuProps) {
  const { auth, removeRepo } = useAuth();
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity();
  const [confirmRemove, setConfirmRemove] = useState<{
    index: number;
    entry: KodyRepoEntry;
  } | null>(null);
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  const close = () => {
    setAddRepoOpen(false);
    onOpenChange(false);
  };

  const currentRepo = auth?.repos[auth.currentRepoIndex] ?? null;
  const viewItems =
    MOBILE_NAV_SECTIONS.find((section) => section.title === PRIMARY_VIEW_TITLE)
      ?.items ?? [];
  const workspaceItems =
    MOBILE_NAV_SECTIONS.find((section) => section.title === PRIMARY_NAV_TITLE)
      ?.items ?? [];
  const settingsSections = MOBILE_NAV_SECTIONS.filter(
    (section) =>
      section.title !== PRIMARY_VIEW_TITLE &&
      section.title !== PRIMARY_NAV_TITLE,
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[88vw] sm:w-[360px] !p-0 !gap-0 overflow-y-auto bg-black/95 border-white/[0.08]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>
              Navigation, identity, and quick actions.
            </SheetDescription>
          </SheetHeader>

          {(githubUser || connectedRepo) && (
            <div className="px-4 pt-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                {githubUser ? (
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage
                      src={githubUser.avatar_url}
                      alt={githubUser.login}
                    />
                    <AvatarFallback>
                      {githubUser.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Github className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {githubUser ? `@${githubUser.login}` : "Connected"}
                  </div>
                  {connectedRepo && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {connectedRepo}
                    </div>
                  )}
                </div>
                {githubUser && (
                  <SimpleTooltip content="Sign out">
                    <button
                      type="button"
                      onClick={() => {
                        clearGitHubUser();
                        close();
                      }}
                      className="shrink-0 h-8 w-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                      aria-label="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </SimpleTooltip>
                )}
              </div>

              {currentRepo && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentRepo.isLogin || !auth) return;
                    setConfirmRemove({
                      index: auth.currentRepoIndex,
                      entry: currentRepo,
                    });
                    close();
                  }}
                  disabled={currentRepo.isLogin}
                  title={
                    currentRepo.isLogin
                      ? "Login repo can't be removed — use Sign out instead"
                      : `Remove ${currentRepo.owner}/${currentRepo.repo}`
                  }
                  className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 text-sm font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove current repo
                </button>
              )}
            </div>
          )}

          <div className="px-4 pt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
              Repository
            </div>

            {addRepoOpen ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <AddRepoForm isBootstrap={!auth} onAdded={close} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddRepoOpen(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
              >
                <Plus className="h-4 w-4" />
                {auth ? "Add repository" : "Connect repository"}
              </button>
            )}
          </div>

          <div className="px-4 pt-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
              {PRIMARY_VIEW_TITLE}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {viewItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-center"
                  >
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md",
                        item.tint,
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
              {PRIMARY_NAV_TITLE}
            </div>

            {workspacePrimary}

            <div className="grid grid-cols-2 gap-2 mt-2">
              {workspaceItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                  >
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md",
                        item.tint,
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.description && (
                      <span className="text-[11px] text-muted-foreground line-clamp-2">
                        {item.description}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="px-1 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/80">
              Settings
            </div>
            <div className="space-y-3 mt-1">
              {settingsSections.map((section) => (
                <div key={section.title}>
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    {section.title}
                  </p>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden divide-y divide-white/[0.04]">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={close}
                          className="flex items-center gap-3 h-12 px-3 hover:bg-white/[0.04] transition-colors"
                        >
                          <span
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md",
                              item.tint,
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-medium flex-1 flex items-center gap-2">
                            {item.label}
                            {item.href === "/inbox" && <InboxBadge />}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {extras}

          {APP_VERSION && (
            <p className="px-5 pt-3 pb-1 text-[10px] font-mono text-muted-foreground/50 select-none">
              v{APP_VERSION}
            </p>
          )}

          {bottomCta && (
            <div className="sticky bottom-0 px-4 py-3 border-t border-white/[0.08] bg-black/95 backdrop-blur">
              {bottomCta}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {confirmRemove && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRemove(null)}
          title={`Remove ${confirmRemove.entry.owner}/${confirmRemove.entry.repo}?`}
          description="The PAT will be deleted from browser. Repository and webhook on GitHub are not affected."
          confirmLabel="Remove"
          variant="destructive"
          onConfirm={() => {
            removeRepo(confirmRemove.index);
            setConfirmRemove(null);
          }}
        />
      )}
    </>
  );
}
