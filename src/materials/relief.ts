import * as THREE from "three";

const depths = new WeakMap<THREE.MeshStandardMaterial, { value: number }>();
export const DEFAULT_RELIEF_DEPTH = 0.035;

/** Bounded parallax occlusion: view-dependent depth without extra mesh vertices.
 * Detail map R is ambient occlusion; G is height (white is highest).
 * Derivatives convert meters into each face's UV units, including custom tiling. */
const reliefShader = /* glsl */`
#ifdef USE_AOMAP
uniform float simuReliefDepth;
vec2 simuReliefOffset(vec2 uv) {
  if (simuReliefDepth <= 0.0) return vec2(0.0);
  vec3 px = dFdx(-vViewPosition), py = dFdy(-vViewPosition);
  vec2 ux = dFdx(uv), uy = dFdy(uv);
  float determinant = ux.x * uy.y - ux.y * uy.x;
  if (abs(determinant) < 0.0000000001) return vec2(0.0);
  vec3 tangent = (px * uy.y - py * ux.y) / determinant;
  vec3 bitangent = (py * ux.x - px * uy.x) / determinant;
  vec3 n = normalize(cross(px, py));
  vec3 view = normalize(vViewPosition);
  float facing = max(abs(dot(n, view)), 0.18);
  vec2 direction = vec2(dot(view, normalize(tangent)) / max(length(tangent), 0.0001),
                        dot(view, normalize(bitangent)) / max(length(bitangent), 0.0001));
  vec2 stepUv = direction * simuReliefDepth / (facing * 16.0);
  vec2 current = uv;
  float layer = 0.0;
  float surface = 1.0 - textureGrad(aoMap, current, ux, uy).g;
  for (int i = 0; i < 16; i++) {
    if (layer >= surface) break;
    current -= stepUv;
    layer += 0.0625;
    surface = 1.0 - textureGrad(aoMap, current, ux, uy).g;
  }
  vec2 previous = current + stepUv;
  float after = surface - layer;
  float before = 1.0 - textureGrad(aoMap, previous, ux, uy).g - layer + 0.0625;
  float denominator = after - before;
  float weight = abs(denominator) > 0.00001 ? clamp(after / denominator, 0.0, 1.0) : 0.0;
  return mix(current, previous, weight) - uv;
}
#endif
`;

export function syncSurfaceRelief(material: THREE.MeshStandardMaterial, fields: Record<string, unknown>): void {
  let depth = depths.get(material);
  if (!depth) {
    depth = { value: DEFAULT_RELIEF_DEPTH };
    depths.set(material, depth);
    const uniform = depth;
    material.customProgramCacheKey = () => "simustyle-surface-relief-v1";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.simuReliefDepth = uniform;
      shader.fragmentShader = shader.fragmentShader.replace("#include <aomap_pars_fragment>", `#include <aomap_pars_fragment>\n${reliefShader}`);
      for (const name of ["map_fragment", "normal_fragment_maps", "roughnessmap_fragment", "metalnessmap_fragment", "aomap_fragment"] as const) {
        const chunk = THREE.ShaderChunk[name].replace(/\bv(?:Map|NormalMap|RoughnessMap|MetalnessMap|AoMap)Uv\b/g, (uv) => `(${uv} + simuOffset)`);
        const initialize = name === "map_fragment" ? `vec2 simuOffset = vec2(0.0);\n#ifdef USE_AOMAP\nsimuOffset = simuReliefOffset(vAoMapUv);\n#endif\n` : "";
        shader.fragmentShader = shader.fragmentShader.replace(`#include <${name}>`, initialize + chunk);
      }
    };
  }
  depth.value = typeof fields.reliefDepth === "number" && Number.isFinite(fields.reliefDepth)
    ? Math.max(0, Math.min(0.1, fields.reliefDepth)) : DEFAULT_RELIEF_DEPTH;
  material.aoMapIntensity = typeof fields.occlusionStrength === "number" && Number.isFinite(fields.occlusionStrength)
    ? Math.max(0, Math.min(2, fields.occlusionStrength)) : 1;
}
