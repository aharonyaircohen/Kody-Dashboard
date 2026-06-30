import { describe, expect, it } from "vitest";

import {
  parseTodoFileContent,
  serializeTodoFileContent,
  type TodoFileContent,
} from "@dashboard/lib/todos/files";

const createdAt = "2026-06-28T00:00:00.000Z";
const updatedAt = "2026-06-28T01:00:00.000Z";

describe("todo file content", () => {
  it("round-trips one todo list as JSON", () => {
    const description = "## Scope\n\nTrack checkout work.\n\n- verify cart";
    const content: TodoFileContent = {
      title: "Checkout work",
      description,
      createdAt,
      frontmatter: {
        title: "Checkout work",
        createdAt,
        state: "active",
        managed: true,
      },
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          body: "Use the **preview**.",
          assignee: "aguy",
          completed: false,
          createdAt,
          completedAt: null,
          meta: { evidence: "cartVerified", stage: "verify" },
        },
      ],
    };

    const serialized = serializeTodoFileContent(content);
    const parsed = parseTodoFileContent(serialized, "checkout-work", updatedAt);
    const stored = JSON.parse(serialized) as Record<string, unknown>;

    expect(stored).toMatchObject({
      version: 1,
      title: "Checkout work",
      description,
      managed: true,
      state: "active",
    });
    expect(parsed).toMatchObject({
      ...content,
      frontmatter: {
        ...content.frontmatter,
        version: 1,
      },
    });
  });

  it("keeps a described empty list empty instead of creating a legacy item", () => {
    const serialized = serializeTodoFileContent({
      title: "Launch notes",
      description: "**Scope only**",
      createdAt,
      items: [],
    });

    const parsed = parseTodoFileContent(serialized, "launch-notes", updatedAt);

    expect(parsed.description).toBe("**Scope only**");
    expect(parsed.items).toEqual([]);
  });

  it("keeps old body-only files as a legacy item with no list description", () => {
    const parsed = parseTodoFileContent(
      [
        "---",
        'title: "Legacy list"',
        `createdAt: "${createdAt}"`,
        "---",
        "",
        "Old markdown body.",
      ].join("\n"),
      "legacy-list",
      updatedAt,
    );

    expect(parsed.description).toBe("");
    expect(parsed.items).toMatchObject([
      {
        title: "Legacy list",
        body: "Old markdown body.",
        assignee: null,
        completed: false,
        createdAt,
        completedAt: null,
      },
    ]);
  });
});
