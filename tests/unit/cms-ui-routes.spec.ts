import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("CMS UI routes", () => {
  it("has a first-class edit route wired to the edit manager", () => {
    const path = "app/(chat-rail)/cms/[collection]/[id]/edit/page.tsx";

    expect(existsSync(resolve(root, path))).toBe(true);
    expect(readRepoFile(path)).toContain("CmsEditManager");
    expect(
      readRepoFile("src/dashboard/lib/components/CmsManager.tsx"),
    ).toContain("export function CmsEditManager");
  });

  it("renders CMS forms with explicit cancel handling", () => {
    const source = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");

    expect(source).toContain("onCancel");
    expect(source).toContain("Cancel");
  });

  it("offers CMS config creation from the unconfigured state", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const client = readRepoFile("src/dashboard/lib/components/cms/client.ts");

    expect(manager).toContain("UnconfiguredCmsState");
    expect(manager).toContain("Create CMS config");
    expect(manager).toContain("createConfigMutation.mutate");
    expect(manager).toContain("selectedAdapter");
    expect(manager).toContain("onAdapterChange");
    expect(manager).toContain("CMS adapter");
    expect(client).toContain("fetchCmsAdapters");
    expect(client).toContain("createCmsConfig");
  });

  it("offers schema generation when CMS has no collections", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const client = readRepoFile("src/dashboard/lib/components/cms/client.ts");

    expect(manager).toContain("GenerateSchemaState");
    expect(manager).toContain("Generate schema");
    expect(manager).toContain("DATABASE_URL");
    expect(manager).toContain("generateSchemaMutation.mutate");
    expect(manager).not.toContain("URI secret");
    expect(manager).not.toContain("Sample size");
    expect(manager).not.toContain("Skip collections");
    expect(client).toContain("/api/kody/cms/schema");
  });

  it("offers schema refresh when CMS already has collections", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const client = readRepoFile("src/dashboard/lib/components/cms/client.ts");

    expect(manager).toContain("Update schema");
    expect(manager).toContain("refresh: true");
    expect(client).toContain("refresh?: boolean");
  });

  it("keeps CMS table filters mounted while documents load", () => {
    const source = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const start = source.indexOf("function CollectionWorkspace");
    const end = source.indexOf("function GenerateSchemaState");
    const workspace = source.slice(start, end);

    expect(workspace).toContain("loading={loading}");
    expect(workspace).not.toContain("{loading ? (");
    expect(source).toContain(") : documents.length === 0 ? (");
  });

  it("keeps CMS form actions visible while form fields scroll", () => {
    const source = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const start = source.indexOf("function ContentFormPage");
    const end = source.indexOf("function FormFieldControl");
    const form = source.slice(start, end);

    expect(form).toContain("overflow-hidden");
    expect(form).toContain("overflow-y-auto");
    expect(form).toContain("border-t border-border");
    expect(form).toContain("Save changes");
    expect(form).toContain("Create");
  });

  it("contains outer page scrolling in CMS without fixing the dashboard shell", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const shell = readRepoFile(
      "src/dashboard/lib/components/ChatRailShell.tsx",
    );

    expect(manager).toContain("useCmsViewportGuard");
    expect(manager).toContain('window.history.scrollRestoration = "manual"');
    expect(manager).toContain('htmlStyle.overflow = "hidden"');
    expect(shell).not.toContain('bodyStyle.position = "fixed"');
  });

  it("offers CMS permissions management from the CMS header", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");
    const client = readRepoFile("src/dashboard/lib/components/cms/client.ts");

    expect(manager).toContain("CMS permissions");
    expect(manager).toContain("Default policy");
    expect(manager).toContain("Collection write actions");
    expect(manager).toContain("Collection overrides");
    expect(manager).toContain("Clear overrides");
    expect(manager).toContain("Save permissions");
    expect(manager).toContain("buildCollectionOperationFlags");
    expect(manager).toContain("onOpenPermissions");
    expect(client).toContain("saveCmsPermissions");
    expect(client).toContain("operations?: Pick");
    expect(client).toContain('method: "PATCH"');
  });

  it("offers CMS MCP connection details from CMS header", () => {
    const manager = readRepoFile("src/dashboard/lib/components/CmsManager.tsx");

    expect(manager).toContain("CMS MCP");
    expect(manager).toContain("/api/kody/cms/mcp");
    expect(manager).toContain("x-kody-token");
    expect(manager).toContain("x-kody-owner");
    expect(manager).toContain("x-kody-repo");
    expect(manager).toContain("generateCmsMcpTools");
  });
});
