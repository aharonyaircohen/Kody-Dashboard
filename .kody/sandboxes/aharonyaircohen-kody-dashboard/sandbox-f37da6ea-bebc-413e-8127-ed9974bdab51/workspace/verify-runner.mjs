import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", e => errs.push(e.message));
page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:3333/runner", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Fly Runner");
const cfg = page.getByRole("tab", { name: "Configuration" });
if (await cfg.count()) await cfg.click();
await page.waitForTimeout(300);

const checks = {
  legendWholeRepo: await page.locator("text=whole repo = everyone").count(),
  legendJustYou:   await page.locator("text=just you = this browser").count(),
  legendReadOnly:  await page.locator("text=read-only = status").count(),
  infoIcons:       await page.locator("svg.lucide-info").count(),
  chips: {
    justYou:    await page.locator("span:text-is('just you')").count(),
    wholeRepo:  await page.locator("span:text-is('whole repo')").count(),
    readOnly:   await page.locator("span:text-is('read-only')").count(),
  },
};

await page.screenshot({ path: "/tmp/r1-overview.png", fullPage: true });

await page.locator("span:text-is('just you')").first().hover();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/r2-chip-tooltip.png", fullPage: true });
const chipTip = await page.locator('[role="tooltip"]').first().textContent().catch(() => null);

await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.locator("svg.lucide-info").first().hover();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/r3-section-tooltip.png", fullPage: true });
const sectionTip = await page.locator('[role="tooltip"]').first().textContent().catch(() => null);

console.log(JSON.stringify({ checks, chipTip, sectionTip, consoleErrors: errs }, null, 2));
await browser.close();
