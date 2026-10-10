import standaloneRuntime from "virtual:simustyle-standalone-runtime";
import { renderStandaloneHtml } from "./html-template";
import type { Scene } from "../scene/types";

/** Creates a self-contained web scene; all renderer, controls, and shared runtime code is inlined. */
export function createStandaloneHtml(scene: Scene): string {
  return renderStandaloneHtml(scene, standaloneRuntime);
}

export function downloadStandaloneHtml(scene: Scene, filename = "simustyle-scene.html"): void {
  const url = URL.createObjectURL(new Blob([createStandaloneHtml(scene)], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
