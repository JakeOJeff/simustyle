import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import { PhysicsRuntime } from "../../src/runtime/physics";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { applyOps } from "../../src/scene/applyOps";
import { worldMatrix } from "../../src/scene/hierarchy";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { createEmptyScene, type Scene, type SceneOp, type Vec3 } from "../../src/scene/types";

function build(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

function subject(components: Record<string, Record<string, unknown>> = {}): SceneOp {
  return { op: "create", id: "subject", name: "Subject", parent: null, components: {
    Transform: { position: [0, 5, 0] }, Mesh: { shape: "sphere" }, RigidBody: {}, ...components
  } };
}

function dynamicBody(runtime: PhysicsRuntime): RigidBody {
  let found: RigidBody | undefined;
  runtime.world.forEachRigidBody((body) => { if (body.isDynamic()) found = body; });
  expect(found).toBeDefined();
  return found!;
}

function step(runtime: PhysicsRuntime, scene: Scene, frames = 60): Scene {
  for (let frame = 0; frame < frames; frame++) scene = runtime.advance(scene, 1 / 60);
  return scene;
}

function rampScene(friction = 0.8, anchored = false): Scene {
  const rotation: Vec3 = [-70, 25, 0];
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3));
  const start = new THREE.Vector3(0, 0, 0.52).applyQuaternion(orientation).add(new THREE.Vector3(0, 5, 0));
  return build([
    { op: "create", id: "ramp", name: "Ramp", parent: null, components: {
      Transform: { position: [0, 5, 0], rotation, scale: [2, 3, 1] }, Mesh: { shape: "plane", radius: 3 },
      RigidBody: { bodyType: anchored ? "dynamic" : "static", ...(anchored ? { anchored: true } : {}), friction, restitution: 0 }
    } },
    subject({ Transform: { position: start.toArray() }, RigidBody: { friction, restitution: 0 } })
  ]);
}

