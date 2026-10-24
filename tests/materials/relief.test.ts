import { expect, it } from "vitest";
import * as THREE from "three";
import { syncSurfaceRelief, DEFAULT_RELIEF_DEPTH } from "../../src/materials/relief";

it("updates relief depth on the existing material uniform without recompiling", () => {
  const material = new THREE.MeshStandardMaterial();
  syncSurfaceRelief(material, {});
  const shader = { uniforms: {}, vertexShader: "", fragmentShader: THREE.ShaderLib.standard.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.uniforms.simuReliefDepth?.value).toBe(DEFAULT_RELIEF_DEPTH);
  const version = material.version;
  syncSurfaceRelief(material, { reliefDepth: 0.06, occlusionStrength: 1.5 });
  expect(shader.uniforms.simuReliefDepth?.value).toBe(0.06);
  expect(material.aoMapIntensity).toBe(1.5);
  expect(material.version).toBe(version);
  syncSurfaceRelief(material, { reliefDepth: 0 });
  expect(shader.uniforms.simuReliefDepth?.value).toBe(0);
});

it("keeps each material's relief independent even when the shader program is shared", () => {
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
  syncSurfaceRelief(a, { reliefDepth: 0.02 }); syncSurfaceRelief(b, { reliefDepth: 0.07 });
  const shaderA = { uniforms: {}, vertexShader: "", fragmentShader: THREE.ShaderLib.standard.fragmentShader } as Parameters<typeof a.onBeforeCompile>[0];
  const shaderB: typeof shaderA = { ...shaderA, uniforms: {} };
  a.onBeforeCompile(shaderA, {} as THREE.WebGLRenderer); b.onBeforeCompile(shaderB, {} as THREE.WebGLRenderer);
  expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  expect(shaderA.uniforms.simuReliefDepth?.value).toBe(0.02);
  expect(shaderB.uniforms.simuReliefDepth?.value).toBe(0.07);
  expect(shaderA.uniforms.simuReliefDepth).not.toBe(shaderB.uniforms.simuReliefDepth);
});
