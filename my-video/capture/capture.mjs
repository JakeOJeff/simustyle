// Records real SimuStyle editor footage for the product video.
//
//   1. Start the editor:  (repo root) npm run dev -- --port 5199 --strictPort
//   2. Capture:           (my-video)  node capture/capture.mjs [clip ...]
//
// Each clip is driven frame by frame under a stepped clock (see browser.mjs), saved as JPEGs,
// encoded to public/clips/<clip>.mp4, and its clicks are written to src/clips/<clip>.json so the
// video's cursor lands exactly where the real clicks happened. AI requests are blocked, so
// capturing never spends credits.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickButton, EDITOR_URL, openEditor, step } from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const W = 1600;
const H = 900;

class Recorder {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.frame = 0;
    this.clicks = [];
    this.dir = path.join(here, "out", name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async shoot() {
    const file = path.join(this.dir, `f${String(this.frame).padStart(4, "0")}.jpg`);
    await this.page.screenshot({ path: file, type: "jpeg", quality: 92 });
    this.frame++;
  }

  /** Record `n` frames, advancing the page clock one frame before each. */
  async hold(n) {
    for (let i = 0; i < n; i++) {
      await step(this.page);
      await this.shoot();
    }
  }

  async centerOf(selector) {
    const box = await this.page.evaluate((selector) => {
      const el = typeof selector === "string" ? document.querySelector(selector) : null;
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, selector);
    if (!box) throw new Error(`Nothing at ${selector}`);
    return box;
  }

  /** Log a click for the cursor overlay, glide time included, then perform it. */
  async click(point, act, travel = 14) {
    await this.hold(travel);
    this.clicks.push({ at: this.frame, x: +(point.x / W).toFixed(4), y: +(point.y / H).toFixed(4) });
    await act();
    await this.hold(1);
  }

  async clickSelector(selector, travel) {
    const p = await this.centerOf(selector);
    await this.click(p, () => this.page.mouse.click(p.x, p.y), travel);
  }

  async clickLabel(label, travel) {
    const p = await this.page.evaluate((label) => {
      const el = [...document.querySelectorAll("button, [role=tab]")].find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && [b.getAttribute("aria-label"), b.getAttribute("title"), b.textContent.trim()].includes(label);
      });
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, label);
    if (!p) throw new Error(`No button "${label}"`);
    await this.click(p, () => clickButton(this.page, label), travel);
  }

  async clickText(text, travel) {
    const p = await this.page.evaluate((text) => {
      const el = [...document.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.trim() === text && e.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, text);
    if (!p) throw new Error(`No text "${text}"`);
    await this.click(p, () => this.page.mouse.click(p.x, p.y), travel);
  }

  /** Type like a person: `perFrame` characters per frame. */
  async type(text, perFrame = 2) {
    for (let i = 0; i < text.length; i += perFrame) {
      // Inserted text, not key presses: the script editor auto-indents on Enter.
      for (const ch of text.slice(i, i + perFrame)) await this.page.keyboard.sendCharacter(ch);
      await this.hold(1);
    }
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this.hold(1);
  }

  finish() {
    const clipsDir = path.join(root, "public", "clips");
    fs.mkdirSync(clipsDir, { recursive: true });
    const mp4 = path.join(clipsDir, `${this.name}.mp4`);
    const q = (p) => `"${p}"`;
    execSync(
      `npx remotion ffmpeg -y -loglevel error -framerate 30 -i ${q(path.join(this.dir, "f%04d.jpg"))} ` +
        `-c:v libx264 -pix_fmt yuv420p -crf 14 -movflags +faststart ${q(mp4)}`,
      { cwd: root, stdio: "inherit" },
    );
    const metaDir = path.join(root, "src", "clips");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, `${this.name}.json`),
      JSON.stringify({ frames: this.frame, clicks: this.clicks }, null, 2) + "\n",
    );
    console.log(`${this.name}: ${this.frame} frames, ${this.clicks.length} clicks -> public/clips/${this.name}.mp4`);
  }
}

async function freshEditor() {
  const { browser, page } = await openEditor({ width: W, height: H, scale: 1.2 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().includes("/api/ai/chat") ? r.abort() : r.continue()));
  await page.goto(EDITOR_URL, { waitUntil: "networkidle0" });
  await step(page, 10);
  await (await page.$("input[type=file]")).uploadFile(path.join(here, "minigolf.json"));
  await new Promise((r) => setTimeout(r, 500));
  await step(page, 15);
  return { browser, page };
}

const CLIPS = {
  /** Plain-English commands in the console build and change objects live. */
  async command(rec) {
    await rec.hold(8);
    await rec.clickSelector('input[aria-label="Run a script command"]', 12);
    await rec.type('create a purple ball at 0 2 2 called "Bouncy"');
    await rec.press("Enter");
    await rec.hold(24);
    await rec.type("paint Bouncy yellow");
    await rec.press("Enter");
    await rec.hold(20);
    await rec.type("move Bouncy up 1");
    await rec.press("Enter");
    await rec.hold(36);
  },

  /** Press Play: the ball rolls under the windmill and into the hole. */
  async play(rec) {
    await rec.hold(8);
    await rec.clickLabel("Play", 16);
    await rec.hold(150);
  },

  /** A sloppy script typed into the real editor, fixed by Parse. */
  async script(rec) {
    await rec.hold(6);
    await rec.clickText("Ball", 14);
    await rec.hold(4);
    await rec.clickLabel("Open the selected object's script (or a scene script)", 14);
    await rec.hold(8);
    await rec.clickSelector("textarea", 10);
    await rec.page.keyboard.down("Control");
    await rec.page.keyboard.press("a");
    await rec.page.keyboard.up("Control");
    await rec.page.keyboard.press("Backspace");
    await rec.hold(4);
    await rec.type("when game begin\n  wiat 2 secs\n  spin me fsat\nwhen I tuch Hole\n  say \"Hole in one!\"", 2);
    await rec.hold(14);
    await rec.clickSelector("button.parse", 14);
    await rec.hold(40);
    await rec.clickLabel("Use rewrite", 16);
    await rec.hold(36);
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
for (const name of wanted) {
  const { browser, page } = await freshEditor();
  const rec = new Recorder(page, name);
  try {
    await CLIPS[name](rec);
    rec.finish();
  } finally {
    await browser.close();
  }
}
