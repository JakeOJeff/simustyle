// Browser entry for `npm run ai:eval` critiques: renders one scene with the editor's own offscreen critique
// renderer (src/ai/snapshot.ts) and sets window.__critiqueImages.
import { renderCritiqueImages } from "../../src/ai/snapshot";
import type { CritiqueImages } from "../../src/ai/critique";
import type { Scene } from "../../src/scene/types";

declare global {
  interface Window { __scene: Scene; __critiqueImages?: CritiqueImages; __renderError?: string }
}

renderCritiqueImages(window.__scene)
  .then((images) => { window.__critiqueImages = images; })
  .catch((error: unknown) => { window.__renderError = error instanceof Error ? error.message : String(error); });
