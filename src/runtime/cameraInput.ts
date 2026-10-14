import * as THREE from "three";
import { activeCamera, cameraValues, moveCameraOp } from "./camera";
import type { Scene, SceneOp, Vec3 } from "../scene/types";

/** Canvas focus owns fly input. All listeners are removed when the viewport is destroyed. */
export class CameraInput {
  private readonly held = new Set<string>();
  private dragging = false;
  private turn: [number, number] = [0, 0];
  private readonly abort = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly enabled: () => boolean) {
    canvas.tabIndex = 0;
    const options = { signal: this.abort.signal };
    canvas.addEventListener("keydown", (event) => {
      if (!enabled() || !["w", "a", "s", "d", "q", "e", "shift"].includes(event.key.toLowerCase())) return;
      this.held.add(event.key.toLowerCase()); event.preventDefault();
    }, options);
    window.addEventListener("keyup", (event) => this.held.delete(event.key.toLowerCase()), options);
    canvas.addEventListener("pointerdown", (event) => {
      if (!enabled()) return;
      canvas.focus({ preventScroll: true });
      if (event.button === 0) { this.dragging = true; canvas.setPointerCapture(event.pointerId); }
    }, options);
    canvas.addEventListener("pointermove", (event) => {
      if (!enabled() || !this.dragging) return;
      this.turn[0] += event.movementX; this.turn[1] += event.movementY;
    }, options);
    canvas.addEventListener("pointerup", () => { this.dragging = false; }, options);
    canvas.addEventListener("pointercancel", () => this.reset(), options);
    canvas.addEventListener("blur", () => this.reset(), options);
    window.addEventListener("blur", () => this.reset(), options);
  }

  reset(): void { this.held.clear(); this.dragging = false; this.turn = [0, 0]; }
  dispose(): void { this.abort.abort(); this.reset(); }

  advance(scene: Scene, dt: number): SceneOp[] {
    const entity = activeCamera(scene);
    if (!this.enabled() || !entity) { this.reset(); return []; }
    const values = cameraValues(entity);
    const ops: SceneOp[] = [];
    const axis = (positive: string, negative: string) => Number(this.held.has(positive)) - Number(this.held.has(negative));
    const direction = new THREE.Vector3(axis("d", "a"), axis("e", "q"), axis("s", "w"));
    if (direction.lengthSq() && !values.followTarget) {
      direction.normalize().multiplyScalar(Number(values.moveSpeed) * Math.min(0.1, dt) * (this.held.has("shift") ? 3 : 1));
      ops.push(moveCameraOp(scene, entity, direction.toArray() as Vec3));
    }
    if ((this.turn[0] || this.turn[1]) && !values.lookAtTarget) {
      const rotation = entity.components.Transform?.rotation as Vec3 | undefined ?? [0, 0, 0];
      const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3, "XYZ"));
      const view = new THREE.Euler().setFromQuaternion(orientation, "YXZ");
      const limit = THREE.MathUtils.degToRad(89);
      const speed = THREE.MathUtils.degToRad(Number(values.lookSpeed));
      view.x = Math.max(-limit, Math.min(limit, view.x - this.turn[1] * speed));
      view.y -= this.turn[0] * speed;
      const saved = new THREE.Euler().setFromQuaternion(orientation.setFromEuler(view), "XYZ");
      ops.push({ op: "update", id: entity.id, components: { Transform: { rotation: [saved.x, saved.y, saved.z].map(THREE.MathUtils.radToDeg) } } });
    }
    this.turn = [0, 0];
    return ops;
  }
}
