import { chromium } from 'playwright-core';
import * as fs from 'node:fs';

// Load .env
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = 'https://kody-dashboard-aguy.vercel.app';
const REPO = process.env.E2E_GITHUB_REPO ?? 'https://github.com/aharonyaircohen/Kody-Engine-Tester';
const TOKEN = process.env.E2E_GITHUB_TOKEN;
const BYPASS = process.env.VERCEL_BYPASS ?? 'rLlm9Mn8s4FKhf4hbDU4DZ0KNBxTJpUc';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? '300000');
const HEADLESS = process.env.HEADED !== '1';

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

if (!TOKEN) { console.error('E2E_GITHUB_TOKEN missing in .env'); process.exit(1); }

log(`launching (headless=${HEADLESS}) repo=${REPO}`);
const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !m.text().includes('preloaded using link preload')) {
    log(`browser ${m.type()}: ${m.text().slice(0, 200)}`);
  }
});

log('setting Vercel bypass cookie');
await page.goto(`${BASE}/?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=samesitenone`, { waitUntil: 'load' });

log('going to /login');
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.removeItem('kody_auth')).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });

if (page.url().includes('/login')) {
  log('filling repo + token (by id)');
  await page.locator('#repoUrl').fill(REPO);
  await page.locator('#token').fill(TOKEN);
  // wait for submit to re-enable
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled;
    },
    null,
    { timeout: 5_000 },
  );
  log('clicking Connect to GitHub');
  await page.getByRole('button', { name: /connect to github/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
  log(`logged in -> ${page.url()}`);
}

await page.screenshot({ path: `/tmp/dash-after-login-${Date.now()}.png` });

log('opening agent picker');
let opened = false;
for (const name of ['Gemini', 'Brain', 'Kody']) {
  const btn = page.locator(`button:has-text("${name}")`).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    log(`clicking agent picker showing "${name}"`);
    await btn.click();
    opened = true;
    break;
  }
}
if (!opened) log('no agent picker found');

await page.waitForTimeout(500);
log('selecting Kody Live');
await page.getByText(/kody live/i).first().click({ timeout: 10_000 }).catch((e) => log(`select failed: ${e.message}`));

await page.waitForTimeout(800);
await page.screenshot({ path: `/tmp/dash-agent-picked-${Date.now()}.png` });

log('clicking Start Live Runner');
await page.getByRole('button', { name: /start live runner/i }).click({ timeout: 10_000 }).catch((e) => log(`start failed: ${e.message}`));

const start = Date.now();
let lastBanner = '';
while (Date.now() - start < TIMEOUT_MS) {
  const txt = (await page.locator('text=/Booting|Almost ready|Queueing|Setting up|Installing Kody|Starting LiteLLM|Warming up|Live runner ready|Live runner ended|Live runner is offline|Watching/i').allTextContents().catch(() => [])).join(' | ').slice(0, 250);
  if (txt && txt !== lastBanner) {
    log(`banner: ${txt}`);
    lastBanner = txt;
  }
  if (/Live runner ready/i.test(txt)) { log('STATE=ready ✅'); break; }
  if (/ended|offline/i.test(txt) && !/Booting|Almost ready/i.test(txt)) { log('STATE=ended ❌'); break; }
  await page.waitForTimeout(5000);
}

await page.screenshot({ path: `/tmp/dash-final-${Date.now()}.png`, fullPage: true });
log('done');
await browser.close();
