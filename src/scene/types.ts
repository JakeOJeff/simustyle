export type Vec3 = [number, number, number];

export interface SceneSettings {
  gravity: Vec3;
  background: string;
  fixedTimestep: number;
  ambientLightIntensity: number;
  /** When false, objects pass through each other (the floor stays solid) and touch events stop. */
  collisions: boolean;
}

export interface Entity {
  id: string;
  name: string;
  parent: string | null;
  components: Record<string, Record<string, unknown>>;
}

export interface Scene {
  version: 1;
  /** Optional user-facing name; older scene files remain valid without it. */
  name?: string;
  settings: SceneSettings;
  entities: Entity[];
}

export type SceneOp =
  | { op: "create"; id: string; name: string; parent: string | null; components: Record<string, Record<string, unknown>> }
  | { op: "update"; id: string; components: Record<string, Record<string, unknown> | null>; parent?: string | null; name?: string }
  | { op: "delete"; id: string }
  | { op: "settings"; settings: Partial<SceneSettings> };

export interface ApplyOpsResult {
  scene: Scene;
  inverseOps: SceneOp[];
  errors: string[];
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  gravity: [0, -9.81, 0],
  background: "#202124",
  fixedTimestep: 1 / 60,
  ambientLightIntensity: 0.5,
  collisions: true
};

export function createEmptyScene(): Scene {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SCENE_SETTINGS),
    entities: []
  };
}
