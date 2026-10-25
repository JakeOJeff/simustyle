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

const isRed = (hex: unknown) => {
  const color = typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? new THREE.Color(hex) : null;
  return !!color && color.r >= 0.45 && color.g <= color.r * 0.6 && color.b <= color.r * 0.6;
};

/**
 * "Put a mug on the desk next to the monitor", then "make it red": the mug stands on the desk top, and "it" was
 * read as the mug, so the mug turned red and nothing else changed color.
 */
export function mugOnDeskThenRed(before: Scene, after: Scene): string[] {
  const outermost = (scene: Scene, pattern: RegExp) => scene.entities.filter((entity) => pattern.test(entity.name)
    && !scene.entities.some((other) => other !== entity && pattern.test(other.name) && descendantsOf(scene, other.id).has(entity.id)));
  // The largest "desk" (not "Desk Accessories" inside it); a "mug" before any other "cup" (a pencil cup is not it).
  const size = (entity: Entity) => subtreeBounds(after, [entity.id])?.getSize(new THREE.Vector3()).lengthSq() ?? 0;
  const desk = outermost(after, /\bdesk\b/i).sort((a, b) => size(b) - size(a))[0];
  const mug = outermost(after, /\bmugs?\b/i)[0] ?? outermost(after, /\bcups?\b/i)[0];
  if (!desk) return ["No desk was found."];
  if (!mug) return ["No mug was found."];
  const failures: string[] = [];
  const deskMeshes = [...descendantsOf(after, desk.id)].filter((id) => !descendantsOf(after, mug.id).has(id)).map((id) => meshWorldBounds(after, id)).filter((box): box is THREE.Box3 => !!box);
  const area = (box: THREE.Box3) => (box.max.x - box.min.x) * (box.max.z - box.min.z);
  const top = deskMeshes.sort((a, b) => area(b) - area(a))[0];
  const mugBox = subtreeBounds(after, [mug.id]);
  if (!top || !mugBox) return ["The desk or the mug has no parts."];
  const center = mugBox.getCenter(new THREE.Vector3());
  if (Math.abs(mugBox.min.y - top.max.y) > TOLERANCE) failures.push(`${mug.name} bottom is at y ${mugBox.min.y.toFixed(2)}, not on the desk top at y ${top.max.y.toFixed(2)}.`);
  if (center.x < top.min.x || center.x > top.max.x || center.z < top.min.z || center.z > top.max.z) failures.push(`${mug.name} is not over the desk top.`);
  const mugIds = descendantsOf(after, mug.id);
  const colorOf = (scene: Scene, id: string) => scene.entities.find((entity) => entity.id === id)?.components.Material?.color;
  if (![...mugIds].some((id) => isRed(colorOf(after, id)) && !isRed(colorOf(before, id)))) failures.push(`${mug.name} did not turn red.`);
  const recolored = after.entities.filter((entity) => !mugIds.has(entity.id) && before.entities.some((old) => old.id === entity.id) && colorOf(before, entity.id) !== colorOf(after, entity.id));
  if (recolored.length) failures.push(`Also recolored: ${recolored.slice(0, 4).map((entity) => entity.name).join(", ")}.`);
  return failures;
}
