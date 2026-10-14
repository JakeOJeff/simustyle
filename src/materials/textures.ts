import * as THREE from "three";
import { surfaceTexture, texturePaths, textureUrl, type TextureAssets, type TextureMap } from "./catalog";

type Maps = Partial<Record<TextureMap, THREE.Texture>>;
type Source = { maps: Maps; ready: Promise<void>; variants: number };
type Variant = { id: string; maps: Maps; references: number };
const slots = { Color: "map", NormalGL: "normalMap", Roughness: "roughnessMap", Metalness: "metalnessMap" } as const;

/** Share image sources and identical tiling, release GPU resources when the last user leaves. */
export class SurfaceTextureStore {
  private sources = new Map<string, Source>();
  private variants = new Map<string, Variant>();
  private materials = new Map<THREE.MeshStandardMaterial, string>();

  constructor(private assets?: TextureAssets, private loader = new THREE.TextureLoader()) {}

  sync(material: THREE.MeshStandardMaterial, fields: Record<string, unknown>): void {
    const texture = surfaceTexture(fields.texture);
    const strength = typeof fields.normalStrength === "number" ? Math.max(0, Math.min(3, fields.normalStrength)) : 1;
    material.normalScale.set(strength, strength);
    const repeat = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0.1, Math.min(100, value)) : 1;
    const custom = fields.textureMapping === "custom";
    const x = custom ? repeat(fields.textureRepeatX) : 1, y = custom ? repeat(fields.textureRepeatY) : 1;
    const key = texture ? `${texture.id}:${x}:${y}` : undefined;
    if (this.materials.get(material) === key) return;
    if (!texture || !key) { this.release(material); return; }
    let variant = this.variants.get(key);
    if (!variant) {
      let source = this.sources.get(texture.id);
      if (!source) {
        const maps: Maps = {};
        const pending = Object.entries(texturePaths(texture.id)).map(([map, path]) => {
          const kind = map as TextureMap;
          // Embedded exports must never fall back to a network request.
          const url = this.assets ? this.assets[path] : textureUrl(path);
          if (!url) throw new Error(`Missing embedded texture: ${path}`);
          return new Promise<void>((resolve, reject) => {
            maps[kind] = this.loader.load(url, () => resolve(), undefined, () => reject(new Error(`Could not load surface texture: ${path}`)));
            maps[kind]!.colorSpace = kind === "Color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            maps[kind]!.wrapS = maps[kind]!.wrapT = THREE.RepeatWrapping;
          });
        });
        source = { maps, ready: Promise.all(pending).then(() => {
          // Clones share Source; mark them ready when the underlying images arrive.
          for (const entry of this.variants.values()) if (entry.maps.Color?.source === maps.Color?.source) {
            Object.values(entry.maps).forEach((map) => { map.needsUpdate = true; });
          }
        }), variants: 0 };
        // Viewport updates are synchronous; exports explicitly await ready() and report failures.
        void source.ready.catch(() => {});
        this.sources.set(texture.id, source);
      }
      const maps: Maps = {};
      for (const [map, original] of Object.entries(source.maps)) {
        const clone = original.clone();
        clone.repeat.set(x, y);
        maps[map as TextureMap] = clone;
      }
      source.variants++;
      variant = { id: texture.id, maps, references: 0 };
      this.variants.set(key, variant);
    }
    variant.references++;
    // Acquire first so changing the last material's tiling keeps its images alive.
    this.release(material);
    this.materials.set(material, key);
    for (const [map, slot] of Object.entries(slots)) material[slot] = variant.maps[map as TextureMap] ?? null;
    material.needsUpdate = true;
  }

  release(material: THREE.MeshStandardMaterial): void {
    const key = this.materials.get(material);
    if (!key) return;
    this.materials.delete(material);
    for (const slot of Object.values(slots)) material[slot] = null;
    material.needsUpdate = true;
    const variant = this.variants.get(key)!;
    if (--variant.references > 0) return;
    Object.values(variant.maps).forEach((map) => map.dispose());
    this.variants.delete(key);
    const source = this.sources.get(variant.id)!;
    if (--source.variants > 0) return;
    Object.values(source.maps).forEach((map) => map.dispose());
    this.sources.delete(variant.id);
  }

  async ready(): Promise<void> {
    await Promise.all([...this.sources.values()].map((source) => source.ready));
  }

  dispose(): void {
    for (const material of [...this.materials.keys()]) this.release(material);
  }
}
