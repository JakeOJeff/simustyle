import type { ComponentSchema } from "../types";

export const lightSchema: ComponentSchema = {
  name: "Light",
  description: "A directional, point, or spot light in the scene.",
  requires: ["Transform"],
  fields: {
    type: { type: "enum", options: ["directional", "point", "spot"], default: "point" },
    color: { type: "color", default: "#ffffff" },
    intensity: { type: "float", min: 0, max: 100, default: 1 },
    castShadow: { type: "bool", default: true }
  }
};
