export interface CreateTodoDraftItem {
  title: string;
  body: string;
}

export interface CreateTodoItemPayload {
  title: string;
  body: string;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export function hasInvalidCreateTodoDraftItems(
  items: CreateTodoDraftItem[],
): boolean {
  return items.some((item) => !hasText(item.title) && hasText(item.body));
}

export function buildCreateTodoItemsPayload(
  items: CreateTodoDraftItem[],
): CreateTodoItemPayload[] {
  return items
    .filter((item) => hasText(item.title))
    .map((item) => ({
      title: item.title.trim(),
      body: item.body,
    }));
}
