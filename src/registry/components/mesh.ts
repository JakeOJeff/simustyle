import type { ComponentSchema } from "../types";

export const meshSchema: ComponentSchema = {
  name: "Mesh",
  description: "A built-in three-dimensional primitive displayed for this entity.",
  requires: ["Transform"],
  fields: {
    shape: { type: "enum", options: ["box", "sphere", "cylinder", "capsule", "plane", "cone", "wedge", "torus", "text"], default: "box" },
    radius: { type: "float", min: 0.01, max: 50, default: 0.5 },
    height: { type: "float", min: 0.01, max: 50, default: 1 },
    // Cylinder/cone only; unset means radius for a cylinder and 0 (a point) for a cone.
    radiusTop: { type: "float", min: 0, max: 50, default: 0.5, optional: true },
    // Box only: rounded edges.
    bevel: { type: "float", min: 0, max: 0.5, default: 0, step: 0.01 },
    // Cylinder/cone only: 3-12 are faceted prisms and pyramids.
    sides: { type: "int", min: 3, max: 64, default: 32 },
    // Sphere/cylinder/cone/torus: degrees swept.
    arc: { type: "float", min: 1, max: 360, default: 360, step: 1 },
    // Cylinder only: inner radius as a fraction of the outer one.
    hollow: { type: "float", min: 0, max: 0.95, default: 0, step: 0.01 },
    // Text only.
    text: { type: "string", default: "Text", maxLength: 40 }
  }
};