describe("rigid-body behavior", () => {
  it.each(["sphere", "box", "cylinder", "cone", "capsule", "plane"])("gives a %s its configured mass and rotational inertia", async (shape) => {
    const scene = build([subject({ Mesh: { shape }, RigidBody: { mass: 3 } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const body = dynamicBody(runtime);
      expect(body.mass()).toBeCloseTo(3);
      const inertia = body.principalInertia();
      expect(Math.min(inertia.x, inertia.y, inertia.z)).toBeGreaterThan(0);
      body.applyTorqueImpulse({ x: 0.1, y: 0.2, z: 0.3 }, true);
      const spin = body.angvel();
      expect(Math.hypot(spin.x, spin.y, spin.z)).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
  });

  it.each([false, true])("rolls down a rotated plane with friction (anchored=%s)", async (anchored) => {
    const initial = rampScene(0.8, anchored);
    const runtime = await PhysicsRuntime.create(initial);
    try {
      const scene = step(runtime, initial);
      const body = dynamicBody(runtime);
      const position = new THREE.Vector3(...scene.entities[1].components.Transform.position as Vec3);
      const start = new THREE.Vector3(...initial.entities[1].components.Transform.position as Vec3);
      expect(position.distanceTo(start)).toBeGreaterThan(0.5);
      // The ball stays on the rendered surface while moving downhill.
      const local = position.clone().applyMatrix4(worldMatrix(scene, "ramp").invert());
      expect(local.z).toBeCloseTo(0.51, 1);
      expect(position.y).toBeLessThan(start.y - 0.1);
      const velocity = body.linvel(), spin = body.angvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      expect(Math.hypot(spin.x, spin.y, spin.z) * 0.5).toBeCloseTo(speed, 1);
      expect(scene.entities[0].components.Transform).toEqual(initial.entities[0].components.Transform);
    } finally { runtime.dispose(); }
  });

  it("slides without spinning on a frictionless slope", async () => {
    const scene = rampScene(0);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      step(runtime, scene);
      const body = dynamicBody(runtime), spin = body.angvel(), velocity = body.linvel();
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeGreaterThan(1);
      expect(Math.hypot(spin.x, spin.y, spin.z)).toBeLessThan(0.001);
    } finally { runtime.dispose(); }
  });

  it("keeps multi-axis physics rotations aligned with the viewport", async () => {
    const scene = build([{ op: "settings", settings: { gravity: [0, 0, 0] } }, subject({ Transform: { position: [0, 5, 0], rotation: [25, 40, 60] } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const body = dynamicBody(runtime), actual = body.rotation();
      const expected = new THREE.Quaternion().setFromRotationMatrix(worldMatrix(scene, "subject"));
      expect(Math.abs(expected.dot(new THREE.Quaternion(actual.x, actual.y, actual.z, actual.w)))).toBeCloseTo(1, 6);
      const after = step(runtime, scene, 1);
      worldMatrix(after, "subject").elements.forEach((value, index) => expect(value).toBeCloseTo(worldMatrix(scene, "subject").elements[index], 5));
    } finally { runtime.dispose(); }
  });

  it("uses separate box dimensions instead of inflating its narrow axis", async () => {
    const scene = build([subject({ Mesh: { shape: "box" }, Transform: { position: [0, 5, 0], scale: [4, 2, 0.5] } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const half = dynamicBody(runtime).collider(0).halfExtents();
      expect(half).toEqual({ x: 2, y: 1, z: 0.25 });
    } finally { runtime.dispose(); }
  });

  it("does not tunnel through a thin plane at high speed", async () => {
    const scene = build([
      { op: "create", id: "wall", name: "Wall", parent: null, components: { Transform: { position: [0, 5, 0] }, Mesh: { shape: "plane", radius: 3 }, Collider: {} } },
      subject({ Transform: { position: [0, 5, 2] }, Mesh: { shape: "sphere", radius: 0.1 }, RigidBody: { initialVelocity: [0, 0, -300], restitution: 0 } })
    ]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const after = step(runtime, scene, 4);
      expect((after.entities[1].components.Transform.position as Vec3)[2]).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
  });

  it.each(["sphere", "cylinder", "capsule", "cone"])("fits the narrow axis of a nonuniformly scaled %s", async (shape) => {
    const scene = build([subject({ Mesh: { shape }, Transform: { position: [0, 5, 0], scale: [4, 2, 0.5] } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const collider = dynamicBody(runtime).collider(0);
      expect(collider.containsPoint({ x: 0, y: 5, z: 0.1 })).toBe(true);
      expect(collider.containsPoint({ x: 0, y: 5, z: 0.4 })).toBe(false);
      expect(collider.containsPoint({ x: 0.5, y: 5, z: 0 })).toBe(true);
      expect(collider.containsPoint({ x: 2.1, y: 5, z: 0 })).toBe(false);
    } finally { runtime.dispose(); }
  });

  it("can receive an impulse immediately after creation", async () => {
    const scene = build([subject({ RigidBody: { mass: 2 } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      expect(runtime.applyScriptAction("subject", "applyImpulse", [4, 0, 0])).toBe(true);
      expect(dynamicBody(runtime).linvel().x).toBeCloseTo(2);
    } finally { runtime.dispose(); }
  });

  it("explains why a push script cannot move an anchored object", () => {
    const scene = build([subject({ RigidBody: { anchored: true }, Script: { source: "when game starts\n  push up 10" } })]);
    const scripts = new ScriptRuntime(scene);
    scripts.start();
    expect(scripts.takeIssues().map((issue) => issue.message).join(" ")).toContain("Anchor off");
  });

  it("keeps an anchored collider aligned with explicit scripted moves", async () => {
    const scene = build([subject({ RigidBody: { anchored: true } })]);
    const runtime = await PhysicsRuntime.create(scene);
    try {
      const moved = applyOps(scene, [{ op: "update", id: "subject", components: { Transform: { position: [2, 7, 0] } } }]).scene;
      runtime.advance(moved, 1 / 60);
      let found = false;
      runtime.world.forEachCollider((collider) => {
        const p = collider.translation();
        if (Math.abs(p.x - 2) < 1e-6 && Math.abs(p.y - 7) < 1e-6) found = true;
      });
      expect(found).toBe(true);
    } finally { runtime.dispose(); }
  });

  it("saves Anchor, ignores impulses while anchored, and resumes falling when released", async () => {
    const initial = deserializeScene(serializeScene(build([subject({ RigidBody: { anchored: true } })])));
    expect(initial.entities[0].components.RigidBody.anchored).toBe(true);
    const runtime = await PhysicsRuntime.create(initial);
    try {
      expect(runtime.applyScriptAction("subject", "applyImpulse", [20, 20, 20])).toBe(false);
      let scene = step(runtime, initial);
      expect(scene.entities[0].components.Transform).toEqual(initial.entities[0].components.Transform);
      const released = applyOps(scene, [{ op: "update", id: "subject", components: { RigidBody: { anchored: false } } }]).scene;
      runtime.syncSceneEdits(scene, released);
      scene = step(runtime, released, 15);
      expect((scene.entities[0].components.Transform.position as Vec3)[1]).toBeLessThan(4.9);
      const anchored = applyOps(scene, [{ op: "update", id: "subject", components: { RigidBody: { anchored: true } } }]).scene;
      runtime.syncSceneEdits(scene, anchored);
      expect(step(runtime, anchored).entities[0].components.Transform).toEqual(anchored.entities[0].components.Transform);
    } finally { runtime.dispose(); }
  });
});
