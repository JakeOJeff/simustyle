// Opens the editor, screenshots it, and lists the clickable controls. Used to script capture.mjs.
import { EDITOR_URL, openEditor, step } from "./browser.mjs";

const out = process.argv[2] ?? "probe.png";
const { browser, page } = await openEditor();
await page.goto(EDITOR_URL, { waitUntil: "networkidle0" });
await step(page, 30);
await page.screenshot({ path: out });
const controls = await page.evaluate(() =>
  [...document.querySelectorAll("button, [role=tab], input, select, textarea, [contenteditable]")]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.trim().slice(0, 40) || el.getAttribute("placeholder") || "";
      return `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""} "${label}" @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    }),
);
console.log(controls.join("\n"));
await browser.close();
