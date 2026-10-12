// Loads minigolf.json into the editor, presses Play and saves a few frames, to check the scene.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickButton, EDITOR_URL, openEditor, step } from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? ".";
const { browser, page } = await openEditor();
await page.goto(EDITOR_URL, { waitUntil: "networkidle0" });
await step(page, 10);

const input = await page.$("input[type=file]");
await input.uploadFile(path.join(here, "minigolf.json"));
await new Promise((r) => setTimeout(r, 500));
await step(page, 10);
console.log("status:", await page.evaluate(() => document.body.innerText.match(/(Opened[^\n]*|invalid[^\n]*|Unable[^\n]*)/i)?.[0]));
await page.screenshot({ path: `${outDir}/scene-0.png` });

await clickButton(page, "Play");
for (let i = 1; i <= 4; i++) {
  await step(page, 20);
  await page.screenshot({ path: `${outDir}/scene-${i}.png` });
}
console.log(await page.evaluate(() => document.querySelector(".console-log, [class*=console]")?.innerText.slice(0, 400)));
await browser.close();
