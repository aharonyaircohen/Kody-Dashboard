import type { TodoItem } from "../api";

export function reorderTodoItems(
  items: TodoItem[],
  visibleItems: TodoItem[],
  activeId: string,
  overId: string,
): TodoItem[] {
  if (activeId === overId) return items;

  const visibleIds = visibleItems.map((item) => item.id);
  const fromIndex = visibleIds.indexOf(activeId);
  const toIndex = visibleIds.indexOf(overId);

  if (fromIndex === -1 || toIndex === -1) return items;

  const reorderedVisibleItems = moveArrayItem(visibleItems, fromIndex, toIndex);
  let visibleIndex = 0;
  const visibleIdSet = new Set(visibleIds);

  return items.map((item) => {
    if (!visibleIdSet.has(item.id)) return item;
    return reorderedVisibleItems[visibleIndex++] ?? item;
  });
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return items;
  next.splice(toIndex, 0, item);
  return next;
}
