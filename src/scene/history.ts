import { applyOps } from "./applyOps";
import type { Scene, SceneOp } from "./types";

export class SceneHistory {
  private undoStack: SceneOp[][] = [];
  private redoStack: SceneOp[][] = [];

  constructor(private current: Scene) {}

  get scene(): Scene {
    return this.current;
  }

  apply(ops: readonly SceneOp[]): string[] {
    const result = applyOps(this.current, ops);
    if (result.errors.length) return result.errors;
    this.current = result.scene;
    if (result.inverseOps.length) {
      this.undoStack.push(result.inverseOps);
      this.redoStack = [];
    }
    return [];
  }

  undo(): string[] {
    const ops = this.undoStack.pop();
    if (!ops) return [];
    const result = applyOps(this.current, ops);
    if (result.errors.length) {
      this.undoStack.push(ops);
      return result.errors;
    }
    this.current = result.scene;
    this.redoStack.push(result.inverseOps);
    return [];
  }

  redo(): string[] {
    const ops = this.redoStack.pop();
    if (!ops) return [];
    const result = applyOps(this.current, ops);
    if (result.errors.length) {
      this.redoStack.push(ops);
      return result.errors;
    }
    this.current = result.scene;
    this.undoStack.push(result.inverseOps);
    return [];
  }
}
