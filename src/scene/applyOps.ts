import { componentSchemas } from "../registry";
import { type ApplyOpsResult, type Entity, type Scene, type SceneOp } from "./types";
import { validateScene } from "./validate";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function operationShapeError(value: unknown, index: number): string | undefined {
  const path = `ops[${index}]`;
  if (!isRecord(value) || typeof value.op !== "string") return `${path}: must be an operation object`;
  switch (value.op) {
    case "create":
      if ("index" in value && (typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0)) return `${path}.index: must be a nonnegative integer`;
      if (typeof value.id !== "string" || typeof value.name !== "string" ||
          (value.parent !== null && typeof value.parent !== "string") || !isRecord(value.components)) {
        return `${path}: create requires id, name, parent, and components`;
      }
      for (const [name, component] of Object.entries(value.components)) {
        if (!componentSchemas[name]) return `${path}.components.${name}: unknown component '${name}'`;
        if (!isRecord(component)) return `${path}.components.${name}: must be an object`;
      }
      return undefined;
    case "update":
      if (typeof value.id !== "string" || !isRecord(value.components)) return `${path}: update requires id and components`;
      if ("parent" in value && value.parent !== null && typeof value.parent !== "string") return `${path}.parent: must be an entity id or null`;
      if ("name" in value && (typeof value.name !== "string" || !value.name.trim())) return `${path}.name: must be a non-empty string`;
      for (const [name, component] of Object.entries(value.components)) {
        if (!componentSchemas[name]) return `${path}.components.${name}: unknown component '${name}'`;
        if (component !== null && !isRecord(component)) return `${path}.components.${name}: must be an object or null`;
      }
      return undefined;
    case "delete":
      return typeof value.id === "string" ? undefined : `${path}: delete requires an id`;
    case "settings":
      return isRecord(value.settings) ? undefined : `${path}: settings requires a settings object`;
    default:
      return `${path}: unknown operation '${value.op}'`;
  }
}

function normalizedComponent(name: string, fields: Record<string, unknown>): Record<string, unknown> {
  const schema = componentSchemas[name];
  const result: Record<string, unknown> = Object.create(null);
  if (!schema) return structuredClone(fields);
  for (const [key, value] of Object.entries(fields)) {
    const field = schema.fields[key];
    if (field && !("optional" in field && field.optional) && JSON.stringify(value) === JSON.stringify(field.default)) continue;
    if (schema.managedFields?.[key] && Array.isArray(value) && value.length === 0) continue;
    result[key] = structuredClone(value);
  }
  return result;
}

function inverseForUpdate(entity: Entity, changes: Record<string, Record<string, unknown> | null>, parent?: string | null, name?: string): SceneOp {
  const inverse: Record<string, Record<string, unknown> | null> = Object.create(null);
  for (const [componentName, patch] of Object.entries(changes)) {
    const current = entity.components[componentName];
    if (patch === null) {
      inverse[componentName] = current ? structuredClone(current) : null;
    } else if (!current) {
      inverse[componentName] = null;
    } else {
      const restore: Record<string, unknown> = Object.create(null);
      for (const fieldName of Object.keys(patch)) {
        const schema = componentSchemas[componentName];
        const field = Object.hasOwn(schema?.fields ?? {}, fieldName) ? schema.fields[fieldName] : undefined;
        restore[fieldName] = Object.hasOwn(current, fieldName)
          ? structuredClone(current[fieldName])
          : structuredClone(field ? field.default : fieldName === "parameters" ? {} : []);
      }
      inverse[componentName] = restore;
    }
  }
  return {
    op: "update",
    id: entity.id,
    components: inverse,
    ...(parent !== undefined ? { parent: entity.parent } : {}),
    ...(name !== undefined ? { name: entity.name } : {})
  };
}

function updateEntity(entity: Entity, changes: Record<string, Record<string, unknown> | null>, parent?: string | null, name?: string): void {
  if (parent !== undefined) entity.parent = parent;
  if (name !== undefined) entity.name = name;
  for (const [componentName, patch] of Object.entries(changes)) {
    if (patch === null) {
      delete entity.components[componentName];
      continue;
    }
    entity.components[componentName] = normalizedComponent(componentName, {
      ...(entity.components[componentName] ?? {}),
      ...patch
    });
  }
}

