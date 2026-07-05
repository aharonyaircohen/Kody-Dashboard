import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "src/dashboard/lib/components/SearchableSelect.tsx",
  "utf8",
);

describe("SearchableSelect", () => {
  it("keeps Escape scoped to the dropdown instead of bubbling to dialogs", () => {
    expect(SOURCE).toContain("data-searchable-select-open");
    expect(SOURCE).toContain('event.key === "Escape"');
    expect(SOURCE).toContain("event.preventDefault()");
    expect(SOURCE).toContain("event.stopPropagation()");
    expect(SOURCE).toContain("event.stopImmediatePropagation()");
    expect(SOURCE).toContain(
      'window.addEventListener("keydown", onKeyDown, true)',
    );
    expect(SOURCE).toContain(
      'window.removeEventListener("keydown", onKeyDown, true)',
    );
    expect(SOURCE).toContain("setOpen(false)");
  });

  it("lets multi-select menus open upward when space below is tight", () => {
    const multiSelect = SOURCE.slice(
      SOURCE.indexOf("export function SearchableMultiSelect"),
    );

    expect(multiSelect).toContain('useState<"top" | "bottom">("bottom")');
    expect(multiSelect).toContain("const [menuMaxHeight, setMenuMaxHeight]");
    expect(multiSelect).toContain("const updatePlacement = useCallback");
    expect(multiSelect).toContain("spaceBelow < minUsableMenuHeight");
    expect(multiSelect).toContain("setMenuMaxHeight(");
    expect(multiSelect).toContain(
      'window.addEventListener("scroll", updatePlacement, true)',
    );
    expect(multiSelect).toContain(
      'placement === "top" ? "bottom-full mb-1" : "top-full mt-1"',
    );
  });
});
