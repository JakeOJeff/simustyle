// Pass checks for multi-step `npm run ai:eval` cases: each compares the scene before the last step with the
// final scene and returns one line per failure (empty = pass).
import * as THREE from "three";
import { isThin, tethers } from "../../src/ai/geometry";
import { subtreeBounds } from "../../src/ai/placement";
import { meshWorldBounds } from "../../src/ai/quality";
import type { Entity, Scene } from "../../src/scene/types";

const TOLERANCE = 0.05;

function descendantsOf(scene: Scene, id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const entity of scene.entities) if (entity.parent && ids.has(entity.parent) && !ids.has(entity.id)) { ids.add(entity.id); grew = true; }
  }
  return ids;
}

/**
 * "Put this inside a new building": every object of the earlier scene ends up inside the new building's shell, and
 * every new held floating object (balloon, kite) is tethered to the building's upper part (its roof).
 */
export function containedAndTethered(before: Scene, after: Scene): string[] {
  const contents = before.entities.filter((entity) => !entity.parent && subtreeBounds(before, [entity.id]) && after.entities.some((other) => other.id === entity.id));
  const old = new Set(before.entities.map((entity) => entity.id));
  const contentIds = new Set(contents.flatMap((entity) => [...descendantsOf(after, entity.id)]));
  const volume = (box: THREE.Box3 | null) => box ? box.getSize(new THREE.Vector3()).toArray().reduce((a, b) => a * b, 1) : 0;
  const building = after.entities.filter((entity) => !entity.parent && !old.has(entity.id))
    .map((entity) => ({ entity, size: volume(subtreeBounds(after, [entity.id])) })).sort((a, b) => b.size - a.size)[0]?.entity;
  if (!building) return ["No new building was created."];
  const held = tethers(after).filter((tether) => !old.has(tether.mesh.id));
  const heldIds = new Set(held.map((tether) => tether.mesh.id));
  // The shell: the building's own parts, without what was moved in, the balloons and their strings.
  const shellMeshes = [...descendantsOf(after, building.id)].map((id) => after.entities.find((entity) => entity.id === id)!)
    .filter((entity) => entity.components.Mesh && !contentIds.has(entity.id) && !heldIds.has(entity.id) && !isThin(entity));
  if (!shellMeshes.length) return [`${building.name} has no parts.`];
  const shell = shellMeshes.reduce((box, mesh) => box.union(meshWorldBounds(after, mesh.id)!), new THREE.Box3());
  const failures: string[] = [];
  for (const entity of contents) {
    const box = subtreeBounds(after, [entity.id])!;
    if (!shell.clone().expandByScalar(TOLERANCE).containsBox(box)) failures.push(`${entity.name} is not inside ${building.name}.`);
  }
  if (!held.length) failures.push("No floating held objects (balloons) were built.");
  const roofLine = shell.min.y + 0.6 * (shell.max.y - shell.min.y);
  const onRoof = (anchor: Entity) => shellMeshes.includes(anchor) && meshWorldBounds(after, anchor.id)!.max.y >= roofLine;
  const loose = new Set(held.filter((tether) => !(tether.anchor && tether.anchor !== "ground" && onRoof(tether.anchor))).map((tether) => tether.object.name));
  for (const name of loose) failures.push(`${name} is not tethered to the roof of ${building.name}.`);
  return failures;
}
