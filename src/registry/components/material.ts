import type { ComponentSchema } from "../types";

export const materialSchema: ComponentSchema = {
  name: "Material",
  description: "Color, surface response, and opacity for the entity's mesh.",
  requires: ["Transform", "Mesh"],
  fields: {
    color: { type: "color", default: "#ffffff" },
    metalness: { type: "float", min: 0, max: 1, default: 0 },
    roughness: { type: "float", min: 0, max: 1, default: 0.6 },
    emissive: { type: "color", default: "#000000" },
    emissiveIntensity: { type: "float", min: 0, max: 20, default: 0 },
    opacity: { type: "float", min: 0, max: 1, default: 1 }
  }
};
