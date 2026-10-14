import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SurfaceTextureStore } from "../../src/materials/textures";
import { SURFACE_TEXTURES, texturePaths, materialTexturePaths, sceneTexturePaths, TEXTURE_AGENT_SPEC, TEXTURE_AGENT_RULES } from "../../src/materials/catalog";
import { createEmptyScene } from "../../src/scene/types";
import { applyOps } from "../../src/scene/applyOps";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { buildResponseJsonSchema, buildSystemPrompt } from "../../src/ai/prompt";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { createThreeScene } from "../../src/export/gltf";
import { renderStandaloneHtml } from "../../src/export/html-template";
import { buildParseMessages } from "../../src/ai/scriptParse";
import { sceneText } from "../../src/ai/sceneContext";
import { existsSync, statSync } from "node:fs";

function mockLoader() {
  const pending: { texture: THREE.Texture; loaded: () => void; failed: () => void }[] = [];
  const load = vi.fn((_url, loaded, _progress, failed) => {
    const texture = new THREE.Texture();
    pending.push({ texture, loaded, failed });
    return texture;
  });
  const finish = () => pending.forEach((entry) => { entry.texture.image = { width: 512, height: 512 }; entry.loaded(); });
  return { loader: { load } as unknown as THREE.TextureLoader, load, pending, finish };
}

function texturedScene() {
  const scene = createEmptyScene();
  scene.entities.push({ id: "floor", name: "Floor", parent: null, components: {
    Transform: {}, Mesh: { shape: "plane" }, Material: { texture: "wood_floor", textureMapping: "custom", textureRepeatX: 4, textureRepeatY: 2 }
  } });
  return scene;
}

