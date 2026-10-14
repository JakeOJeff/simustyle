import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { activeCamera, CameraRig, createDefaultScene, moveCameraOp } from "../../src/runtime/camera";
import { ScriptRuntime, scriptOps } from "../../src/runtime/scripts";
import { applyOps } from "../../src/scene/applyOps";
import { worldMatrix } from "../../src/scene/hierarchy";
import { validateScene } from "../../src/scene/validate";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { createThreeScene } from "../../src/export/gltf";
import { scriptProblems } from "../../src/lang/autocorrect";
import { SimulationController } from "../../src/runtime/physics";
import type { Scene } from "../../src/scene/types";

function fixture(): Scene {
  const scene = createDefaultScene();
  scene.entities.push(
    { id: "rig", name: "Rig", parent: null, components: { Transform: { position: [10, 0, 0], rotation: [0, 90, 0] } } },
    { id: "player", name: "Player", parent: "rig", components: { Transform: { position: [0, 1, -2] } } },
    { id: "lamp", name: "Lamp", parent: null, components: { Transform: {}, Light: {} } }
  );
  return scene;
}

describe("scene cameras", () => {
  it("starts with a saved, scriptable camera aimed near the origin", () => {
    const scene = createDefaultScene();
    expect(validateScene(scene)).toEqual([]);
    expect(activeCamera(scene)?.id).toBe("camera");
    const camera = new CameraRig().update(scene, new Map(), 2, 0)!;
    const aim = new THREE.Vector3(0, 0.8, 0).sub(camera.position).normalize();
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(aim)).toBeLessThan(1e-8);
    expect(activeCamera(deserializeScene(serializeScene(scene)))?.id).toBe("camera");
  });

  it("switches cameras and validates lens parameters from scene scripts", () => {
    const scene = fixture();
    const source = 'let overview = camera.create("Overview", 0, 10, 10)\ncamera.use(overview)\ncamera.set("fov", 65)\ncamera.set("projection", "orthographic")\ncamera.set("orthoSize", 12)\ncamera.set("zoom", 2)\ncamera.aim(0, 0, 0)\n';
    expect(scriptProblems(source, new Set())).toEqual([]);
    const result = ScriptRuntime.runOnce(scene, source);
    expect(result.issues).toEqual([]);
    expect(result.scene.entities.filter((entity) => entity.components.Camera?.isActive)).toHaveLength(1);
    expect(activeCamera(result.scene)?.name).toBe("Overview");
    const camera = new CameraRig().update(result.scene, new Map(), 2, 0) as THREE.OrthographicCamera;
    expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect(camera.top).toBe(6); expect(camera.right).toBe(12); expect(camera.zoom).toBe(2);
    const rejected = ScriptRuntime.runOnce(result.scene, 'camera.set("near", 2000)');
    expect(rejected.issues[0]?.message).toContain("near");
    expect(rejected.scene).toEqual(result.scene);
  });

  it("moves in local camera axes under a rotated parent", () => {
    const scene = fixture(); const entity = scene.entities[0]!;
    entity.parent = "rig"; entity.components.Transform = {};
    const moved = applyOps(scene, [moveCameraOp(scene, entity, [0, 0, -2])]);
    expect(moved.errors).toEqual([]);
    expect(moved.scene.entities[0]!.components.Transform.position).toEqual([0, 0, -2]);
    const world = new THREE.Vector3().setFromMatrixPosition(worldMatrix(moved.scene, entity.id));
    expect(world.x).toBeCloseTo(8); expect(world.z).toBeCloseTo(0);
  });

  it("follows a parented target, aims at it, and carries children", () => {
    const scene = fixture();
    const result = ScriptRuntime.runOnce(scene, 'camera.follow(find("Player"), 0, 3, 6, 5)\ncamera.attach(find("Lamp"), 0, 0, -1)');
    expect(result.issues).toEqual([]);
    const applied = applyOps(scene, scriptOps(scene, result.scene));
    expect(applied.errors).toEqual([]);
    expect(applied.scene.entities.find((entity) => entity.id === "lamp")?.parent).toBe("camera");
    const output = createThreeScene(applied.scene);
    const cameraObject = output.getObjectByName("Camera")!;
    expect(cameraObject.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([8, 4, 6]);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObject.getWorldQuaternion(new THREE.Quaternion()));
    const lamp = output.getObjectByName("Lamp")!;
    expect(lamp.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(8, 4, 6).add(forward))).toBeLessThan(1e-8);
  });

  it("smooths following with timestep independent damping and freezes at dt zero", () => {
    const scene = fixture(); scene.entities[0]!.components.Camera = { followTarget: "player", followOffset: [0, 0, 0], followDamping: 5 };
    const rig = new CameraRig();
    expect(rig.update(scene, new Map(), 1, 0)!.position.x).toBeCloseTo(8);
    scene.entities[1]!.components.Transform.position = [20, 0, 0];
    expect(rig.update(scene, new Map(), 1, 0)!.position.x).toBeCloseTo(8);
    expect(rig.update(scene, new Map(), 1, 0.2)!.position.x).toBeCloseTo(8 + 10 * (1 - Math.exp(-1)));
    rig.reset(); expect(rig.update(scene, new Map(), 1, 0)!.position.x).toBeCloseTo(18);
  });

  it("rejects camera dependency cycles and clears deleted targets with undo", () => {
    const scene = fixture();
    const assigned = applyOps(scene, [{ op: "update", id: "camera", components: { Camera: { followTarget: "player" } } }]);
    const undone = applyOps(assigned.scene, assigned.inverseOps);
    expect(undone.errors).toEqual([]); expect(undone.scene).toEqual(scene);
    const attached = ScriptRuntime.runOnce(scene, 'camera.attach("Lamp", 0, 0, -1)').scene;
    expect(ScriptRuntime.runOnce(attached, 'camera.lookAt("Lamp")').issues[0]?.message).toContain("cycle");
    const following = ScriptRuntime.runOnce(scene, 'camera.follow("Player", 0, 3, 6)').scene;
    const deleted = applyOps(following, [{ op: "delete", id: "player" }]);
    expect(deleted.errors).toEqual([]);
    expect(deleted.scene.entities[0]!.components.Camera.followTarget).toBeUndefined();
    const restored = applyOps(deleted.scene, deleted.inverseOps);
    expect(restored.errors).toEqual([]); expect(restored.scene.entities[0]!.components.Camera.followTarget).toBe("player");
  });

  it("transfers cleared defaults and attachment changes through scriptOps", () => {
    const scene = fixture();
    const setup = ScriptRuntime.runOnce(scene, 'camera.set("fov", 70)\ncamera.follow("Player", 0, 3, 6)\ncamera.attach("Lamp", 1, 0, -1)').scene;
    const result = ScriptRuntime.runOnce(setup, 'camera.set("fov", 50)\ncamera.unfollow()\ncamera.detach("Lamp")');
    expect(result.issues).toEqual([]);
    const applied = applyOps(setup, scriptOps(setup, result.scene));
    expect(applied.errors).toEqual([]); expect(applied.scene).toEqual(result.scene);
  });

  it("exports orthographic lenses and preserves camera parenting", () => {
    const scene = fixture(); scene.entities[0]!.parent = "rig";
    scene.entities[0]!.components.Camera = { isActive: true, projection: "orthographic", orthoSize: 20, zoom: 2, near: 1, far: 200 };
    const output = createThreeScene(scene);
    const camera = output.getObjectByName("Camera") as THREE.OrthographicCamera;
    expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect(camera.parent?.name).toBe("Rig"); expect(camera.near).toBe(1); expect(camera.far).toBe(200); expect(camera.zoom).toBe(2); expect(camera.top).toBe(10);
  });

  it("releases following and detaches children at the live camera pose", () => {
    const scene = fixture();
    let live = ScriptRuntime.runOnce(scene, 'camera.follow("Player", 0, 3, 6, 5)\ncamera.attach("Lamp", 1, 0, -1)').scene;
    const rig = new CameraRig(); live = rig.advanceScene(live, 0);
    live = applyOps(live, [{ op: "update", id: "rig", components: { Transform: { position: [20, 0, 0] } } }]).scene;
    live = rig.advanceScene(live, 0.1);
    const before = worldMatrix(live, "lamp");
    const release = ScriptRuntime.runOnce(live, 'camera.unfollow()\ncamera.detach("Lamp")');
    expect(release.issues).toEqual([]);
    const after = worldMatrix(release.scene, "lamp");
    after.elements.forEach((part, index) => expect(part).toBeCloseTo(before.elements[index]!, 5));
    expect(release.scene.entities[0]!.components.Transform).toEqual(live.entities[0]!.components.Transform);
  });

  it("runs camera scripts and following through Play, Step, and Stop snapshots", async () => {
    const scene = fixture();
    scene.entities[0]!.components.Script = { source: 'when game starts\n  camera.follow("Player", 0, 3, 6)\n  camera.attach("Lamp", 0, 0, -1)\n' };
    const controller = new SimulationController();
    await controller.play(scene);
    try {
      expect(controller.state).toBe("playing");
      let live = controller.initialScene!;
      expect(live.entities.find((entity) => entity.id === "lamp")?.parent).toBe("camera");
      expect(live.entities[0]!.components.Transform.position).toEqual([8, 4, 6]);
      live = applyOps(live, [{ op: "update", id: "rig", components: { Transform: { position: [20, 0, 0] } } }]).scene;
      controller.pause(); expect(controller.advance(live, 0.1)).toBe(live);
      controller.resume();
      const stepped = controller.advance(live, 1 / 60);
      controller.pause();
      expect(stepped.entities[0]!.components.Transform.position).toEqual([18, 4, 6]);
      expect(controller.stop()).toEqual(scene);
    } finally { controller.stop(); }
  });
});
