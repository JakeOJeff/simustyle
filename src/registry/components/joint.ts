import type { ComponentSchema } from "../types";

export const jointSchema: ComponentSchema = {
  name: "Joint",
  description: "A constraint connecting this body to another entity or the world.",
  requires: ["Transform", "RigidBody"],
  fields: {
    type: { type: "enum", options: ["rope", "fixed", "spherical", "revolute"], default: "rope" },
    target: { type: "entityRef", default: null },
    anchor: { type: "vec3", default: [0, 0, 0] },
    length: { type: "float", min: 0, max: 100, default: 2 }
  }
};
