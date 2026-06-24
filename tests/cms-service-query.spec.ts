import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { parseCmsListQuery } from "@dashboard/lib/cms/service";

describe("CMS service list query parsing", () => {
  it("parses relation id lookups from repeated and comma-separated ids", () => {
    const req = new NextRequest(
      "https://dash.test/api/kody/cms/lessons?ids=64f1a5f6f2a80f3a3a3a3a3a,external-id&ids=external-id&ids=chapter-2",
    );

    expect(parseCmsListQuery(req).ids).toEqual([
      "64f1a5f6f2a80f3a3a3a3a3a",
      "external-id",
      "chapter-2",
    ]);
  });
});
