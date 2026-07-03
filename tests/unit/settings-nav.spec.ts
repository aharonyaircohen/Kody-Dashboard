import { describe, expect, it } from "vitest";

import {
  ENGINEER_MODE_SECTIONS,
  MOBILE_NAV_SECTIONS,
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_TITLE,
  PRIMARY_VIEW_TITLE,
  SETTINGS_NAV_SECTIONS,
  navLabelForPath,
  type SettingsNavSection,
} from "@dashboard/lib/components/settings-nav";

function exposedHrefs(): string[] {
  return [
    ...PRIMARY_NAV_ITEMS.map((item) => item.href),
    ...SETTINGS_NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => item.href),
    ),
  ];
}

function sectionHrefs(
  sections: readonly SettingsNavSection[],
  title: string,
): string[] {
  return (
    sections
      .find((section) => section.title === title)
      ?.items.map((item) => item.href) ?? []
  );
}

function allHrefs(sections: readonly SettingsNavSection[]): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.href));
}

describe("settings navigation", () => {
  it("exposes reports without legacy inbox, trust, or ledger sections", () => {
    const hrefs = exposedHrefs();

    expect(hrefs).toContain("/reports");
    expect(hrefs).not.toContain("/inbox");
    expect(hrefs).not.toContain("/trust");
    expect(hrefs).not.toContain("/ledgers");

    expect(navLabelForPath("/reports")).toBe("Reports");
    expect(navLabelForPath("/inbox")).toBeNull();
    expect(navLabelForPath("/trust")).toBeNull();
    expect(navLabelForPath("/ledgers")).toBeNull();
  });

  it("exposes Fly config, previews, Brain images, live machines, and history as separate pages", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Fly")).toEqual([
      "/fly/config",
      "/fly/previews",
      "/fly/brain-images",
      "/fly/machines",
      "/fly/history",
    ]);
    expect(navLabelForPath("/fly/config")).toBe("Config");
    expect(navLabelForPath("/fly/previews")).toBe("Previews");
    expect(navLabelForPath("/fly/brain-images")).toBe("Brain Images");
    expect(navLabelForPath("/fly/machines")).toBe("Live machines");
    expect(navLabelForPath("/fly/history")).toBe("History");
    expect(navLabelForPath("/terminal")).toBeNull();
  });

  it("groups content entries, models, and settings into one side-panel section", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Content")).toEqual([
      "/content/entries",
      "/content/models",
      "/content/settings",
    ]);
    expect(navLabelForPath("/content/entries")).toBe("Entries");
    expect(navLabelForPath("/content/models")).toBe("Models");
    expect(navLabelForPath("/content/settings")).toBe("Settings");
  });

  it("keeps every desktop engineer side-panel route reachable on mobile", () => {
    const mobileHrefs = new Set(allHrefs(MOBILE_NAV_SECTIONS));

    for (const href of allHrefs(ENGINEER_MODE_SECTIONS)) {
      expect(mobileHrefs.has(href), `${href} missing from mobile nav`).toBe(
        true,
      );
    }
  });

  it("uses the same workspace list in desktop engineer and mobile side panels", () => {
    expect(sectionHrefs(MOBILE_NAV_SECTIONS, PRIMARY_NAV_TITLE)).toEqual(
      sectionHrefs(ENGINEER_MODE_SECTIONS, PRIMARY_NAV_TITLE),
    );
  });

  it("keeps Dashboard as the mobile-only extra view entry", () => {
    expect(sectionHrefs(MOBILE_NAV_SECTIONS, PRIMARY_VIEW_TITLE)).toEqual([
      "/",
      "/tasks",
      "/vibe",
      "/preview",
    ]);
  });

  it("keeps Views active for selected saved preview routes", () => {
    const previewHref = "/preview";
    const previewItem = sectionHrefs(ENGINEER_MODE_SECTIONS, PRIMARY_VIEW_TITLE)
      .map((href) =>
        ENGINEER_MODE_SECTIONS.flatMap((section) => section.items).find(
          (item) => item.href === href,
        ),
      )
      .find((item) => item?.href === previewHref);

    expect(previewItem?.label).toBe("Views");
    expect(previewItem?.exact).toBeUndefined();
    expect(navLabelForPath("/preview/dev-4ojw")).toBe("Views");
  });
});
