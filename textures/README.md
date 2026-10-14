# Built-in surface textures

These runtime maps come from the nine ambientCG 2K PNG archives supplied in the
repository's `textures/` folder. ambientCG assets are CC0 (public domain):
https://docs.ambientcg.com/license/

The app ships 512 × 512 WebP color, OpenGL normal and roughness maps, plus the
metalness map for Metal049A. Flat normal maps for paper and metal are omitted.
Displacement, ambient occlusion, DirectX normals, previews and Blender/USD/material
source files are unused and excluded. No image processing dependency is added to
the app. Source ZIPs stay local and are ignored by Git.

To regenerate with Sharp as an optional local tool: extract only Color,
NormalGL, Roughness and Metalness PNGs; resize to 512 × 512; encode WebP at quality
80 (90 for NormalGL); drop `_2K-PNG` from filenames. Omit Paper006_NormalGL and
Metal049A_NormalGL. The catalog is in `src/materials/catalog.ts`.

Images are fetched only when a surface uses them. Objects with identical texture
and tiling share maps; tiling variants share image sources. Resources are released
when their last material stops using them. Offline HTML embeds only maps used by
the scene; scenes with scripts that set the texture property include the library
so dynamic texture changes also work offline. GLB embeds textures after loading
completes.

Auto repeat uses surface dimensions and ancestor scale to bake roughly one tile
per meter into mesh UVs. Stretch restores the original UVs; Custom restores them
and applies manual repeat counts. All maps share this mapping, and normal strength
changes a material uniform without loading new images. Unchanged UVs are cached.
