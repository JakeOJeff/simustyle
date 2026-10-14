import type { ComponentSchema } from "../types";
import { SURFACE_TEXTURES } from "../../materials/catalog";

export const materialSchema: ComponentSchema = {
  name: "Material",
  description: "Color, texture, UV tiling, shine, and opacity for the mesh.",
  requires: ["Transform", "Mesh"],
  fields: {
    color: { type: "color", default: "#ffffff" },
    texture: { type: "enum", options: ["none", ...SURFACE_TEXTURES.map((texture) => texture.id)], default: "none" },
    textureMapping: { type: "enum", options: ["auto", "stretch", "custom"], default: "auto" },
    textureRepeatX: { type: "float", min: 0.1, max: 100, default: 1, step: 0.1 },
    textureRepeatY: { type: "float", min: 0.1, max: 100, default: 1, step: 0.1 },
    normalTexture: { type: "enum", options: ["auto", "none", ...SURFACE_TEXTURES.filter((texture) => texture.normal).map((texture) => texture.id)], default: "auto" },
    normalStrength: { type: "float", min: 0, max: 10, default: 1, step: 0.05 },
    metalness: { type: "float", min: 0, max: 1, default: 0 },
    roughness: { type: "float", min: 0, max: 1, default: 0.6 },
    emissive: { type: "color", default: "#000000" },
    emissiveIntensity: { type: "float", min: 0, max: 20, default: 0 },
    opacity: { type: "float", min: 0, max: 1, default: 1 }
  }
};