describe("lightweight surface textures", () => {
  it("ships every catalog map under one MiB and includes no unused maps", () => {
    const paths = SURFACE_TEXTURES.flatMap((entry) => Object.values(texturePaths(entry.id)));
    expect(SURFACE_TEXTURES).toHaveLength(9);
    expect(paths.every((path) => existsSync(`public/${path}`))).toBe(true);
    expect(paths.reduce((bytes, path) => bytes + statSync(`public/${path}`).size, 0)).toBeLessThan(1024 * 1024);
    expect(texturePaths("paper").NormalGL).toBeUndefined();
    expect(texturePaths("metal").Metalness).toBeDefined();
    expect(texturePaths("invented")).toEqual({});
  });

  it("loads nothing for plain surfaces; shares identical tiling and isolates variants", async () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial(), c = new THREE.MeshStandardMaterial();
    store.sync(a, {});
    expect(mock.load).not.toHaveBeenCalled();
    store.sync(a, { texture: "wood", textureMapping: "custom", textureRepeatX: 4, textureRepeatY: 2 });
    store.sync(b, { texture: "wood", textureMapping: "custom", textureRepeatX: 4, textureRepeatY: 2 });
    store.sync(c, { texture: "wood", textureRepeatX: 1 });
    expect(mock.load).toHaveBeenCalledTimes(3);
    expect(a.map).toBe(b.map);
    expect(c.map).not.toBe(a.map);
    expect(c.map?.source).toBe(a.map?.source);
    expect(a.map?.repeat.toArray()).toEqual([4, 2]);
    expect(c.map?.repeat.toArray()).toEqual([1, 1]);
    expect(a.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(a.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(a.roughnessMap?.wrapS).toBe(THREE.RepeatWrapping);
    mock.finish();
    await store.ready();
    expect(a.map?.image).toMatchObject({ width: 512 });
    store.dispose();
  });

  it("reuses loaded images through tiling changes and releases only the last reference", async () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    store.sync(a, { texture: "bricks" });
    mock.finish(); await store.ready();
    store.sync(a, { texture: "bricks", textureMapping: "custom", textureRepeatX: 8 });
    expect(mock.load).toHaveBeenCalledTimes(3);
    expect(a.map?.repeat.x).toBe(8);
    store.sync(b, { texture: "bricks", textureMapping: "custom", textureRepeatX: 8 });
    const dispose = vi.spyOn(a.map!, "dispose");
    const sourceDispose = vi.spyOn(mock.pending[0]!.texture, "dispose");
    store.release(a);
    expect(dispose).not.toHaveBeenCalled();
    expect(b.map).not.toBeNull();
    store.sync(b, { texture: "none" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).toHaveBeenCalledTimes(1);
    expect(b.map).toBeNull(); expect(b.normalMap).toBeNull(); expect(b.roughnessMap).toBeNull();
  });

  it("loads embedded maps exclusively and reports export failures", async () => {
    const mock = mockLoader();
    const assets = Object.fromEntries(Object.values(texturePaths("metal")).map((path) => [path, "data:image/webp;base64,test"]));
    const store = new SurfaceTextureStore(assets, mock.loader);
    const material = new THREE.MeshStandardMaterial();
    store.sync(material, { texture: "metal" });
    expect(mock.load.mock.calls.every(([url]) => url.startsWith("data:"))).toBe(true);
    expect(material.metalnessMap).not.toBeNull();
    expect(material.normalMap).toBeNull();
    const ready = expect(store.ready()).rejects.toThrow("Could not load surface texture");
    mock.pending[0]!.failed();
    await ready;
    store.dispose();
    expect(() => new SurfaceTextureStore({}, mock.loader).sync(material, { texture: "wood" })).toThrow("Missing embedded texture");
  });
});

describe("mapping modes and normal strength", () => {
  it("supports a normal-only material and embeds only its normal map", () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const material = new THREE.MeshStandardMaterial();
    const fields = { normalTexture: "bricks", normalStrength: 8, textureMapping: "custom", textureRepeatX: 4 };
    store.sync(material, fields);
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.load.mock.calls[0]![0]).toContain("Bricks104_NormalGL.webp");
    expect(material.map).toBeNull(); expect(material.roughnessMap).toBeNull();
    expect(material.normalMap).not.toBeNull();
    expect(material.normalMapType).toBe(THREE.TangentSpaceNormalMap);
    expect(material.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.normalMap?.repeat.toArray()).toEqual([4, 1]);
    expect(material.normalScale.toArray()).toEqual([8, 8]);
    const scene = createEmptyScene();
    scene.entities.push({ id: "surface", name: "Surface", parent: null, components: { Transform: {}, Mesh: {}, Material: fields } });
    expect(sceneTexturePaths(scene)).toEqual(["textures/Bricks104_NormalGL.webp"]);
    expect(sceneText(scene)).toContain("normalMap=bricks");
    store.dispose();
  });

  it("selects a different normal and switches it off without reloading the color maps", () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const material = new THREE.MeshStandardMaterial();
    store.sync(material, { texture: "wood", normalTexture: "rock" });
    expect(mock.load).toHaveBeenCalledTimes(3);
    expect(mock.load.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      expect.stringContaining("Wood092_Color"), expect.stringContaining("Wood092_Roughness"), expect.stringContaining("Rock064_NormalGL")
    ]));
    const color = material.map, roughness = material.roughnessMap;
    const dispose = vi.spyOn(material.normalMap!, "dispose");
    store.sync(material, { texture: "wood", normalTexture: "none" });
    expect(material.map).toBe(color); expect(material.roughnessMap).toBe(roughness);
    expect(material.normalMap).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
    expect(mock.load).toHaveBeenCalledTimes(3);
    expect(materialTexturePaths({ texture: "wood", normalTexture: "none" }).NormalGL).toBeUndefined();
    store.dispose();
  });

  it("uploads a loaded normal independently when another map fails", async () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const material = new THREE.MeshStandardMaterial();
    store.sync(material, { texture: "bricks" });
    const index = mock.load.mock.calls.findIndex(([path]) => path.includes("NormalGL"));
    const version = material.normalMap!.version;
    const waiting = expect(store.ready()).rejects.toThrow("Could not load");
    mock.pending[0]!.failed();
    const normal = mock.pending[index]!;
    normal.texture.image = { width: 512, height: 512 };
    normal.loaded();
    expect(material.normalMap!.version).toBeGreaterThan(version);
    expect(material.normalMap?.image).toMatchObject({ width: 512 });
    await waiting;
    store.dispose();
  });

  it("changes normal strength per material without reloading its maps", () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    store.sync(a, { texture: "bricks", normalStrength: 2 });
    store.sync(b, { texture: "bricks" });
    expect(a.normalMap).toBe(b.normalMap);
    expect(a.normalScale.toArray()).toEqual([2, 2]);
    expect(b.normalScale.toArray()).toEqual([1, 1]);
    store.sync(a, { texture: "bricks", normalStrength: 0 });
    expect(a.normalScale.toArray()).toEqual([0, 0]);
    expect(a.normalMap).not.toBeNull();
    expect(mock.load).toHaveBeenCalledTimes(3);
    store.dispose();
  });

  it("uses a single tile in stretch/auto and restores saved counts in custom", () => {
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const material = new THREE.MeshStandardMaterial();
    const fields = { texture: "wood", textureRepeatX: 6, textureRepeatY: 3 };
    store.sync(material, fields);
    expect(material.map?.repeat.toArray()).toEqual([1, 1]);
    store.sync(material, { ...fields, textureMapping: "custom" });
    expect(material.map?.repeat.toArray()).toEqual([6, 3]);
    store.sync(material, { ...fields, textureMapping: "stretch" });
    expect(material.map?.repeat.toArray()).toEqual([1, 1]);
    expect(mock.load).toHaveBeenCalledTimes(3);
    store.dispose();
  });
});

