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
export type TextureMap = "Color" | "NormalGL" | "Roughness" | "Metalness" | "Detail";
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
    ...(texture.normal ? { Detail: path("Detail") } : {}),
    ...("metalness" in texture ? { Metalness: path("Metalness") } : {}) };
}

export function textureUrl(path: string): string {
  return `${import.meta.env.BASE_URL ?? "/"}${path}`;
}

export function normalTexture(fields: Record<string, unknown>) {
  const texture = surfaceTexture(!fields.normalTexture || fields.normalTexture === "auto" ? fields.texture : fields.normalTexture);
  return texture?.normal ? texture : undefined;
}

/** Normal detail can be selected independently, including on a plain colored mesh. */
export function materialTexturePaths(fields: Record<string, unknown>): Partial<Record<TextureMap, string>> {
  const { NormalGL: _normal, Detail: _detail, ...surface } = texturePaths(fields.texture);
  const normal = normalTexture(fields);
  const detail = normal ?? surfaceTexture(fields.texture);
  const detailPath = texturePaths(detail?.id).Detail;
  const useDetail = fields.reliefDepth !== 0 || fields.occlusionStrength !== 0;
  return { ...surface, ...(normal ? { NormalGL: texturePaths(normal.id).NormalGL } : {}), ...(useDetail && detailPath ? { Detail: detailPath } : {}) };
}

/** Include animation choices; scripts can select any library texture dynamically. */
export function sceneTexturePaths(scene: Scene): string[] {
  const paths = new Set<string>();
  const add = (fields: Record<string, unknown>) => Object.values(materialTexturePaths(fields)).forEach((path) => paths.add(path));
  for (const entity of scene.entities) {
    const fields = entity.components.Material ?? {};
    add(fields);
    const source = entity.components.Script?.source;
    if (typeof source === "string" && /\.material\.(?:texture|normalTexture)\b/i.test(source)) {
      SURFACE_TEXTURES.forEach((texture) => Object.values(texturePaths(texture.id)).forEach((path) => paths.add(path)));
    } else if (typeof source === "string" && /\.material\.(?:reliefDepth|occlusionStrength)\b/i.test(source)) {
      add({ ...fields, reliefDepth: 0.035, occlusionStrength: 1 });
    }
    const tracks = entity.components.Animator?.tracks;
    if (Array.isArray(tracks)) for (const track of tracks) {
      if (track.component === "Material" && ["texture", "normalTexture", "reliefDepth", "occlusionStrength"].includes(track.field) && Array.isArray(track.keys)) {
        track.keys.forEach((key: { value?: unknown }) => add({ ...fields, [track.field]: key.value }));
      }
    }
  }
  return [...paths];
}

export const TEXTURE_AGENT_RULES = `## Textures
Auto mapping=1 tile/m; stretch=1; custom=UV repeats. normalTexture auto=color, none=off. reliefDepth=parallax meters; occlusionStrength=crevice shadows. White untints.`;

export const TEXTURE_AGENT_SPEC = `${TEXTURE_AGENT_RULES}
Texture ids: none, ${SURFACE_TEXTURES.map((texture) => texture.id).join(", ")}. Paper/metal have no normal map.`;
