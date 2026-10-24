import * as THREE from "three";
import { cameraSchema } from "../registry/components/camera";
import { applyOps } from "../scene/applyOps";
import { localPosition, worldMatrix } from "../scene/hierarchy";
import { createEmptyScene, type Entity, type Scene, type SceneOp, type Vec3 } from "../scene/types";

export type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export function cameraValues(entity: Entity): Record<string, unknown> {
  return { ...Object.fromEntries(Object.entries(cameraSchema.fields).map(([name, field]) => [name, field.default])), ...entity.components.Camera };
}

/** Explicit active camera wins. Legacy scenes with only inactive cameras use the first. */
export function activeCamera(scene: Scene): Entity | undefined {
  return scene.entities.find((entity) => entity.components.Camera?.isActive === true)
    ?? scene.entities.find((entity) => entity.components.Camera);
}

export function activateCameraOps(scene: Scene, id: string): SceneOp[] {
  return scene.entities.filter((entity) => entity.components.Camera && (entity.id === id || entity.components.Camera.isActive === true))
    .map((entity) => ({ op: "update", id: entity.id, components: { Camera: { isActive: entity.id === id } } }));
}

export function createDefaultScene(): Scene {
  const scene = createEmptyScene();
  const eye = new THREE.Vector3(7, 6, 9);
  const rotation = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 1, 0)));
  scene.entities.push({ id: "camera", name: "Camera", parent: null, components: {
    Transform: { position: eye.toArray(), rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) },
    Camera: { isActive: true }
  } });
  return scene;
}

export function configureCamera(camera: SceneCamera, values: Record<string, unknown>, aspect: number): void {
  camera.near = Number(values.near);
  camera.far = Number(values.far);
  camera.zoom = Number(values.zoom);
  if (camera instanceof THREE.PerspectiveCamera) { camera.fov = Number(values.fov); camera.aspect = aspect; }
  else {
    const half = Number(values.orthoSize) / 2;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
  }
  camera.updateProjectionMatrix();
}

export function createSceneCamera(entity: Entity, aspect = 1): SceneCamera {
  const values = cameraValues(entity);
  const camera = values.projection === "orthographic" ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
  configureCamera(camera, values, aspect);
  return camera;
}

/** Resolve parented rigs and camera targets together, including attachments to a following camera. */
export class CameraRig {
  private readonly perspective = new THREE.PerspectiveCamera();
  private readonly orthographic = new THREE.OrthographicCamera();
  private readonly previous = new Map<string, THREE.Matrix4>();
  private worldPoses = new Map<string, THREE.Matrix4>();

  reset(): void { this.previous.clear(); this.worldPoses.clear(); }

  /** Simulation owns tracking so scripts can read, release, or detach the actual pose. */
  advanceScene(scene: Scene, dt: number): Scene {
    if (!scene.entities.some((entity) => entity.components.Camera?.followTarget || entity.components.Camera?.lookAtTarget)) { this.reset(); return scene; }
    this.update(scene, new Map(), 1, dt);
    const ops: SceneOp[] = [];
    for (const entity of scene.entities) {
      if (!entity.components.Camera?.followTarget && !entity.components.Camera?.lookAtTarget) continue;
      const pose = this.worldPoses.get(entity.id);
      if (!pose) continue;
      const parent = entity.parent ? this.worldPoses.get(entity.parent) : undefined;
      const position = new THREE.Vector3(); const orientation = new THREE.Quaternion(); const scale = new THREE.Vector3();
      (parent?.clone() ?? new THREE.Matrix4()).invert().multiply(pose).decompose(position, orientation, scale);
      const euler = new THREE.Euler().setFromQuaternion(orientation);
      ops.push({ op: "update", id: entity.id, components: { Transform: {
        position: position.toArray(), rotation: [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg)
      } } });
    }
    return ops.length ? applyOps(scene, ops).scene : scene;
  }

  update(scene: Scene, objects: ReadonlyMap<string, THREE.Object3D>, aspect: number, dt: number, evaluateTargets = true): SceneCamera | null {
    const active = activeCamera(scene);
    if (!active) { this.reset(); return null; }
    const entities = new Map(scene.entities.map((entity) => [entity.id, entity]));
    const resolved = new Map<string, THREE.Matrix4>();
    const visiting = new Set<string>();
    const resolve = (id: string | null): THREE.Matrix4 => {
      const entity = id ? entities.get(id) : undefined;
      if (!entity) return new THREE.Matrix4();
      if (resolved.has(entity.id)) return resolved.get(entity.id)!;
      // Validation rejects dependency cycles; guard imported/unvalidated input as well.
      if (visiting.has(entity.id)) return worldMatrix(scene, entity.id);
      visiting.add(entity.id);
      const local = worldMatrix({ ...scene, entities: [{ ...entity, parent: null }] }, entity.id);
      const matrix = resolve(entity.parent).clone().multiply(local);
      if (entity.components.Camera && evaluateTargets) {
        const values = cameraValues(entity);
        const position = new THREE.Vector3(); const orientation = new THREE.Quaternion(); const scale = new THREE.Vector3();
        matrix.decompose(position, orientation, scale);
        const target = typeof values.followTarget === "string" && entities.has(values.followTarget) ? values.followTarget : null;
        if (target) {
          position.setFromMatrixPosition(resolve(target)).add(new THREE.Vector3(...values.followOffset as Vec3));
          const prior = this.previous.get(entity.id);
          const damping = Number(values.followDamping);
          if (prior && damping > 0) position.lerpVectors(new THREE.Vector3().setFromMatrixPosition(prior), position, 1 - Math.exp(-damping * Math.max(0, dt)));
        }
        const lookTarget = typeof values.lookAtTarget === "string" && entities.has(values.lookAtTarget) ? values.lookAtTarget : null;
        if (lookTarget) {
          const aim = new THREE.Vector3().setFromMatrixPosition(resolve(lookTarget));
          if (position.distanceToSquared(aim) > 1e-12) orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(position, aim, new THREE.Vector3(0, 1, 0)));
        }
        matrix.compose(position, orientation, scale);
      }
      visiting.delete(entity.id); resolved.set(entity.id, matrix);
      return matrix;
    };
    for (const entity of scene.entities) {
      if (!entity.components.Camera) continue;
      const matrix = resolve(entity.id);
      this.previous.set(entity.id, matrix.clone());
      const object = objects.get(entity.id);
      // Apply the effective pose to the entity container so its children follow too.
      if (object) resolve(entity.parent).clone().invert().multiply(matrix).decompose(object.position, object.quaternion, object.scale);
    }
    for (const id of this.previous.keys()) if (!entities.get(id)?.components.Camera) this.previous.delete(id);
    this.worldPoses = resolved;
    const values = cameraValues(active);
    const camera = values.projection === "orthographic" ? this.orthographic : this.perspective;
    configureCamera(camera, values, aspect);
    resolve(active.id).decompose(camera.position, camera.quaternion, new THREE.Vector3());
    camera.updateMatrixWorld(true);
    return camera;
  }
}

/** Move along the camera's local axes; positions remain local to the parent rig. */
export function moveCameraOp(scene: Scene, entity: Entity, offset: Vec3): SceneOp {
  const matrix = worldMatrix(scene, entity.id);
  const rotation = new THREE.Quaternion(); matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
  const position = new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(...offset).applyQuaternion(rotation));
  return { op: "update", id: entity.id, components: { Transform: { position: localPosition(scene, entity.parent, position.toArray() as Vec3) } } };
}
