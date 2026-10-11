import { componentSchemas } from "../registry";
import type { FieldSchema } from "../registry/types";
import { isBezierPoints, isInterpolation } from "../runtime/easing";
import { DEFAULT_SCENE_SETTINGS, type Entity, type Scene, type SceneSettings } from "./types";

const settingSchemas: Record<keyof SceneSettings, FieldSchema> = {
  gravity: { type: "vec3", default: DEFAULT_SCENE_SETTINGS.gravity },
  background: { type: "color", default: DEFAULT_SCENE_SETTINGS.background },
  fixedTimestep: { type: "float", min: 0.001, max: 0.1, default: DEFAULT_SCENE_SETTINGS.fixedTimestep },
  ambientLightIntensity: { type: "float", min: 0, max: 10, default: DEFAULT_SCENE_SETTINGS.ambientLightIntensity },
  collisions: { type: "bool", default: DEFAULT_SCENE_SETTINGS.collisions }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAnimationTracks(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: must be an array`);
    return;
  }

  for (const [trackIndex, track] of value.entries()) {
    const trackPath = `${path}[${trackIndex}]`;
    if (!isRecord(track)) {
      errors.push(`${trackPath}: must be an object`);
      continue;
    }

    let keyField: FieldSchema | undefined;
    if (typeof track.component !== "string" || typeof track.field !== "string") {
      errors.push(`${trackPath}: component and field must be strings`);
    } else {
      const componentSchema = componentSchemas[track.component];
      if (!componentSchema) {
        errors.push(`${trackPath}.component: unknown component '${track.component}'`);
      } else {
        keyField = componentSchema.fields[track.field];
        if (!keyField) errors.push(`${trackPath}.field: unknown field '${track.field}' on ${track.component}`);
        else if (keyField.type !== "float" && keyField.type !== "vec3" && keyField.type !== "color") {
          errors.push(`${trackPath}.field: ${track.component}.${track.field} cannot be animated`);
          keyField = undefined;
        }
      }
    }

    if (!Array.isArray(track.keys)) {
      errors.push(`${trackPath}.keys: must be an array`);
      continue;
    }
    for (const [keyIndex, key] of track.keys.entries()) {
      const keyPath = `${trackPath}.keys[${keyIndex}]`;
      if (!isRecord(key)) {
        errors.push(`${keyPath}: must be an object`);
        continue;
      }
      if (typeof key.time !== "number" || !Number.isFinite(key.time)) {
        errors.push(`${keyPath}.time: must be a finite number`);
      } else if (key.time < 0) {
        errors.push(`${keyPath}.time: must be nonnegative`);
      }
      if (key.interpolation !== undefined && !isInterpolation(key.interpolation)) {
        errors.push(`${keyPath}.interpolation: must be linear, step, ease-in-out, bezier, or ease-<in|out|in-out>-<sine|quad|cubic|quart|quint|expo|circ|back|elastic|bounce>`);
      }
      if (key.bezier !== undefined && !isBezierPoints(key.bezier)) {
        errors.push(`${keyPath}.bezier: must be [x1, y1, x2, y2] with x values in 0..1 and y values in -2..3`);
      }
      if (keyField) {
        const validValue = keyField.type === "float"
          ? typeof key.value === "number" && Number.isFinite(key.value)
          : keyField.type === "vec3"
            ? Array.isArray(key.value) && key.value.length === 3 && key.value.every((part) => typeof part === "number" && Number.isFinite(part))
            : typeof key.value === "string" && /^#[0-9a-fA-F]{6}$/.test(key.value);
        if (!validValue) {
          const expected = keyField.type === "float" ? "a finite number" : keyField.type === "vec3" ? "an array of three finite numbers" : "a #rrggbb color";
          errors.push(`${keyPath}.value: must be ${expected}`);
        }
      }
    }
  }
}

export function validateFieldValue(field: FieldSchema, value: unknown): string | undefined {
  switch (field.type) {
    case "float":
    case "int":
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
      if (field.type === "int" && !Number.isInteger(value)) return "must be an integer";
      if (value < field.min || value > field.max) return `must be between ${field.min} and ${field.max}`;
      return undefined;
    case "bool":
      return typeof value === "boolean" ? undefined : "must be a boolean";
    case "color":
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? undefined : "must be a #rrggbb color";
    case "vec3":
      if (!Array.isArray(value) || value.length !== 3 || value.some((part) => typeof part !== "number" || !Number.isFinite(part))) {
        return "must be an array of three finite numbers";
      }
      if (field.min !== undefined && value.some((part) => part < field.min!)) return `each value must be at least ${field.min}`;
      if (field.max !== undefined && value.some((part) => part > field.max!)) return `each value must be at most ${field.max}`;
      return undefined;
    case "enum":
      return typeof value === "string" && field.options.includes(value)
        ? undefined
        : `must be one of: ${field.options.join(", ")}`;
    case "string":
      return typeof value === "string" ? undefined : "must be a string";
    case "entityRef":
      return value === null || typeof value === "string" ? undefined : "must be an entity id or null";
  }
}

function validateComponent(componentName: string, value: unknown, path: string, errors: string[]): void {
  const schema = componentSchemas[componentName];
  if (!schema) {
    errors.push(`${path}: unknown component '${componentName}'`);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${path}: component data must be an object`);
    return;
  }
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const fieldSchema = schema.fields[fieldName];
    if (fieldSchema) {
      const error = validateFieldValue(fieldSchema, fieldValue);
      if (error) errors.push(`${path}.${fieldName}: ${error}`);
      continue;
    }
    if (schema.managedFields?.[fieldName] === "animationTracks") {
      validateAnimationTracks(fieldValue, `${path}.${fieldName}`, errors);
      continue;
    }
    if (schema.managedFields?.[fieldName] === "scriptParameters" && isRecord(fieldValue) && Object.values(fieldValue).every((value) => ["number", "boolean", "string"].includes(typeof value))) continue;
    errors.push(`${path}.${fieldName}: unknown field`);
  }
}

