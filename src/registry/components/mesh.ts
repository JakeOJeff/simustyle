import type { ComponentSchema } from "../types";

export const meshSchema: ComponentSchema = {
  name: "Mesh",
  description: "A built-in three-dimensional primitive displayed for this entity.",
  requires: ["Transform"],
  fields: {
    shape: { type: "enum", options: ["box", "sphere", "cylinder", "capsule", "plane", "cone"], default: "box" },
    radius: { type: "float", min: 0.01, max: 50, default: 0.5 },
    height: { type: "float", min: 0.01, max: 50, default: 1 }
  }
};
