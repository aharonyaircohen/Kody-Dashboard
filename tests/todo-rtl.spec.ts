import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);
const MARKDOWN_PREVIEW_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/MarkdownPreview.tsx"),
  "utf8",
);

describe("todo RTL text", () => {
  it("renders todo titles and markdown descriptions with automatic direction", () => {
    expect(TODO_CONTROL_SOURCE).toContain("autoDirProps");
    expect(TODO_CONTROL_SOURCE).toContain("rtlAwareMarkdownClassName");
    expect(TODO_CONTROL_SOURCE).toContain("textDirectionProps");
    expect(TODO_CONTROL_SOURCE).toContain("<h1");
    expect(TODO_CONTROL_SOURCE).toContain("<h2");
    expect(TODO_CONTROL_SOURCE).toContain("{...autoDirProps}");
    expect(TODO_CONTROL_SOURCE).toContain(
      "const listTitleDirectionProps = textDirectionProps(list.title);",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "const itemTitleDirectionProps = textDirectionProps(item.title);",
    );
    expect(TODO_CONTROL_SOURCE).toContain("{...listTitleDirectionProps}");
    expect(TODO_CONTROL_SOURCE).toContain("{...itemTitleDirectionProps}");
    expect(TODO_CONTROL_SOURCE).toContain('className="min-w-0 flex-1"');
    expect(TODO_CONTROL_SOURCE).toContain("rtlAwareMarkdownClassName");
    expect(TODO_CONTROL_SOURCE).toContain("max-w-3xl text-start text-sm");
    expect(TODO_CONTROL_SOURCE).toContain(
      "border-t border-border/70 pt-3 text-start",
    );
  });

  it("lets markdown previews receive the full auto-direction props", () => {
    expect(MARKDOWN_PREVIEW_SOURCE).toContain("style?: React.CSSProperties");
    expect(MARKDOWN_PREVIEW_SOURCE).toContain("style,");
    expect(MARKDOWN_PREVIEW_SOURCE).toContain("style={style}");
  });
});
