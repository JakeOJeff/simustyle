import * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { applyOps } from "../scene/applyOps";
import type { Entity, Scene, Vec3 } from "../scene/types";
import { AnimatorRuntime } from "./animator";
import { ScriptRuntime, scriptOps } from "./scripts";
import { CameraRig } from "./camera";

export type PlayState = "stopped" | "playing" | "paused";

interface BodyEntry {
  entity: Entity;
  body: RAPIER.RigidBody;
  type: string;
  collider: RAPIER.Collider;
}

function record(entity: Entity, component: string): Record<string, unknown> {
  return entity.components[component] ?? {};
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vector(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part))
    ? [value[0], value[1], value[2]] as Vec3
    : fallback;
}

function eulerToRotation(rotation: Vec3): RAPIER.Rotation {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3, "XYZ"));
}

function rotationToEuler(rotation: RAPIER.Rotation): Vec3 {
  const { x, y, z, w } = rotation;
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(x, y, z, w), "XYZ");
  return [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg) as Vec3;
}

// Collision groups: the upper 16 bits say what a collider is, the lower 16 what it may touch.
const OBJECT_GROUP = 0x0001;
const GROUND_GROUP = 0x0002;
const groups = (member: number, filter: number) => (member << 16) | filter;

/** Entities that take part in physics: rigid bodies, plus anything with an enabled Collider. */
function isPhysical(entity: Entity): boolean {
  return Boolean(entity.components.RigidBody) || (Boolean(entity.components.Collider) && entity.components.Collider?.enabled !== false);
}

function bodyType(entity: Entity): "static" | "kinematic" | "dynamic" {
  const data = entity.components.RigidBody;
  if (!data) return "kinematic";
  if (data.anchored === true || data.bodyType === "static") return "static";
  return data.bodyType === "kinematic" ? "kinematic" : "dynamic";
}

function colliderFor(entity: Entity): RAPIER.ColliderDesc {
  const mesh = record(entity, "Mesh");
  const transform = record(entity, "Transform");
  const [sx, sy, sz] = vector(transform.scale, [1, 1, 1]).map((value) => Math.max(0.0001, Math.abs(value)));
  const radius = number(mesh.radius, 0.5);
  const height = number(mesh.height, 1);
  const uniform = Math.abs(sx - sy) < 1e-6 && Math.abs(sx - sz) < 1e-6;
  const roundBase = Math.abs(sx - sz) < 1e-6;
  let geometry: THREE.BufferGeometry;
  switch (mesh.shape ?? "box") {
    case "sphere":
      if (uniform) return RAPIER.ColliderDesc.ball(radius * sx);
      geometry = new THREE.SphereGeometry(radius, 24, 16);
      break;
    case "cylinder":
      if (roundBase) return RAPIER.ColliderDesc.cylinder(height * sy / 2, radius * sx);
      geometry = new THREE.CylinderGeometry(radius, radius, height, 24);
      break;
    case "capsule": {
      const length = Math.max(0.01, height - 2 * radius);
      if (uniform) return RAPIER.ColliderDesc.capsule(length * sy / 2, radius * sx);
      geometry = new THREE.CapsuleGeometry(radius, length, 4, 12);
      break;
    }
    // Three's PlaneGeometry lies in local XY, with its normal along local Z.
    case "plane": return RAPIER.ColliderDesc.cuboid(radius * sx, radius * sy, 0.01 * sz);
    case "cone":
      if (roundBase && vector(transform.scale, [1, 1, 1])[1] >= 0) return RAPIER.ColliderDesc.cone(height * sy / 2, radius * sx);
      geometry = new THREE.ConeGeometry(radius, height, 24);
      if (vector(transform.scale, [1, 1, 1])[1] < 0) geometry.scale(1, -1, 1);
      break;
    default: return RAPIER.ColliderDesc.cuboid(radius * sx, height * sy / 2, radius * sz);
  }
  // Stretched curved primitives need a convex approximation of the visible geometry,
  // rather than a sphere/cylinder inflated to the largest scale axis.
  geometry.scale(sx, sy, sz);
  const collider = RAPIER.ColliderDesc.convexHull(new Float32Array(geometry.getAttribute("position").array));
  geometry.dispose();
  if (!collider) throw new Error(`Could not build the collider for '${entity.name}'.`);
  return collider;
}

