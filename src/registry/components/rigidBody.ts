import type { ComponentSchema } from "../types";

export const rigidBodySchema: ComponentSchema = {
  name: "RigidBody",
  description: "Physical body properties used by the simulation.",
  requires: ["Transform"],
  fields: {
    bodyType: { type: "enum", options: ["dynamic", "static", "kinematic"], default: "dynamic" },
    mass: { type: "float", min: 0.01, max: 1000, default: 1 },
    friction: { type: "float", min: 0, max: 2, default: 0.5 },
    restitution: { type: "float", min: 0, max: 1, default: 0.2 },
    linearDamping: { type: "float", min: 0, max: 10, default: 0 },
    initialVelocity: { type: "vec3", default: [0, 0, 0] }
  }
};
