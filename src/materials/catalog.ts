/** Small metadata only: image bytes stay outside JavaScript and load on demand. */
import type { Scene } from "../scene/types";
export const SURFACE_TEXTURES = [
  { id: "bricks", label: "Bricks", asset: "Bricks104", description: "brick walls and masonry", normal: true },
  { id: "grass", label: "Grass", asset: "Grass001", description: "lawns and grassy terrain", normal: true },
  { id: "ground", label: "Ground", asset: "Ground097", description: "soil, dirt paths and terrain", normal: true },
  { id: "metal", label: "Metal", asset: "Metal049A", description: "bare metal panels and machinery", normal: false, metalness: true },
  { id: "paper", label: "Paper", asset: "Paper006", description: "paper sheets and cardboard", normal: false },
  { id: "paving_stones", label: "Paving stones", asset: "PavingStones138", description: "paved paths, patios and plazas", normal: true },
  { id: "rock", label: "Rock", asset: "Rock064", description: "stone, cliffs and boulders", normal: true },
  { id: "wood", label: "Wood", asset: "Wood092", description: "wooden furniture, beams and boards", normal: true },
  { id: "wood_floor", label: "Wood floor", asset: "WoodFloor051", description: "wooden plank flooring", normal: true }
] as const;

export type SurfaceTextureId = typeof SURFACE_TEXTURES[number]["id"];
export type TextureMap = "Color" | "NormalGL" | "Roughness" | "Metalness";
export type TextureAssets = Record<string, string>;

export function surfaceTexture(value: unknown) {
  return SURFACE_TEXTURES.find((texture) => texture.id === value);
}

export function texturePaths(value: unknown): Partial<Record<TextureMap, string>> {
  const texture = surfaceTexture(value);
  if (!texture) return {};
  const path = (map: TextureMap) => `textures/${texture.asset}_${map}.webp`;
  return { Color: path("Color"), Roughness: path("Roughness"),
    ...(texture.normal ? { NormalGL: path("NormalGL") } : {}),
    ...("metalness" in texture ? { Metalness: path("Metalness") } : {}) };
}

export function textureUrl(path: string): string {
  return `${import.meta.env.BASE_URL ?? "/"}${path}`;
}

/** Include animation choices; scripts can select any library texture dynamically. */
export function sceneTexturePaths(scene: Scene): string[] {
  const ids = new Set<unknown>();
  for (const entity of scene.entities) {
    ids.add(entity.components.Material?.texture);
    const source = entity.components.Script?.source;
    if (typeof source === "string" && /\.material\.texture\b/i.test(source)) {
      SURFACE_TEXTURES.forEach((texture) => ids.add(texture.id));
    }
    const tracks = entity.components.Animator?.tracks;
    if (Array.isArray(tracks)) for (const track of tracks) {
      if (track.component === "Material" && track.field === "texture" && Array.isArray(track.keys)) {
        track.keys.forEach((key: { value?: unknown }) => ids.add(key.value));
      }
    }
  }
  return [...new Set([...ids].flatMap((id) => Object.values(texturePaths(id))))];
}

export const TEXTURE_AGENT_SPEC = `## Surface textures
Material.texture: none (plain), ${SURFACE_TEXTURES.map((texture) => texture.id).join(", ")}; no URLs.
textureRepeatX/Y: UV tiling, not meters. One material covers all faces. Color tints; #ffffff keeps image colors. Maps load on demand; roughness=1 preserves map, metalness=1 for bare metal. Preserve unrelated textures. Script examples: self.Material.texture = "wood"; self.Material.textureRepeatX = 4.`;
