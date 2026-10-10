import { describe, expect, it } from "vitest";
import { renderStandaloneHtml } from "../../src/export/html-template";
import { createEmptyScene } from "../../src/scene/types";

describe("standalone HTML export", () => {
  it("inlines scene data and the renderer runtime in a single offline document", () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "cube", name: "Offline cube", parent: null, components: { Transform: {}, Mesh: { shape: "box" } } });
    const html = renderStandaloneHtml(scene, "function startStandalone(scene) { window.__exportedScene = scene; }");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Offline cube");
    expect(html).toContain("function startStandalone(scene)");
    expect(html).toContain("id=\"controls\"");
    expect(html).not.toContain("src=\"https://");
  });

  it("escapes inline scene data against script tag termination", () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "unsafe", name: "</script><script>alert(1)</script>", parent: null, components: { Transform: {} } });
    const html = renderStandaloneHtml(scene, "function startStandalone(scene) {};");
    expect(html).not.toContain("</script><script>alert");
  });
});
