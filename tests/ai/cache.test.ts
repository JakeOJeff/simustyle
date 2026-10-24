import { describe, expect, it, vi } from "vitest";
import { BuildCache } from "../../src/ai/cache";
import { runSceneAgent, type SceneAgentReply } from "../../src/ai/agent";
import { createEmptyScene } from "../../src/scene/types";

describe("bounded session caching", () => {
  it("expires and evicts LRU entries, isolates returned values, and clears explicitly", () => {
    let time = 0;
    const cache = new BuildCache<{ count: number }>(2, 100, () => time);
    const value = { count: 1 };
    cache.set("a", value); value.count = 9;
    cache.set("b", { count: 2 });
    const copy = cache.get("a")!; copy.count = 8;
    cache.set("c", { count: 3 });
    expect(cache.get("a")).toEqual({ count: 1 });
    expect(cache.get("b")).toBeUndefined();
    time = 100;
    expect(cache.get("a")).toBeUndefined();
    cache.set("d", { count: 4 }); cache.clear();
    expect(cache.get("d")).toBeUndefined();
  });

  it("reuses only reviewed builds with matching scene, style, prompt and schema", async () => {
    const scene = createEmptyScene();
    const cache = new BuildCache<SceneAgentReply>();
    const reply: SceneAgentReply = { summary: "Built a cube.", ops: [{ op: "create", id: "cube", name: "Cube", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] };
    const complete = vi.fn(async () => reply);
    const dependencies = { cache, buildSystemPrompt: () => "prompt", responseSchema: {}, complete, previousRequests: ["Use warm colors"] };
    const first = await runSceneAgent(scene, "build a cube", dependencies);
    expect(first.ok).toBe(true);
    expect(first.attempts).toBe(2);
    const reused = await runSceneAgent(scene, "build a cube", dependencies);
    expect(reused.cacheHit).toBe(true);
    expect(reused.attempts).toBe(0);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(reused.scene).toEqual(first.scene);
    expect(reused.scene).not.toBe(first.scene);
    expect(reused.preflight?.quality).toBeDefined();
    expect(dependencies.complete.mock.calls[0]).toBeDefined();
    await runSceneAgent(scene, "build a cube", { ...dependencies, previousRequests: ["Use icy colors"] });
    await runSceneAgent(scene, "build a cube", { ...dependencies, responseSchema: { changed: true } });
    await runSceneAgent({ ...scene, settings: { ...scene.settings, background: "#ffffff" } }, "build a cube", dependencies);
    await runSceneAgent(scene, "build a blue cube", dependencies);
    expect(complete).toHaveBeenCalledTimes(10);
  });

  it("never caches a rejected build or an unreviewed fallback", async () => {
    const cache = new BuildCache<SceneAgentReply>();
    const complete = vi.fn(async () => ({ summary: "Invalid", ops: [{ op: "delete", id: "missing" }] }));
    const dependencies = { cache, buildSystemPrompt: () => "prompt", responseSchema: {}, complete, maxRetries: 0 };
    await runSceneAgent(createEmptyScene(), "build", dependencies);
    await runSceneAgent(createEmptyScene(), "build", dependencies);
    expect(complete).toHaveBeenCalledTimes(2);
    const valid: SceneAgentReply = { summary: "No change", ops: [] };
    const fallback = vi.fn().mockResolvedValueOnce(valid).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(valid).mockRejectedValueOnce(new Error("offline"));
    const deps = { ...dependencies, complete: fallback };
    expect((await runSceneAgent(createEmptyScene(), "build", deps)).ok).toBe(true);
    expect((await runSceneAgent(createEmptyScene(), "build", deps)).cacheHit).not.toBe(true);
    expect(fallback).toHaveBeenCalledTimes(4);
  });
});
