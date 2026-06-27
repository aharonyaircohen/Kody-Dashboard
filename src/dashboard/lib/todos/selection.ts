export function todoListSelectionRedirect(
  selectedSlug: string | null | undefined,
  availableSlugs: string[],
): string | null {
  if (!selectedSlug) return null;
  return availableSlugs.includes(selectedSlug) ? null : "/todos";
}