export function validateScene(scene: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(scene)) return ["scene: must be an object"];
  if (scene.version !== 1) errors.push("scene.version: must be 1");
  if (scene.name !== undefined && (typeof scene.name !== "string" || !scene.name.trim() || scene.name.trim().length > 100)) {
    errors.push("scene.name: must be a non-empty string of at most 100 characters");
  }
  if (!isRecord(scene.settings)) {
    errors.push("scene.settings: must be an object");
  } else {
    for (const [key, value] of Object.entries(scene.settings)) {
      const schema = settingSchemas[key as keyof SceneSettings];
      if (!schema) errors.push(`scene.settings.${key}: unknown setting`);
      else {
        const error = validateFieldValue(schema, value);
        if (error) errors.push(`scene.settings.${key}: ${error}`);
      }
    }
    for (const key of Object.keys(settingSchemas)) {
      if (!(key in scene.settings)) errors.push(`scene.settings.${key}: missing setting`);
    }
  }
  if (!Array.isArray(scene.entities)) return [...errors, "scene.entities: must be an array"];

  const ids = new Set<string>();
  const entities: Entity[] = [];
  for (const [index, item] of scene.entities.entries()) {
    const path = `scene.entities[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path}: must be an object`);
      continue;
    }
    if (typeof item.id !== "string" || item.id.trim() === "") errors.push(`${path}.id: must be a non-empty string`);
    else if (ids.has(item.id)) errors.push(`${path}.id: duplicate id '${item.id}'`);
    else ids.add(item.id);
    if (typeof item.name !== "string" || item.name.trim() === "") errors.push(`${path}.name: must be a non-empty string`);
    if (item.parent !== null && typeof item.parent !== "string") errors.push(`${path}.parent: must be an entity id or null`);
    const hasComponents = isRecord(item.components);
    if (!hasComponents) errors.push(`${path}.components: must be an object`);
    if (isRecord(item.components)) {
      for (const [name, component] of Object.entries(item.components)) validateComponent(name, component, `${path}.components.${name}`, errors);
    }
    if (typeof item.id === "string" && typeof item.name === "string" &&
        (item.parent === null || typeof item.parent === "string") && hasComponents) {
      entities.push(item as unknown as Entity);
    }
  }

  for (const entity of entities) {
    if (entity.parent !== null && !ids.has(entity.parent)) errors.push(`entity '${entity.id}': parent '${entity.parent}' does not exist`);
    for (const [componentName, componentData] of Object.entries(entity.components)) {
      const schema = componentSchemas[componentName];
      if (!schema) continue;
      for (const required of schema.requires ?? []) {
        if (!(required in entity.components)) errors.push(`entity '${entity.id}': ${componentName} requires ${required}`);
      }
      const target = componentData.target;
      if (componentName === "Joint" && typeof target === "string" && !ids.has(target)) {
        errors.push(`entity '${entity.id}': Joint target '${target}' does not exist`);
      }
    }
  }

  const dynamicBodyCount = entities.filter((entity) =>
    entity.components.RigidBody?.bodyType !== "static" && entity.components.RigidBody?.bodyType !== "kinematic" &&
    entity.components.RigidBody !== undefined
  ).length;
  if (dynamicBodyCount > 500) errors.push(`scene: ${dynamicBodyCount} dynamic rigid bodies exceeds the limit of 500`);

  for (const entity of entities) {
    const seen = new Set<string>([entity.id]);
    let parent = entity.parent;
    while (parent !== null && ids.has(parent)) {
      if (seen.has(parent)) {
        errors.push(`entity '${entity.id}': parent hierarchy contains a cycle`);
        break;
      }
      seen.add(parent);
      parent = entities.find((candidate) => candidate.id === parent)?.parent ?? null;
    }
  }
  return errors;
}

export { settingSchemas };
