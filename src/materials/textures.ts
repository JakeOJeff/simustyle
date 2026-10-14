import * as THREE from "three";
import { materialTexturePaths, textureUrl, type TextureAssets, type TextureMap } from "./catalog";

type Source = { texture: THREE.Texture; ready: Promise<void>; variants: number };
type Variant = { path: string; texture: THREE.Texture; references: number };
type Binding = { key: string; maps: Partial<Record<TextureMap, string>> };
const slots = { Color: "map", NormalGL: "normalMap", Roughness: "roughnessMap", Metalness: "metalnessMap" } as const;

/** Share individual image sources, so an independent normal needs only its own map. */
export class SurfaceTextureStore {
  private sources = new Map<string, Source>();
  private variants = new Map<string, Variant>();
  private materials = new Map<THREE.MeshStandardMaterial, Binding>();

  constructor(private assets?: TextureAssets, private loader = new THREE.TextureLoader()) {}

  sync(material: THREE.MeshStandardMaterial, fields: Record<string, unknown>): void {
    const strength = typeof fields.normalStrength === "number" && Number.isFinite(fields.normalStrength) ? Math.max(0, Math.min(10, fields.normalStrength)) : 1;
    material.normalScale.set(strength, strength);
    material.normalMapType = THREE.TangentSpaceNormalMap;
    const repeat = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0.1, Math.min(100, value)) : 1;
    const custom = fields.textureMapping === "custom";
    const x = custom ? repeat(fields.textureRepeatX) : 1, y = custom ? repeat(fields.textureRepeatY) : 1;
    const paths = materialTexturePaths(fields);
    const key = JSON.stringify([paths, x, y]);
    if (this.materials.get(material)?.key === key) return;
    const entries = Object.entries(paths) as [TextureMap, string][];
    if (!entries.length) { this.release(material); return; }
    // Validate an embedded export before allocating any partial bundle.
    if (this.assets) for (const [, path] of entries) if (!this.assets[path]) throw new Error(`Missing embedded texture: ${path}`);
    const maps: Binding["maps"] = {};
    for (const [kind, path] of entries) {
      const variantKey = `${path}:${x}:${y}`;
      let variant = this.variants.get(variantKey);
      if (!variant) {
        let source = this.sources.get(path);
        if (!source) {
          let loaded!: () => void, failed!: (error: Error) => void;
          const ready = new Promise<void>((resolve, reject) => { loaded = resolve; failed = reject; });
          const original = this.loader.load(this.assets?.[path] ?? textureUrl(path), () => {
            // Each image wakes its own clones even if another map fails or is delayed.
            for (const entry of this.variants.values()) if (entry.texture.source === original.source) entry.texture.needsUpdate = true;
            loaded();
          }, undefined, () => failed(new Error(`Could not load surface texture: ${path}`)));
          original.colorSpace = kind === "Color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          original.wrapS = original.wrapT = THREE.RepeatWrapping;
          source = { texture: original, ready, variants: 0 };
          void ready.catch(() => {});
          this.sources.set(path, source);
        }
        const texture = source.texture.clone();
        texture.repeat.set(x, y);
        source.variants++;
        variant = { path, texture, references: 0 };
        this.variants.set(variantKey, variant);
      }
      variant.references++;
      maps[kind] = variantKey;
    }
    // Acquire first so changing tiling or normal selection keeps shared maps alive.
    this.release(material);
    this.materials.set(material, { key, maps });
    for (const [kind, slot] of Object.entries(slots)) {
      const variantKey = maps[kind as TextureMap];
      material[slot] = variantKey ? this.variants.get(variantKey)!.texture : null;
    }
    material.needsUpdate = true;
  }

  release(material: THREE.MeshStandardMaterial): void {
    const binding = this.materials.get(material);
    if (!binding) return;
    this.materials.delete(material);
    for (const slot of Object.values(slots)) material[slot] = null;
    material.needsUpdate = true;
    for (const key of Object.values(binding.maps)) {
      const variant = this.variants.get(key)!;
      if (--variant.references > 0) continue;
      variant.texture.dispose();
      this.variants.delete(key);
      const source = this.sources.get(variant.path)!;
      if (--source.variants > 0) continue;
      source.texture.dispose();
      this.sources.delete(variant.path);
    }
  }

  async ready(): Promise<void> {
    await Promise.all([...this.sources.values()].map((source) => source.ready));
  }

  dispose(): void {
    for (const material of [...this.materials.keys()]) this.release(material);
  }
}
