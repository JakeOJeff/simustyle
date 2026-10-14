import type { ComponentSchema } from "../types";

export const cameraSchema: ComponentSchema = {
  name: "Camera",
  description: "A scriptable perspective or orthographic camera. Children move with it; local -Z is forward.",
  requires: ["Transform"],
  fields: {
    fov: { type: "float", min: 10, max: 120, default: 50 },
    isActive: { type: "bool", default: false },
    projection: { type: "enum", options: ["perspective", "orthographic"], default: "perspective" },
    near: { type: "float", min: 0.001, max: 1000, default: 0.1 },
    far: { type: "float", min: 0.01, max: 100000, default: 1000 },
    zoom: { type: "float", min: 0.01, max: 100, default: 1 },
    orthoSize: { type: "float", min: 0.01, max: 10000, default: 10 },
    followTarget: { type: "entityRef", default: null },
    followOffset: { type: "vec3", default: [0, 3, 6] },
    followDamping: { type: "float", min: 0, max: 30, default: 0 },
    lookAtTarget: { type: "entityRef", default: null },
    controls: { type: "enum", options: ["none", "fly"], default: "none" },
    moveSpeed: { type: "float", min: 0.01, max: 1000, default: 5 },
    lookSpeed: { type: "float", min: 0.01, max: 5, default: 0.15 }
  }
};
