import * as RAPIER from "@dimforge/rapier3d-compat";
import { applyOps } from "../scene/applyOps";
import type { Entity, Scene, Vec3 } from "../scene/types";
import { ScriptRuntime, scriptOps } from "./scripts";

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
  const [x, y, z] = rotation.map((degrees) => degrees * Math.PI / 360) as Vec3;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  };
}

function rotationToEuler(rotation: RAPIER.Rotation): Vec3 {
  const { x, y, z, w } = rotation;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const pitch = Math.asin(sinPitch);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [roll, pitch, yaw].map((radians) => radians * 180 / Math.PI) as Vec3;
}

function colliderFor(entity: Entity): RAPIER.ColliderDesc {
  const mesh = record(entity, "Mesh");
  const transform = record(entity, "Transform");
  const scale = vector(transform.scale, [1, 1, 1]);
  const radius = Math.max(0.005, number(mesh.radius, 0.5) * Math.max(Math.abs(scale[0]), Math.abs(scale[2])));
  const height = Math.max(0.01, number(mesh.height, 1) * Math.abs(scale[1]));
  switch (mesh.shape) {
    case "sphere": return RAPIER.ColliderDesc.ball(radius);
    case "cylinder": return RAPIER.ColliderDesc.cylinder(height / 2, radius);
    case "capsule": return RAPIER.ColliderDesc.capsule(Math.max(0, height / 2 - radius), radius);
    case "plane": return RAPIER.ColliderDesc.cuboid(radius, 0.01, radius);
    case "cone": return RAPIER.ColliderDesc.cone(height / 2, radius);
    case "box": return RAPIER.ColliderDesc.cuboid(radius, height / 2, radius);
    default: return RAPIER.ColliderDesc.ball(radius);
  }
}

export class PhysicsRuntime {
  readonly world: RAPIER.World;
  readonly warnings: string[] = [];
  private readonly bodies = new Map<string, BodyEntry>();
  private readonly colliderEntities = new Map<number, string>();
  private activeContacts = new Set<string>();
  private accumulator = 0;
  private readonly fixedTimestep: number;

