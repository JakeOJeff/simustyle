// Shared headless-Chrome setup for capturing real SimuStyle editor footage.
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));

export const EDITOR_URL = process.env.EDITOR_URL ?? "http://127.0.0.1:5199/editor/";

// Remotion's own headless shell, so nothing extra has to be downloaded.
const CHROME = path.join(
  here,
  "../node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe",
);

/**
 * Replaces the page clock and requestAnimationFrame with ones the script steps by hand,
 * so physics, animation and the WebGL viewport render exactly one 30 fps frame per capture,
 * however long each screenshot takes.
 */
const CLOCK = `(() => {
  let now = 0;
  const start = Date.now();
  let queue = [];
  let nextId = 1;
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  Date.now = () => start + now;
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { queue = queue.filter((q) => q.id !== id); };
  window.__step = (ms) => {
    now += ms;
    const run = queue;
    queue = [];
    for (const { cb } of run) { try { cb(now); } catch (e) { console.error(e); } }
  };
  window.__realNow = realNow;
})();`;

export async function openEditor({ width = 1600, height = 900, scale = 1.2 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.evaluateOnNewDocument(CLOCK);
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  return { browser, page };
}

/** Advance the page clock by one or more 30 fps frames, letting microtasks settle. */
export async function step(page, frames = 1) {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => window.__step(1000 / 30));
  }
  await new Promise((r) => setTimeout(r, 5));
}

/** Click the first visible button whose aria-label, title or text matches `label` exactly. */
export async function clickButton(page, label) {
  const ok = await page.evaluate((label) => {
    const el = [...document.querySelectorAll("button, [role=tab]")].find((b) => {
      const r = b.getBoundingClientRect();
      if (!r.width) return false;
      return [b.getAttribute("aria-label"), b.getAttribute("title"), b.textContent.trim()].includes(label);
    });
    el?.click();
    return Boolean(el);
  }, label);
  if (!ok) throw new Error(`No button "${label}"`);
}