export class PhysicsRuntime {
  readonly world: RAPIER.World;
  readonly warnings: string[] = [];
  private readonly bodies = new Map<string, BodyEntry>();
  private readonly colliderEntities = new Map<number, string>();
  private readonly events = new RAPIER.EventQueue(true);
  private accumulator = 0;
  private readonly fixedTimestep: number;
  private readonly collisions: boolean;

  private constructor(scene: Scene) {
    this.world = new RAPIER.World({ x: scene.settings.gravity[0], y: scene.settings.gravity[1], z: scene.settings.gravity[2] });
    this.collisions = scene.settings.collisions !== false;
    this.fixedTimestep = scene.settings.fixedTimestep;
    this.world.timestep = this.fixedTimestep;
    this.createGround();
    this.createBodies(scene);
    this.createJoints(scene);
  }

  static async create(scene: Scene): Promise<PhysicsRuntime> {
    await RAPIER.init();
    return new PhysicsRuntime(scene);
  }

  private createGround(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setFriction(0.8).setCollisionGroups(groups(GROUND_GROUP, OBJECT_GROUP)), body);
  }

  private createBodies(scene: Scene): void {
    for (const entity of scene.entities) {
      if (!isPhysical(entity)) continue;
      const data = record(entity, "RigidBody");
      const settings = record(entity, "Collider");
      const transform = record(entity, "Transform");
      const position = vector(transform.position, [0, 0, 0]);
      const rotation = eulerToRotation(vector(transform.rotation, [0, 0, 0]));
      // A Collider without a RigidBody follows its Transform (scripts, animation, gizmo) like a kinematic body.
      const type = bodyType(entity);
      const solid = this.collisions && settings.enabled !== false;
      const descriptor = type === "static"
        ? RAPIER.RigidBodyDesc.fixed()
        : type === "kinematic"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();
      descriptor.setTranslation(position[0], position[1], position[2]).setRotation(rotation);
      if (type === "dynamic") {
        const velocity = vector(data.initialVelocity, [0, 0, 0]);
        descriptor.setLinvel(velocity[0], velocity[1], velocity[2]);
        descriptor.setLinearDamping(number(data.linearDamping, 0));
        descriptor.setCcdEnabled(true);
      }
      const body = this.world.createRigidBody(descriptor);
      const collider = colliderFor(entity)
        // Let the collider compute inertia from its shape and the configured total mass.
        .setMass(number(data.mass, 1))
        .setFriction(number(data.friction, 0.5))
        .setRestitution(number(data.restitution, 0.2))
        .setSensor(settings.trigger === true)
        // Only the floor is solid when collisions are off for the scene or for this object.
        .setCollisionGroups(solid ? groups(OBJECT_GROUP, OBJECT_GROUP | GROUND_GROUP) : groups(OBJECT_GROUP, GROUND_GROUP))
        // Report touches between every body type, so script-moved Colliders still fire "when I touch".
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const physicsCollider = this.world.createCollider(collider, body);
      body.recomputeMassPropertiesFromColliders();
      this.bodies.set(entity.id, { entity, body, type, collider: physicsCollider });
      this.colliderEntities.set(physicsCollider.handle, entity.id);
    }
  }

  private createJoints(scene: Scene): void {
    const worldAnchorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const identity: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };
    for (const entity of scene.entities) {
      const data = entity.components.Joint;
      if (!data) continue;
      const child = this.bodies.get(entity.id)?.body;
      if (!child) {
        this.warnings.push(`Entity '${entity.name}' has a Joint but no RigidBody; its joint was skipped.`);
        continue;
      }
      const targetId = typeof data.target === "string" ? data.target : null;
      const target = targetId ? this.bodies.get(targetId)?.body : worldAnchorBody;
      if (!target) {
        this.warnings.push(`Joint on '${entity.name}' targets an entity without a RigidBody; its joint was skipped.`);
        continue;
      }
      const anchor = vector(data.anchor, [0, 0, 0]);
      const localChild = { x: 0, y: 0, z: 0 };
      const anchorVector = { x: anchor[0], y: anchor[1], z: anchor[2] };
      const targetAnchor = anchorVector;
      const type = data.type;
      let joint: RAPIER.JointData;
      if (type === "rope") {
        joint = RAPIER.JointData.rope(number(data.length, 2), targetAnchor, localChild);
      } else if (type === "fixed") {
        joint = RAPIER.JointData.fixed(targetAnchor, identity, localChild, identity);
      } else if (type === "revolute") {
        joint = RAPIER.JointData.revolute(targetAnchor, localChild, { x: 0, y: 1, z: 0 });
      } else {
        joint = RAPIER.JointData.spherical(targetAnchor, localChild);
      }
      this.world.createImpulseJoint(joint, target, child, true);
    }
  }

  applyScriptAction(id: string, method: string, args: number[]): boolean {
    const entry = this.bodies.get(id);
    if (!entry || (entry.type !== "dynamic" && method !== "setTranslation")) return false;
    const body = entry.body;
    if (method === "applyImpulse" && args.length === 3) body.applyImpulse({ x: args[0]!, y: args[1]!, z: args[2]! }, true);
    else if (method === "setVelocity" && args.length === 3) body.setLinvel({ x: args[0]!, y: args[1]!, z: args[2]! }, true);
    else if (method === "setTranslation" && args.length === 3) {
      body.setTranslation({ x: args[0]!, y: args[1]!, z: args[2]! }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    else return false;
    return true;
  }

  /** Accumulate wall-clock time and advance only in fixed simulation steps. */
  advance(scene: Scene, elapsedSeconds: number, onCollision?: (firstId: string, secondId: string) => void): Scene {
    this.accumulator += Math.max(0, Math.min(elapsedSeconds, 0.25));
    this.removeMissing(scene);
    this.syncBodyTypes(scene);
    let changed = false;
    while (this.accumulator >= this.fixedTimestep) {
      for (const [id, entry] of this.bodies) {
        if (entry.type === "dynamic") continue;
        const transform = scene.entities.find((candidate) => candidate.id === id)?.components.Transform;
        const position = vector(transform?.position, [0, 0, 0]);
        const translation = { x: position[0], y: position[1], z: position[2] };
        const rotation = eulerToRotation(vector(transform?.rotation, [0, 0, 0]));
        if (entry.type === "kinematic") {
          entry.body.setNextKinematicTranslation(translation);
          entry.body.setNextKinematicRotation(rotation);
        } else {
          // Anchoring prevents forces from moving the body, but explicit scene edits still move it.
          const previous = entry.body.translation(), orientation = entry.body.rotation();
          if (Math.hypot(previous.x - translation.x, previous.y - translation.y, previous.z - translation.z) > 1e-6) entry.body.setTranslation(translation, true);
          if (Math.hypot(orientation.x - rotation.x, orientation.y - rotation.y, orientation.z - rotation.z, orientation.w - rotation.w) > 1e-6) entry.body.setRotation(rotation, true);
        }
      }
      this.world.step(this.events);
      this.events.drainCollisionEvents((firstHandle, secondHandle, started) => {
        if (!started) return;
        const firstId = this.colliderEntities.get(firstHandle);
        const secondId = this.colliderEntities.get(secondHandle);
        if (firstId && secondId && firstId !== secondId) onCollision?.(firstId, secondId);
      });
      this.accumulator -= this.fixedTimestep;
      changed = true;
    }
    if (!changed) return scene;

    const ops = [...this.bodies.entries()]
      .filter(([, entry]) => entry.type === "dynamic")
      .map(([id, entry]) => {
        const position = entry.body.translation();
        return {
          op: "update" as const,
          id,
          components: { Transform: {
            position: [position.x, position.y, position.z],
            rotation: rotationToEuler(entry.body.rotation())
          } }
        };
      });
    if (!ops.length) return scene;
    const result = applyOps(scene, ops);
    if (result.errors.length) {
      this.warnings.push(`Physics transform sync failed: ${result.errors.join("; ")}`);
      return scene;
    }
    return result.scene;
  }

  /** Drop bodies whose entity was destroyed (by a script or a Collider reaction) or lost its physics. */
  private removeMissing(scene: Scene): void {
    const entities = new Map(scene.entities.map((entity) => [entity.id, entity]));
    for (const [id, entry] of this.bodies) {
      const entity = entities.get(id);
      if (entity && isPhysical(entity)) continue;
      this.colliderEntities.delete(entry.collider.handle);
      this.world.removeRigidBody(entry.body);
      this.bodies.delete(id);
    }
  }

  /** Anchor can change without replacing the body or losing its joints/collider. */
  private syncBodyTypes(scene: Scene): void {
    for (const entity of scene.entities) {
      const entry = this.bodies.get(entity.id);
      if (!entry) continue;
      const type = bodyType(entity);
      if (entry.type === type) continue;
      entry.body.setBodyType(type === "static" ? RAPIER.RigidBodyType.Fixed : type === "kinematic" ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
      entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      entry.body.enableCcd(type === "dynamic");
      entry.body.setLinearDamping(number(entity.components.RigidBody?.linearDamping, 0));
      entry.body.recomputeMassPropertiesFromColliders();
      entry.type = type;
    }
  }

  /** Keep live rigid bodies aligned when a Console command edits the Play scene. */
  syncSceneEdits(before: Scene, after: Scene): void {
    this.removeMissing(after);
    this.syncBodyTypes(after);
    const entities = new Map(after.entities.map((entity) => [entity.id, entity]));
    for (const [id, entry] of this.bodies) {
      const entity = entities.get(id)!;
      const oldEntity = before.entities.find((candidate) => candidate.id === id);
      const oldTransform = oldEntity?.components.Transform;
      const transform = entity.components.Transform;
      if (JSON.stringify(oldTransform) === JSON.stringify(transform)) continue;
      const position = vector(transform?.position, [0, 0, 0]);
      const rotation = eulerToRotation(vector(transform?.rotation, [0, 0, 0]));
      entry.body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
      entry.body.setRotation(rotation, true);
      if (entry.type === "dynamic") entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    const added = after.entities.filter((entity) => isPhysical(entity) && !this.bodies.has(entity.id));
    if (added.length) this.createBodies({ ...after, entities: added });
  }

  dispose(): void {
    this.events.free();
    this.world.free();
    this.bodies.clear();
    this.colliderEntities.clear();
  }
}

export class SimulationController {
  state: PlayState = "stopped";
  private runtime: PhysicsRuntime | null = null;
  private snapshot: Scene | null = null;
  private scripts: ScriptRuntime | null = null;
  private readonly animator = new AnimatorRuntime();
  private readonly cameras = new CameraRig();
  private readonly animationWarnings = new Set<string>();
  private readonly scriptMessages: string[] = [];
  private startedScene: Scene | null = null;
  private playRequest = 0;
  private starting = false;

  async play(scene: Scene): Promise<string[]> {
    if (this.state !== "stopped" || this.starting) return [];
    const request = ++this.playRequest;
    this.starting = true;
    this.scriptMessages.length = 0;
    this.snapshot = structuredClone(scene);
    this.animator.reset();
    this.cameras.reset();
    this.animationWarnings.clear();
    try {
      this.scripts = new ScriptRuntime(scene, 1, (id, method, args) => this.runtime?.applyScriptAction(id, method, args) ?? false);
      const initial = this.cameras.advanceScene(this.scripts.start(), 0);
      const initialOps = scriptOps(scene, initial);
      if (initialOps.length) {
        const result = applyOps(scene, initialOps);
        if (!result.errors.length) scene = result.scene;
      }
      this.scripts.setScene(scene);
      this.startedScene = scene;
      this.scriptMessages.push(...this.scripts.takeIssues().map((issue) => `${issue.entityId}:${issue.line}:${issue.column} ${issue.message}`));
      const runtime = await PhysicsRuntime.create(scene);
      if (request !== this.playRequest) { runtime.dispose(); return []; }
      this.runtime = runtime;
      this.state = "playing";
      return this.runtime.warnings;
    } catch (error) {
      if (request !== this.playRequest) return [];
      this.stop();
      const reason = error instanceof Error ? error.message : String(error);
      return [`Could not start physics: ${reason}`];
    } finally {
      if (request === this.playRequest) this.starting = false;
    }
  }

  pause(): void {
    if (this.state === "playing") { this.state = "paused"; this.releaseAllKeys(); }
  }

  resume(): void {
    if (this.state === "paused") this.state = "playing";
  }

  advance(scene: Scene, elapsedSeconds: number): Scene {
    if (this.state !== "playing" || !this.runtime) return scene;
    const before = scene;
    if (this.scripts) {
      this.scripts.setScene(scene);
      scene = this.scripts.advance(elapsedSeconds);
    }
    const operations = scriptOps(before, scene);
    if (operations.length) {
      const result = applyOps(before, operations);
      if (result.errors.length) this.scriptMessages.push(...result.errors);
      else scene = result.scene;
    }
    this.scripts?.setScene(scene);
    const collisions: Array<[string, string]> = [];
    let simulated = this.runtime.advance(scene, elapsedSeconds, (firstId, secondId) => collisions.push([firstId, secondId]));
    if (this.scripts) {
      this.scripts.setScene(simulated);
      for (const [firstId, secondId] of collisions) {
        this.scripts.collide(firstId, secondId);
        this.scripts.collide(secondId, firstId);
      }
      const collisionOps = scriptOps(simulated, this.scripts.scene);
      if (collisionOps.length) {
        const result = applyOps(simulated, collisionOps);
        if (result.errors.length) this.scriptMessages.push(...result.errors);
        else simulated = result.scene;
      }
      this.scripts.setScene(simulated);
      this.scriptMessages.push(...this.scripts.takeIssues().map((issue) => `${issue.entityId}:${issue.line}:${issue.column} ${issue.message}`));
      this.scriptMessages.push(...this.scripts.takePrints().map((entry) => `${entry.entityId}: ${entry.values.map(String).join(" ")}`));
    }
    const animated = this.animator.advance(simulated, elapsedSeconds);
    for (const warning of animated.warnings) {
      if (this.animationWarnings.has(warning)) continue;
      this.animationWarnings.add(warning);
      this.scriptMessages.push(warning);
    }
    return this.cameras.advanceScene(animated.scene, Math.max(0, Math.min(0.25, elapsedSeconds)));
  }

  /** Execute a one-shot Console script against the live Play scene. */
  runConsoleCommand(scene: Scene, source: string): ReturnType<typeof ScriptRuntime.runOnce> {
    const result = ScriptRuntime.runOnce(scene, source, (id, method, args) => this.runtime?.applyScriptAction(id, method, args) ?? false);
    this.runtime?.syncSceneEdits(scene, result.scene);
    this.scripts?.setScene(result.scene);
    return result;
  }

  stop(): Scene | null {
    this.playRequest += 1;
    this.starting = false;
    const snapshot = this.snapshot;
    this.runtime?.dispose();
    this.scripts = null;
    this.startedScene = null;
    this.runtime = null;
    this.snapshot = null;
    this.animationWarnings.clear();
    this.state = "stopped";
    this.cameras.reset();
    return snapshot ? structuredClone(snapshot) : null;
  }

  takeScriptMessages(): string[] { return this.scriptMessages.splice(0); }
  /** Keyboard and click input for "when space is pressed", "key left is pressed", and "when clicked". */
  pressKey(key: string): void { if (this.state === "playing") this.scripts?.pressKey(key); }
  releaseKey(key: string): void { this.scripts?.releaseKey(key); }
  releaseAllKeys(): void { this.scripts?.releaseAllKeys(); }
  click(id: string): void { if (this.state === "playing") this.scripts?.click(id); }
  setScriptParameter(entityId: string, name: string, value: unknown): boolean {
    return this.scripts?.setParameter(entityId, name, value) ?? false;
  }
  get initialScene(): Scene | null { return this.startedScene ? structuredClone(this.startedScene) : null; }
  get originalScene(): Scene | null { return this.snapshot ? structuredClone(this.snapshot) : null; }
}
