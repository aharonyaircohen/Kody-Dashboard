/**
 * @fileType page
 * @domain files
 * @pattern files-page
 * @ai-summary Files page entry point for deep links like /files/src/app.tsx.
 */
import type { Metadata } from "next";
import { FilesPage } from "@dashboard/components/files/FilesPage";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildKodyMetadata({
  title: "Files — Kody Operations Dashboard",
  description: "Browse and edit files in your repository.",
  path: "/files",
});

export default async function FilesPathRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <FilesPage initialPath={path.join("/")} />;
}