/** Validate and apply a whole batch atomically. Invalid batches return the original scene. */
export function applyOps(scene: Scene, inputOps: readonly unknown[]): ApplyOpsResult {
  const sourceErrors = validateScene(scene);
  if (sourceErrors.length) return { scene, inverseOps: [], errors: sourceErrors.map((error) => `current ${error}`) };

  const errors: string[] = [];
  for (const [index, operation] of inputOps.entries()) {
    const error = operationShapeError(operation, index);
    if (error) errors.push(error);
  }
  if (errors.length) return { scene, inverseOps: [], errors };

  const candidate = structuredClone(scene);
  const inverses: SceneOp[] = [];
  for (const [index, raw] of inputOps.entries()) {
    const operation = raw as SceneOp;
    const path = `ops[${index}]`;
    switch (operation.op) {
      case "create": {
        if (candidate.entities.some((entity) => entity.id === operation.id)) {
          errors.push(`${path}: entity '${operation.id}' already exists`);
          break;
        }
        const entity: Entity = {
          id: operation.id,
          name: operation.name,
          parent: operation.parent,
          components: Object.create(null)
        };
        for (const [name, fields] of Object.entries(operation.components)) {
          if (isRecord(fields)) entity.components[name] = normalizedComponent(name, fields);
        }
        candidate.entities.splice(operation.index ?? candidate.entities.length, 0, entity);
        inverses.unshift({ op: "delete", id: operation.id });
        break;
      }
      case "update": {
        const entity = candidate.entities.find((item) => item.id === operation.id);
        if (!entity) {
          errors.push(`${path}: entity '${operation.id}' does not exist`);
          break;
        }
        inverses.unshift(inverseForUpdate(entity, operation.components, operation.parent, operation.name));
        updateEntity(entity, operation.components, operation.parent, operation.name);
        break;
      }
      case "delete": {
        const indexInScene = candidate.entities.findIndex((entity) => entity.id === operation.id);
        if (indexInScene < 0) {
          errors.push(`${path}: entity '${operation.id}' does not exist`);
          break;
        }
        const [entity] = candidate.entities.splice(indexInScene, 1);
        inverses.unshift({ op: "create", ...structuredClone(entity), index: indexInScene });
        break;
      }
      case "settings": {
        const previous: Partial<Scene["settings"]> = {};
        for (const key of Object.keys(operation.settings)) {
          if (Object.hasOwn(candidate.settings, key)) {
            const settingKey = key as keyof Scene["settings"];
            previous[settingKey] = structuredClone(candidate.settings[settingKey]) as never;
          }
        }
        inverses.unshift({ op: "settings", settings: previous });
        candidate.settings = { ...candidate.settings, ...structuredClone(operation.settings) };
        break;
      }
    }
  }

  if (errors.length) return { scene, inverseOps: [], errors };
  // Deleting a followed object clears camera references in the same undo batch.
  const deletedIds = new Set(scene.entities.filter((entity) => !candidate.entities.some((other) => other.id === entity.id)).map((entity) => entity.id));
  for (const entity of candidate.entities) {
    if (deletedIds.has(entity.components.Joint?.target as string)) {
      inverses.push(inverseForUpdate(entity, { Joint: null }));
      updateEntity(entity, { Joint: null });
    }
    if (!entity.components.Camera) continue;
    const clear: Record<string, unknown> = {};
    for (const field of ["followTarget", "lookAtTarget"]) {
      if (deletedIds.has(entity.components.Camera[field] as string)) clear[field] = null;
    }
    if (Object.keys(clear).length) {
      // Restore deleted entities before restoring their references during undo.
      inverses.push(inverseForUpdate(entity, { Camera: clear }));
      updateEntity(entity, { Camera: clear });
    }
  }
  errors.push(...validateScene(candidate));
  if (errors.length) return { scene, inverseOps: [], errors };

  return { scene: candidate, inverseOps: inverses, errors: [] };
}