describe("textures across scenes, agents and exports", () => {
  it("round-trips texture ids and tiling, accepts older scenes and validates undoable updates", () => {
    const scene = texturedScene();
    expect(deserializeScene(serializeScene(scene)).entities[0]!.components.Material).toEqual(scene.entities[0]!.components.Material);
    const applied = applyOps(scene, [{ op: "update", id: "floor", components: { Material: { texture: "grass", textureMapping: "auto", normalStrength: 2, textureRepeatX: 6 } } }]);
    expect(applied.errors).toEqual([]);
    const undo = applyOps(applied.scene, applied.inverseOps);
    expect(undo.errors).toEqual([]); expect(undo.scene).toEqual(scene);
    for (const fields of [{ texture: "missing" }, { textureMapping: "unknown" }, { normalTexture: "paper" }, { normalTexture: "missing" }, { normalStrength: -1 }, { normalStrength: 11 }, { textureRepeatX: 0 }, { textureRepeatY: 101 }]) {
      expect(applyOps(scene, [{ op: "update", id: "floor", components: { Material: fields } }]).errors.length).toBeGreaterThan(0);
    }
    scene.entities[0]!.components.Material = { color: "#ffffff" };
    expect(deserializeScene(serializeScene(scene)).entities[0]!.components.Material).toEqual({});
  });

  it("gives scene and script agents the catalog, UV/tint rules and existing texture state", () => {
    const scene = texturedScene();
    const prompt = buildSystemPrompt(scene);
    expect(prompt).toContain(TEXTURE_AGENT_RULES);
    expect(prompt).toContain('"texture":"wood_floor"');
    expect(prompt).toContain('"textureRepeatX":4');
    // Keep surface details beside the shape even when other components are large.
    scene.entities[0]!.components.Script = { source: "# " + "large script ".repeat(1000) };
    expect(sceneText(scene)).toContain("texture=wood_floor mapping=custom tiling=4x2 normal=1");
    const schema = JSON.stringify(buildResponseJsonSchema());
    for (const entry of SURFACE_TEXTURES) expect(schema).toContain(`"${entry.id}"`);
    const messages = buildParseMessages({ source: "", owner: null, entities: [{ id: "floor", name: "Floor", texture: "wood_floor" }], unclear: [] });
    expect(messages[0]!.content).toContain(TEXTURE_AGENT_SPEC);
    expect(messages[1]!.content).toContain("wood_floor");
  });

  it("runs texture and tiling assignments through the existing validated script API", () => {
    const scene = texturedScene();
    scene.entities[0]!.components.Script = { source: 'when game starts\n  self.Material.texture = "rock"\n  self.Material.normalTexture = "bricks"\n  self.Material.normalStrength = 8\n  self.Material.textureRepeatX = 3' };
    const runtime = new ScriptRuntime(scene);
    runtime.start();
    expect(runtime.takeIssues()).toEqual([]);
    expect(runtime.scene.entities[0]!.components.Material?.texture).toBe("rock");
    expect(runtime.scene.entities[0]!.components.Material?.textureRepeatX).toBe(3);
    expect(runtime.scene.entities[0]!.components.Material?.normalTexture).toBe("bricks");
    expect(runtime.scene.entities[0]!.components.Material?.normalStrength).toBe(8);
    expect(sceneTexturePaths(scene)).toHaveLength(26);
  });

  it("uses the shared texture rules in GLB and safely embeds maps in offline HTML", async () => {
    const scene = texturedScene();
    const mock = mockLoader();
    const store = new SurfaceTextureStore(undefined, mock.loader);
    const converted = createThreeScene(scene, store);
    mock.finish(); await store.ready();
    const material = (converted.getObjectByName("Floor") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(material.map?.repeat.toArray()).toEqual([4, 2]);
    expect(material.normalMap).not.toBeNull();
    const html = renderStandaloneHtml(scene, "function startStandalone(){}", { "textures/WoodFloor051_Color.webp": "data:image/webp;base64,test</script>" });
    expect(html).toContain("data:image/webp;base64,test\\u003c/script>");
    expect(html).toContain("startStandalone(scene,textureAssets)");
    expect(html).not.toContain('src="https://');
    store.dispose();
  });
});
