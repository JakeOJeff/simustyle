import type { ComponentSchema } from "../types";

export const transformSchema: ComponentSchema = {
  name: "Transform",
  description: "Position, rotation in Euler XYZ degrees, and scale; relative to the parent, or to the world at the top level.",
  fields: {
    position: { type: "vec3", default: [0, 0, 0] },
    rotation: { type: "vec3", default: [0, 0, 0] },
    scale: { type: "vec3", default: [1, 1, 1] }
  }
};
