import type { ComponentSchema } from "../types";

/** Reactions a Collider can run when it touches something, without writing a script. */
export const COLLIDER_REACTIONS = ["none", "flash", "shake", "change color", "jump", "disappear", "destroy other"] as const;

export const colliderSchema: ComponentSchema = {
  name: "Collider",
  description: "Makes the object solid and touchable during Play, even without a RigidBody. Trigger colliders detect touches without blocking. A reaction runs each time it touches something.",
  requires: ["Transform"],
  fields: {
    enabled: { type: "bool", default: true },
    trigger: { type: "bool", default: false },
    reaction: { type: "enum", options: [...COLLIDER_REACTIONS], default: "none" },
    reactionColor: { type: "color", default: "#ff5a5a" }
  }
};
