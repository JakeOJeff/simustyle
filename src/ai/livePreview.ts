import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { expandBuildOperations } from "./buildTools";

/**
 * The scene as a streaming build would leave it so far, for display only (never committed or undoable).
 * The first `complete` ops are finished: they are applied once and cached while they stay the same. Every op
 * after them is still being written (one draft op, or several detail passes at once) and is re-applied on each
 * update. An op, or a single part of it, that does not apply is skipped, so one bad part never hides the rest.
 */
export class LivePreview {
  private base: Scene | null = null;
  private settled: Scene | null = null;
  /** The finished ops applied into `settled`, as JSON, to notice when a new update replaces them. */
  private settledOps: string[] = [];

  /** base: the scene the build applies to; ops/complete: from parsePartialReply or the agent's detail stage. */
  update(base: Scene, ops: readonly unknown[], complete: number): Scene {
    const finished = Math.min(complete, ops.length);
    const keeps = base === this.base && this.settledOps.length <= finished &&
      this.settledOps.every((json, index) => json === JSON.stringify(ops[index]));
    if (!keeps) {
      this.base = base;
      this.settled = base;
      this.settledOps = [];
    }
    for (let index = this.settledOps.length; index < finished; index++) {
      this.settled = applyLoosely(this.settled!, ops[index]);
      this.settledOps.push(JSON.stringify(ops[index]));
    }
    let shown = this.settled!;
    for (const growing of ops.slice(finished)) shown = applyLoosely(shown, growing);
    return shown;
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
