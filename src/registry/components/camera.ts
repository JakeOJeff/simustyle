import type { ComponentSchema } from "../types";

export const cameraSchema: ComponentSchema = {
  name: "Camera",
  description: "A perspective camera that can become the active scene camera.",
  requires: ["Transform"],
  fields: {
    fov: { type: "float", min: 10, max: 120, default: 50 },
    isActive: { type: "bool", default: false }
  }
};
