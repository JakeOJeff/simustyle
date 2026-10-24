# Built-in surface textures

These runtime maps come from the nine ambientCG 2K PNG archives supplied in the
repository's `textures/` folder. ambientCG assets are CC0 (public domain):
https://docs.ambientcg.com/license/

The app ships 512 × 512 WebP color, OpenGL normal and roughness maps, plus the
metalness map for Metal049A. Flat normal maps for paper and metal are omitted.
Height and ambient occlusion share a Detail map (R=occlusion, G/B=height) for
the seven detailed surfaces. DirectX normals, previews and Blender/USD/material
source files are excluded. No image processing dependency is added to
the app. Source ZIPs stay local and are ignored by Git.

To regenerate with Sharp as an optional local tool: extract only Color,
NormalGL, Roughness and Metalness PNGs; resize to 512 × 512; encode WebP at quality
80 (90 for NormalGL, lossless for Wood092/WoodFloor051 normals to retain subtle
channel variation); drop `_2K-PNG` from filenames. Omit Paper006_NormalGL and
Metal049A_NormalGL. The catalog is in `src/materials/catalog.ts`.

Images are fetched only when a surface uses them. Objects with identical texture
and tiling share maps; tiling variants share image sources. Normal-only materials
fetch just their normal image; selecting a different normal retains color and
roughness maps. Each image updates its GPU clones independently. Resources are released
when their last material stops using them. Offline HTML embeds only maps used by
the scene; scenes with scripts that set the texture property include the library
so dynamic texture changes also work offline. GLB embeds textures after loading
completes.

Auto repeat uses surface dimensions and ancestor scale to bake roughly one tile
per meter into mesh UVs. Stretch restores the original UVs; Custom restores them
and applies manual repeat counts. All maps share this mapping, and normal strength
changes a material uniform without loading new images. Unchanged UVs are cached.

Detail maps are 512px WebP at quality 90. Resize source Displacement and
AmbientOcclusion PNGs to grayscale and pack channels as above; use white occlusion
where a source has none. The 16-step parallax shader converts depth in meters to
the face's UV space, shifts all material maps consistently, and uses explicit
texture gradients to avoid mip shimmer. Default depth is 0.035 m. Setting depth
and crevice shadow to zero skips loading the packed map. The full library is about
1.36 MB; no runtime image-processing dependency or extra mesh subdivisions are used.
