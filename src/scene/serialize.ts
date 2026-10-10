import { componentSchemas } from "../registry";
import { DEFAULT_SCENE_SETTINGS, type Entity, type Scene, type SceneSettings } from "./types";
import { validateScene } from "./validate";

interface SavedScene {
  version: 1;
  settings: Partial<SceneSettings>;
  entities: Entity[];
}

function omitDefaultFields(componentName: string, fields: Record<string, unknown>): Record<string, unknown> {
  const schema = componentSchemas[componentName];
  if (!schema) return structuredClone(fields);
  return Object.fromEntries(Object.entries(fields).filter(([name, value]) => {
    const field = schema.fields[name];
    if (field && JSON.stringify(value) === JSON.stringify(field.default)) return false;
    if (schema.managedFields?.[name] === "animationTracks" && Array.isArray(value) && value.length === 0) return false;
    return true;
  }).map(([name, value]) => [name, structuredClone(value)]));
}

export function serializeScene(scene: Scene): string {
  const errors = validateScene(scene);
  if (errors.length) throw new Error(`Cannot serialize invalid scene: ${errors.join("; ")}`);
  const saved: SavedScene = {
    version: 1,
    settings: Object.fromEntries(Object.entries(scene.settings).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(DEFAULT_SCENE_SETTINGS[key as keyof SceneSettings])
    )) as Partial<SceneSettings>,
    entities: scene.entities.map((entity) => ({
      ...structuredClone(entity),
      components: Object.fromEntries(Object.entries(entity.components).map(([name, fields]) => [name, omitDefaultFields(name, fields)]))
    }))
  };
  return JSON.stringify(saved, null, 2);
}

export function deserializeScene(json: string): Scene {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Scene file is not valid JSON: ${reason}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Scene file must contain an object.");
  const raw = value as Record<string, unknown>;
  if (typeof raw.settings !== "object" || raw.settings === null || Array.isArray(raw.settings)) {
    throw new Error("Scene file must include a settings object.");
  }
  const scene = {
    version: raw.version,
    settings: { ...structuredClone(DEFAULT_SCENE_SETTINGS), ...raw.settings },
    entities: raw.entities
  } as unknown as Scene;
  const errors = validateScene(scene);
  if (errors.length) throw new Error(`Scene file is invalid: ${errors.join("; ")}`);
  return scene;
}
