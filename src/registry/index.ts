import { animatorSchema } from "./components/animator";
import { cameraSchema } from "./components/camera";
import { colliderSchema } from "./components/collider";
import { jointSchema } from "./components/joint";
import { lightSchema } from "./components/light";
import { materialSchema } from "./components/material";
import { meshSchema } from "./components/mesh";
import { rigidBodySchema } from "./components/rigidBody";
import { scriptSchema } from "./components/script";
import { transformSchema } from "./components/transform";
import type { ComponentSchema } from "./types";

export const componentSchemas: Record<string, ComponentSchema> = {
  Transform: transformSchema,
  Mesh: meshSchema,
  Material: materialSchema,
  RigidBody: rigidBodySchema,
  Collider: colliderSchema,
  Joint: jointSchema,
  Light: lightSchema,
  Camera: cameraSchema,
  Script: scriptSchema,
  Animator: animatorSchema
};

export { type ComponentSchema, type FieldSchema } from "./types";
