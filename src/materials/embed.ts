import type { Scene } from "../scene/types";
import { sceneTexturePaths, textureUrl, type TextureAssets } from "./catalog";

/** Embed each used map once; unused library textures never enter offline exports. */
export async function embedSceneTextures(scene: Scene): Promise<TextureAssets> {
  const entries = await Promise.all(sceneTexturePaths(scene).map(async (path) => {
    const response = await fetch(textureUrl(path));
    if (!response.ok) throw new Error(`Could not export texture ${path}: HTTP ${response.status}`);
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not embed texture: ${path}`));
      reader.readAsDataURL(blob);
    });
    return [path, data] as const;
  }));
  return Object.fromEntries(entries);
}
