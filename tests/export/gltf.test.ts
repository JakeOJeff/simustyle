import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEmptyScene, type Entity } from "../../src/scene";
import { createThreeScene } from "../../src/export/gltf";

describe("GLB scene conversion", () => {
  it("creates matching primitive geometry, material, transforms, and hierarchy", () => {
    const scene = createEmptyScene();
    const parent: Entity = {
      id: "parent",
      name: "Parent",
      parent: null,
      components: { Transform: { position: [2, 1, 0] } }
    };
    const child: Entity = {
      id: "child",
      name: "Red sphere",
      parent: "parent",
      components: {
        Transform: { position: [0, 0.5, 0], rotation: [0, 90, 0], scale: [2, 1, 1] },
        Mesh: { shape: "sphere", radius: 0.75 },
        Material: { color: "#ff0000", metalness: 0.4, roughness: 0.2, opacity: 0.5 }
      }
    };
    scene.entities = [child, parent];

    const converted = createThreeScene(scene);
    const mesh = converted.getObjectByName("Red sphere") as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect((mesh.geometry as THREE.SphereGeometry).parameters.radius).toBe(0.75);
    expect(mesh.parent?.name).toBe("Parent");
    expect(mesh.position.toArray()).toEqual([0, 0.5, 0]);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(mesh.scale.toArray()).toEqual([2, 1, 1]);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe("ff0000");
    expect(material.metalness).toBe(0.4);
    expect(material.opacity).toBe(0.5);
    expect(material.transparent).toBe(true);
  });

  it("includes explicit lights as exportable Three lights", () => {
    const scene = createEmptyScene();
    scene.entities = [{
      id: "light",
      name: "Key light",
      parent: null,
      components: { Transform: { position: [1, 2, 3] }, Light: { type: "directional", intensity: 2 } }
    }];
    const light = createThreeScene(scene).getObjectByName("Key light");
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect(light?.position.toArray()).toEqual([1, 2, 3]);
  });

  it("includes active camera components in the exported scene", () => {
    const scene = createEmptyScene();
    scene.entities = [{
      id: "camera",
      name: "Main camera",
      parent: null,
      components: { Transform: { position: [1, 2, 3] }, Camera: { fov: 60, isActive: true } }
    }];
    const camera = createThreeScene(scene).getObjectByName("Main camera");
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect((camera as THREE.PerspectiveCamera).fov).toBe(60);
    expect(camera?.position.toArray()).toEqual([1, 2, 3]);
  });
});
