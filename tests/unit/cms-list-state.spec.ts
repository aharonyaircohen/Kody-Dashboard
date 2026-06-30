import { describe, expect, it } from "vitest";

import {
  buildCmsPageNumbers,
  parseCmsListState,
  serializeCmsListState,
} from "@dashboard/lib/components/cms/list-state";

describe("CMS list state query persistence", () => {
  it("parses persisted collection search, filters, sort, and pagination", () => {
    const params = new URLSearchParams();
    params.set("collectionSearch", "posts");
    params.set(
      "filters",
      JSON.stringify({
        status: { operator: "equals", value: "published" },
        tags: { operator: "in", value: ["news", "release"] },
      }),
    );
    params.set(
      "sort",
      JSON.stringify([{ field: "publishedAt", direction: "desc" }]),
    );
    params.set("offset", "50");
    params.set("pageSize", "50");

    expect(parseCmsListState(params)).toEqual({
      collectionSearch: "posts",
      filterValues: {
        status: { operator: "equals", value: "published" },
        tags: { operator: "in", value: ["news", "release"] },
      },
      sort: [{ field: "publishedAt", direction: "desc" }],
      offset: 50,
      pageSize: 50,
    });
  });

  it("serializes list state while preserving unrelated query params", () => {
    const params = new URLSearchParams("preview=1&offset=25");
    const next = serializeCmsListState(params, {
      collectionSearch: "articles",
      filterValues: {
        title: { operator: "contains", value: "launch" },
      },
      sort: [{ field: "title", direction: "asc" }],
      offset: 0,
      pageSize: 100,
    });

    expect(next.get("preview")).toBe("1");
    expect(next.get("collectionSearch")).toBe("articles");
    expect(next.get("filters")).toBe(
      JSON.stringify({
        title: { operator: "contains", value: "launch" },
      }),
    );
    expect(next.get("sort")).toBe(
      JSON.stringify([{ field: "title", direction: "asc" }]),
    );
    expect(next.has("offset")).toBe(false);
    expect(next.get("pageSize")).toBe("100");
  });

  it("drops malformed persisted values instead of restoring invalid state", () => {
    const params = new URLSearchParams();
    params.set("filters", JSON.stringify({ bad: { operator: "oops" } }));
    params.set("sort", JSON.stringify([{ field: "title", direction: "up" }]));
    params.set("offset", "-10");
    params.set("pageSize", "5000");

    expect(parseCmsListState(params)).toEqual({
      collectionSearch: "",
      filterValues: {},
      sort: [],
      offset: 0,
      pageSize: null,
    });
  });

  it("builds compact page number jumps around the current page", () => {
    expect(buildCmsPageNumbers(1, 1)).toEqual([1]);
    expect(buildCmsPageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(buildCmsPageNumbers(6, 12)).toEqual([
      1,
      "ellipsis",
      5,
      6,
      7,
      "ellipsis",
      12,
    ]);
    expect(buildCmsPageNumbers(12, 12)).toEqual([1, "ellipsis", 9, 10, 11, 12]);
  });
});
