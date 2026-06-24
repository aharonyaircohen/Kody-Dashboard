"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../auth-context";
import { RepoManager } from "./RepoManager";

export function OrgRedirect() {
  const { auth, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && auth?.owner) {
      router.replace(`/org/${encodeURIComponent(auth.owner)}`);
    }
  }, [auth?.owner, loading, router]);

  if (loading || auth?.owner) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <RepoManager />;
}
