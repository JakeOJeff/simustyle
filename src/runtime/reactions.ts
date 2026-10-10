import type { Entity } from "../scene/types";

/**
 * A Collider's reaction is written as an ordinary script handler, so it runs through
 * the same parser, checker, and runtime as user scripts.
 */
export function reactionSource(entity: Entity): string | null {
  const collider = entity.components.Collider;
  if (!collider || collider.enabled === false) return null;
  const color = typeof collider.reactionColor === "string" && /^#[0-9a-fA-F]{6}$/.test(collider.reactionColor) ? collider.reactionColor : "#ff5a5a";
  const body = (() => {
    switch (collider.reaction) {
      case "flash": return ["flash fast", "wait 0.6 seconds", "stop"];
      case "shake": return ["shake wildly", "wait 0.4 seconds", "stop"];
      case "change color": return [`paint ${color}`];
      case "jump": return ["push up 5"];
      case "disappear": return ["destroy"];
      case "destroy other": return ["destroy it"];
      default: return null;
    }
  })();
  return body ? `when I touch anything\n${body.map((line) => `  ${line}`).join("\n")}\n` : null;
}
