import standaloneRuntime from "virtual:simustyle-standalone-runtime";
import { renderStandaloneHtml } from "./html-template";
import type { Scene } from "../scene/types";
import { embedSceneTextures } from "../materials/embed";

/** Creates a self-contained web scene; all renderer, controls, and shared runtime code is inlined. */
export async function createStandaloneHtml(scene: Scene): Promise<string> {
  return renderStandaloneHtml(scene, standaloneRuntime, await embedSceneTextures(scene));
}

export async function downloadStandaloneHtml(scene: Scene, filename = "simustyle-scene.html"): Promise<void> {
  const url = URL.createObjectURL(new Blob([await createStandaloneHtml(scene)], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
