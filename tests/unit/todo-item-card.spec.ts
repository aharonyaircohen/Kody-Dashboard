import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo item cards", () => {
  it("starts todo item bodies collapsed by default", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(",
    );
    expect(TODO_CONTROL_SOURCE).toContain("() => new Set(),");
    expect(TODO_CONTROL_SOURCE).not.toContain(
      "() => new Set(list.items.map((item) => item.id)),",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "if (current.has(selectedItemId)) return current;",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "return new Set(current).add(selectedItemId);",
    );
  });

  it("does not reset filters when selecting a hidden item", () => {
    const selectedItemEffect = TODO_CONTROL_SOURCE.match(
      /useEffect\(\(\) => \{\n    if \(!selectedItemId\) return;[\s\S]*?\n  \}, \[list\.items, selectedItemId\]\);/,
    )?.[0];

    expect(TODO_CONTROL_SOURCE).toContain("TODO_LIST_FILTER_STORAGE_KEY");
    expect(TODO_CONTROL_SOURCE).toContain("TODO_ITEM_FILTER_STORAGE_KEY");
    expect(TODO_CONTROL_SOURCE).toContain("usePersistedState<TodoListFilter>");
    expect(TODO_CONTROL_SOURCE).toContain("usePersistedState<TodoItemFilter>");
    expect(selectedItemEffect).toBeTruthy();
    expect(selectedItemEffect).toContain(
      "if (!list.items.some((item) => item.id === selectedItemId)) return;",
    );
    expect(selectedItemEffect).not.toContain("setItemFilter");
    expect(TODO_CONTROL_SOURCE).not.toContain('setItemFilter("all")');
  });

  it("updates selected item routes without jumping scroll to the header", () => {
    const selectItemBlock = TODO_CONTROL_SOURCE.match(
      /const selectItem = \([\s\S]*?\n  \};/,
    )?.[0];

    expect(selectItemBlock).toBeTruthy();
    expect(TODO_CONTROL_SOURCE).toContain(
      'import { useScrollRestoration } from "../hooks/useScrollRestoration";',
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "const detailScrollRef = useScrollRestoration(",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      '`todos-detail:${selectedSlug ?? "none"}`',
    );
    expect(TODO_CONTROL_SOURCE).toContain("ref={detailScrollRef}");
    expect(selectItemBlock).toContain(
      "router.replace(scopedHref(path), { scroll: false })",
    );
    expect(selectItemBlock).toContain(
      "router.push(scopedHref(path), { scroll: false })",
    );
  });

  it("scrolls deep links to their selected item only on initial mount", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "const shouldScrollToInitialSelectedItemRef = useRef(Boolean(selectedItemId));",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "const selectedItemNodeRef = useRef<HTMLLIElement | null>(null);",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "selectedItemNodeRef.current = node;",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      'node.scrollIntoView({ block: "center", inline: "nearest" });',
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "shouldScrollToInitialSelectedItemRef.current = false;",
    );
    expect(TODO_CONTROL_SOURCE).toContain("onInitialSelectedItemNode");
  });

  it("selects item routes from card clicks without stealing control clicks", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "function isTodoItemCardClickIgnored(",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "\"button,a,input,textarea,select,[role='button'],[role='menuitem'],[data-todo-item-control]\"",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "isTodoItemCardClickIgnored(event.target, event.currentTarget)",
    );
    expect(TODO_CONTROL_SOURCE).toContain("function stopTodoItemActionClick(");
    expect(TODO_CONTROL_SOURCE).toContain("event.stopPropagation();");
    expect(TODO_CONTROL_SOURCE).toContain("data-todo-item-control");
    expect(TODO_CONTROL_SOURCE).toContain("onSelect();");
    expect(TODO_CONTROL_SOURCE).toContain("cursor-pointer");
  });

  it("keeps the Ask Kody item action icon-only with a tooltip", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      '<SimpleTooltip content="Ask Kody" side="bottom">',
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "aria-label={`Ask Kody about ${item.title}`}",
    );
    expect(TODO_CONTROL_SOURCE).toContain('className="h-8 w-8');
    expect(TODO_CONTROL_SOURCE).toContain("px-0 text-emerald-700");
    expect(TODO_CONTROL_SOURCE).not.toContain("<span>Ask Kody</span>");
  });

  it("renders managed goal item status from todo metadata", () => {
    expect(TODO_CONTROL_SOURCE).toContain("function managedGoalItemStatus(");
    expect(TODO_CONTROL_SOURCE).toContain('stringMeta(meta, "resultClass")');
    expect(TODO_CONTROL_SOURCE).toContain('stringMeta(meta, "reason")');
    expect(TODO_CONTROL_SOURCE).toContain('stringMeta(meta, "nextAction")');
    expect(TODO_CONTROL_SOURCE).toContain('numberMeta(meta, "attempts")');
    expect(TODO_CONTROL_SOURCE).toContain('stringMeta(meta, "nextRetryAt")');
    expect(TODO_CONTROL_SOURCE).toContain('numberMeta(meta, "issue")');
    expect(TODO_CONTROL_SOURCE).toContain("{managedStatus.label}");
    expect(TODO_CONTROL_SOURCE).toContain("Next: {managedStatus.nextAction}");
    expect(TODO_CONTROL_SOURCE).toContain(
      "{formatRetryTime(managedStatus.nextRetryAt)}",
    );
    expect(TODO_CONTROL_SOURCE).toContain("Issue #{managedStatus.issue}");
  });

  it("saves item deletes before clearing a selected item route", () => {
    const deleteItemBlock = TODO_CONTROL_SOURCE.match(
      /const deleteItem = \(item: TodoItem\) => \{([\s\S]*?)\n  \};/,
    )?.[1];

    expect(deleteItemBlock).toContain("updateMutation.mutate(");
    expect(deleteItemBlock).toContain(
      "items: list.items.filter((candidate) => candidate.id !== item.id)",
    );
    expect(deleteItemBlock).toContain("onSuccess");
    expect(deleteItemBlock).toContain("selectedItemId === item.id");
    expect(deleteItemBlock).toContain("onSelectItem(null, true)");
  });
});
