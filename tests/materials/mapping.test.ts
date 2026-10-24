import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applySurfaceMapping } from "../../src/materials/mapping";
import { createThreeScene } from "../../src/export/gltf";
import { createEmptyScene } from "../../src/scene/types";

function uvExtents(mesh: THREE.Mesh, axis?: "x" | "y" | "z") {
  const uv = mesh.geometry.getAttribute("uv"), normal = mesh.geometry.getAttribute("normal");
  const u: number[] = [], v: number[] = [];
  for (let i = 0; i < uv.count; i++) {
    if (axis && Math.abs(normal[axis === "x" ? "getX" : axis === "y" ? "getY" : "getZ"](i)) < 0.999) continue;
    u.push(uv.getX(i)); v.push(uv.getY(i));
  }
  return [Math.max(...u) - Math.min(...u), Math.max(...v) - Math.min(...v)];
}

describe("automatic texture mapping", () => {
  it("maps each box face by its dimensions, including ancestor scale", () => {
    const group = new THREE.Group(); group.scale.set(2, 3, 4); group.rotation.y = 0.7;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2));
    mesh.scale.set(5, 1, 2); group.add(mesh);
    applySurfaceMapping(mesh, { radius: 1, height: 3 }, { texture: "bricks" });
    expect(uvExtents(mesh, "x")).toEqual([16, 9]);
    expect(uvExtents(mesh, "y")).toEqual([20, 16]);
    expect(uvExtents(mesh, "z")).toEqual([20, 9]);
  });

  it("tracks resizing without cumulative UV changes; stretch/custom restore the originals", () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    mesh.scale.set(8, 5, 1); mesh.rotation.x = -Math.PI / 2;
    const uv = mesh.geometry.getAttribute("uv");
    const base = Array.from(uv.array);
    applySurfaceMapping(mesh, { shape: "plane" }, { texture: "grass" });
    expect(uvExtents(mesh)).toEqual([8, 5]);
    const version = (uv as THREE.BufferAttribute).version;
    applySurfaceMapping(mesh, { shape: "plane" }, { texture: "grass" });
    expect((uv as THREE.BufferAttribute).version).toBe(version);
    mesh.scale.x = 12;
    applySurfaceMapping(mesh, { shape: "plane" }, { texture: "grass" });
    expect(uvExtents(mesh)).toEqual([12, 5]);
    for (const mode of ["stretch", "custom"]) {
      applySurfaceMapping(mesh, { shape: "plane" }, { texture: "grass", textureMapping: mode });
      expect(Array.from(uv.array)).toEqual(base);
      applySurfaceMapping(mesh, { shape: "plane" }, { texture: "grass" });
      expect(uvExtents(mesh)).toEqual([12, 5]);
    }
    applySurfaceMapping(mesh, { shape: "plane" }, { texture: "none" });
    expect(Array.from(uv.array)).toEqual(base);
  });

  it("uses circumference for curved surfaces and planar UVs on cylinder caps", () => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 24));
    mesh.scale.set(2, 4, 2);
    applySurfaceMapping(mesh, { shape: "cylinder", radius: 1, height: 3 }, { texture: "wood" });
    expect(uvExtents(mesh, "y")).toEqual([4, 4]);
    const uv = mesh.geometry.getAttribute("uv");
    expect(Math.max(...Array.from(uv.array).filter((_, index) => index % 2 === 0))).toBeCloseTo(4 * Math.PI);
    expect(Math.max(...Array.from(uv.array).filter((_, index) => index % 2 === 1))).toBeCloseTo(12);
    for (const [shape, geometry] of [
      ["sphere", new THREE.SphereGeometry(1)], ["cone", new THREE.ConeGeometry(1, 3)], ["capsule", new THREE.CapsuleGeometry(1, 1)]
    ] as const) {
      applySurfaceMapping(new THREE.Mesh(geometry), { shape, radius: 1, height: 3 }, { texture: "rock" });
      expect(Array.from(geometry.getAttribute("uv").array).every(Number.isFinite)).toBe(true);
    }
  });

  it("bakes the same automatic mapping into exported geometry with child-first parents", () => {
    const scene = createEmptyScene();
    scene.entities = [
      { id: "floor", name: "Floor", parent: "room", components: { Transform: { scale: [5, 2, 1] }, Mesh: { shape: "plane" }, Material: { texture: "wood_floor" } } },
      { id: "room", name: "Room", parent: null, components: { Transform: { scale: [2, 3, 1] } } }
    ];
    const output = createThreeScene(scene);
    expect(uvExtents(output.getObjectByName("Floor") as THREE.Mesh)).toEqual([10, 6]);
  });

  it("automatically repeats a normal map on an untextured surface", () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    mesh.scale.set(5, 3, 1);
    applySurfaceMapping(mesh, { shape: "plane" }, { normalTexture: "bricks" });
    expect(uvExtents(mesh)).toEqual([5, 3]);
    applySurfaceMapping(mesh, { shape: "plane" }, { normalTexture: "none" });
    expect(uvExtents(mesh)).toEqual([1, 1]);
  });
});
