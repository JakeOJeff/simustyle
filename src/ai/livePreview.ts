import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { expandBuildOperations } from "./buildTools";

/**
 * The scene as a streaming build would leave it so far, for display only (never committed or undoable).
 * Finished ops are applied once and cached; only the op still being written is re-applied on each update.
 * An op, or a single part of it, that does not apply is skipped, so one bad part never hides the rest.
 */
export class LivePreview {
  private base: Scene | null = null;
  private settled: Scene | null = null;
  private settledCount = 0;

  /** base: the scene the build applies to; ops/complete: from parsePartialReply. */
  update(base: Scene, ops: readonly unknown[], complete: number): Scene {
    if (base !== this.base || complete < this.settledCount) {
      this.base = base;
      this.settled = base;
      this.settledCount = 0;
    }
    for (; this.settledCount < Math.min(complete, ops.length); this.settledCount++) this.settled = applyLoosely(this.settled!, ops[this.settledCount]);
    const growing = ops.length > this.settledCount ? ops[this.settledCount] : undefined;
    return growing === undefined ? this.settled! : applyLoosely(this.settled!, growing);
  }
}

/** Applies one build op (expanded), dropping only the parts that fail. */
function applyLoosely(scene: Scene, op: unknown): Scene {
  const expanded = expandBuildOperations(scene, [op]);
  if (expanded.errors.length || !expanded.ops.length) return scene;
  const whole = applyOps(scene, expanded.ops);
  if (!whole.errors.length) return whole.scene;
  let current = scene;
  for (const part of expanded.ops as SceneOp[]) {
    const applied = applyOps(current, [part]);
    if (!applied.errors.length) current = applied.scene;
  }
  return current;
}
