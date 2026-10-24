import type { Scene, SceneOp } from "./types";

/** Removing an animated component must also remove tracks that would recreate it on preview. */
export function removeComponentOps(scene: Scene, id: string, component: string): SceneOp[] {
  const entity = scene.entities.find((entity) => entity.id === id);
  if (!entity?.components[component]) return [];
  const components: Record<string, Record<string, unknown> | null> = { [component]: null };
  const tracks = entity.components.Animator?.tracks;
  if (component !== "Animator" && Array.isArray(tracks)) {
    const remaining = tracks.filter((track) => track.component !== component);
    if (remaining.length !== tracks.length) components.Animator = { tracks: remaining };
  }
  return [{ op: "update", id, components }];
}