  private constructor(scene: Scene) {
    this.world = new RAPIER.World({ x: scene.settings.gravity[0], y: scene.settings.gravity[1], z: scene.settings.gravity[2] });
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
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setFriction(0.8), body);
  }

  private createBodies(scene: Scene): void {
    for (const entity of scene.entities) {
      const data = record(entity, "RigidBody");
      if (!entity.components.RigidBody) continue;
      const transform = record(entity, "Transform");
      const position = vector(transform.position, [0, 0, 0]);
      const rotation = eulerToRotation(vector(transform.rotation, [0, 0, 0]));
      const type = typeof data.bodyType === "string" ? data.bodyType : "dynamic";
      const descriptor = type === "static"
        ? RAPIER.RigidBodyDesc.fixed()
        : type === "kinematic"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();
      descriptor.setTranslation(position[0], position[1], position[2]).setRotation(rotation);
      if (type === "dynamic") {
        const velocity = vector(data.initialVelocity, [0, 0, 0]);
        descriptor.setAdditionalMass(number(data.mass, 1)).setLinvel(velocity[0], velocity[1], velocity[2]);
        descriptor.setLinearDamping(number(data.linearDamping, 0));
      }
      const body = this.world.createRigidBody(descriptor);
      const collider = colliderFor(entity)
        .setDensity(0)
        .setFriction(number(data.friction, 0.5))
        .setRestitution(number(data.restitution, 0.2));
      const physicsCollider = this.world.createCollider(collider, body);
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
    const body = this.bodies.get(id)?.body;
    if (!body) return false;
    if (method === "applyImpulse" && args.length === 3) body.applyImpulse({ x: args[0]!, y: args[1]!, z: args[2]! }, true);
    else if (method === "setVelocity" && args.length === 3) body.setLinvel({ x: args[0]!, y: args[1]!, z: args[2]! }, true);
    else return false;
    return true;
  }

  /** Accumulate wall-clock time and advance only in fixed simulation steps. */
  advance(scene: Scene, elapsedSeconds: number, onCollision?: (firstId: string, secondId: string) => void): Scene {
    this.accumulator += Math.max(0, Math.min(elapsedSeconds, 0.25));
    let changed = false;
    while (this.accumulator >= this.fixedTimestep) {
      for (const [id, entry] of this.bodies) {
        if (entry.type !== "kinematic") continue;
        const entity = scene.entities.find((candidate) => candidate.id === id);
        const position = vector(entity?.components.Transform?.position, [0, 0, 0]);
        entry.body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
      }
      this.world.step();
      const contacts = new Set<string>();
      for (const [id, entry] of this.bodies) {
        this.world.contactPairsWith(entry.collider, (otherCollider) => {
          const otherId = this.colliderEntities.get(otherCollider.handle);
          if (!otherId || otherId === id) return;
          const pair = [id, otherId].sort();
          const key = pair.join("\u0000");
          contacts.add(key);
          if (!this.activeContacts.has(key)) onCollision?.(pair[0]!, pair[1]!);
        });
      }
      this.activeContacts = contacts;
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

  dispose(): void {
    this.world.free();
    this.bodies.clear();
    this.colliderEntities.clear();
    this.activeContacts.clear();
  }
}

export class SimulationController {
  state: PlayState = "stopped";
  private runtime: PhysicsRuntime | null = null;
  private snapshot: Scene | null = null;
  private scripts: ScriptRuntime | null = null;
  private readonly scriptMessages: string[] = [];
  private startedScene: Scene | null = null;

  async play(scene: Scene): Promise<string[]> {
    if (this.state !== "stopped") return [];
    this.snapshot = structuredClone(scene);
    try {
      this.scripts = new ScriptRuntime(scene, 1, (id, method, args) => this.runtime?.applyScriptAction(id, method, args) ?? false);
      const initial = this.scripts.start();
      const initialOps = scriptOps(scene, initial);
      if (initialOps.length) {
        const result = applyOps(scene, initialOps);
        if (!result.errors.length) scene = result.scene;
      }
      this.startedScene = scene;
      this.scriptMessages.push(...this.scripts.takeIssues().map((issue) => `${issue.entityId}:${issue.line}:${issue.column} ${issue.message}`));
      this.runtime = await PhysicsRuntime.create(scene);
      this.state = "playing";
      return this.runtime.warnings;
    } catch (error) {
      this.snapshot = null;
      const reason = error instanceof Error ? error.message : String(error);
      return [`Could not start physics: ${reason}`];
    }
  }

  pause(): void {
    if (this.state === "playing") this.state = "paused";
  }

  resume(): void {
    if (this.state === "paused") this.state = "playing";
  }

  advance(scene: Scene, elapsedSeconds: number): Scene {
    if (this.state !== "playing" || !this.runtime) return scene;
    const before = scene;
    if (this.scripts) scene = this.scripts.advance(elapsedSeconds);
    const operations = scriptOps(before, scene);
    if (operations.length) {
      const result = applyOps(before, operations);
      if (result.errors.length) this.scriptMessages.push(...result.errors);
      else scene = result.scene;
    }
    const simulated = this.runtime.advance(scene, elapsedSeconds, (firstId, secondId) => {
      this.scripts?.collide(firstId, secondId);
      this.scripts?.collide(secondId, firstId);
    });
    if (this.scripts) {
      this.scriptMessages.push(...this.scripts.takeIssues().map((issue) => `${issue.entityId}:${issue.line}:${issue.column} ${issue.message}`));
      this.scriptMessages.push(...this.scripts.takePrints().map((entry) => `${entry.entityId}: ${entry.values.map(String).join(" ")}`));
    }
    return simulated;
  }

  stop(): Scene | null {
    const snapshot = this.snapshot;
    this.runtime?.dispose();
    this.scripts = null;
    this.startedScene = null;
    this.runtime = null;
    this.snapshot = null;
    this.state = "stopped";
    return snapshot ? structuredClone(snapshot) : null;
  }

  takeScriptMessages(): string[] { return this.scriptMessages.splice(0); }
  get initialScene(): Scene | null { return this.startedScene ? structuredClone(this.startedScene) : null; }
}
