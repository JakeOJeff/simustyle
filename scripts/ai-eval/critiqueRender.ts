// Browser entry for `npm run ai:eval` inspections: renders the views window.__request asks for with the editor's
// own offscreen renderer (src/ai/snapshot.ts) and sets window.__views.
import { renderViews } from "../../src/ai/snapshot";
import type { RenderedView } from "../../src/ai/critique";
import type { ViewName } from "../../src/ai/framing";
import type { Scene } from "../../src/scene/types";

declare global {
  interface Window { __scene: Scene; __request: { ids: string[] | null; views: ViewName[] }; __views?: RenderedView[]; __renderError?: string }
}

renderViews(window.__scene, window.__request.ids, window.__request.views)
  .then((views) => { window.__views = views; })
  .catch((error: unknown) => { window.__renderError = error instanceof Error ? error.message : String(error); });
