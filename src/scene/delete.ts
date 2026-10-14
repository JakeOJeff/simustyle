import { isSelfOrAncestor } from "./hierarchy";
import type { Scene, SceneOp } from "./types";

/** Delete the entire selection and its descendants as one undoable batch. */
export function deleteEntityOps(scene: Scene, ids: readonly string[]): SceneOp[] {
  const roots = new Set(ids);
  return scene.entities.filter((entity) => roots.has(entity.id) || [...roots].some((id) => isSelfOrAncestor(scene, id, entity.parent)))
    .map((entity) => ({ op: "delete", id: entity.id }));
}
