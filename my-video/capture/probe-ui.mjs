// Tries the command bar and the script editor on the mini-golf scene, to script capture.mjs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickButton, EDITOR_URL, openEditor, step } from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? ".";
const { browser, page } = await openEditor();
await page.setRequestInterception(true);
page.on("request", (r) => (r.url().includes("/api/ai/chat") ? r.abort() : r.continue()));
await page.goto(EDITOR_URL, { waitUntil: "networkidle0" });
await step(page, 10);
await (await page.$("input[type=file]")).uploadFile(path.join(here, "minigolf.json"));
await new Promise((r) => setTimeout(r, 500));
await step(page, 10);

await page.click('input[aria-label="Run a script command"], input[placeholder*="move box"]');
await page.keyboard.type('create a purple ball at 0 2 2 called "Bouncy"');
await page.keyboard.press("Enter");
await step(page, 10);
await page.keyboard.type("make Bouncy bounce");
await page.keyboard.press("Enter");
await step(page, 30);
await page.screenshot({ path: `${outDir}/ui-command.png` });

await page.evaluate(() => {
  const row = [...document.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent.trim() === "Ball");
  row?.click();
});
await step(page, 5);
await clickButton(page, "Open the selected object's script (or a scene script)");
await step(page, 10);
await page.screenshot({ path: `${outDir}/ui-script.png` });
const controls = await page.evaluate(() =>
  [...document.querySelectorAll("button, textarea, [contenteditable], .cm-content")]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 30)} "${label}" @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    })
    .filter((s) => /script|parse|textarea|editor|Parse|✦/i.test(s)),
);
console.log(controls.join("\n"));
await browser.close();
