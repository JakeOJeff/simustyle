import { DEFAULT_COMPONENT_SCHEMAS } from "./prompts.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, keys, path, errors) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function validateValue(value, schema, path, errors) {
  if (!isRecord(schema) || typeof schema.type !== "string") {
    errors.push(`${path} has an invalid runtime schema definition`);
    return;
  }
  if (schema.type === "number") {
    if (!Number.isFinite(value)) return errors.push(`${path} must be a finite number`);
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
    if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
    if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) errors.push(`${path} must be less than ${schema.exclusiveMaximum}`);
  } else if (schema.type === "string") {
    if (typeof value !== "string") return errors.push(`${path} must be a string`);
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match its required format`);
      } catch {
        errors.push(`${path} has an invalid runtime schema pattern`);
      }
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return errors.push(`${path} must be an array`);
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} items`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, errors));
  } else if (schema.type === "object") {
    if (!isRecord(value)) return errors.push(`${path} must be an object`);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed`);
      else validateValue(item, properties[key], `${path}.${key}`, errors);
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
  } else {
    errors.push(`${path} uses unsupported schema type "${schema.type}"`);
  }
}

function validateComponents(components, registry, path, errors, allowEmpty = false) {
  if (!isRecord(components) || (!allowEmpty && Object.keys(components).length === 0)) {
    errors.push(`${path} must be an object${allowEmpty ? "" : " with at least one component"}`);
    return;
  }
  for (const [component, fields] of Object.entries(components)) {
    if (!Object.hasOwn(registry, component)) {
      errors.push(`${path}.${component} is not a supported component`);
      continue;
    }
    if (!isRecord(fields) || Object.keys(fields).length === 0) {
      errors.push(`${path}.${component} must be a non-empty object`);
      continue;
    }
    const fieldSchemas = registry[component];
    for (const [field, value] of Object.entries(fields)) {
      if (!Object.hasOwn(fieldSchemas, field)) errors.push(`${path}.${component}.${field} is not a supported field`);
      else validateValue(value, fieldSchemas[field], `${path}.${component}.${field}`, errors);
    }
  }
}

function sceneEntities(scene) {
  return Array.isArray(scene) ? scene : null;
}

export function validateCurrentScene(scene, registry = DEFAULT_COMPONENT_SCHEMAS) {
  const errors = [];
  if (!Array.isArray(scene)) return { ok: false, errors: ["scene must be an array of scene objects"] };
  if (!isRecord(registry)) return { ok: false, errors: ["component registry must be an object"] };
  const entities = new Map();
  scene.forEach((entity, index) => {
    const path = `scene[${index}]`;
    if (!isRecord(entity)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (typeof entity.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(entity.id)) {
      errors.push(`${path}.id must be 1-80 letters, numbers, underscores, or hyphens`);
      return;
    }
    if (entities.has(entity.id)) errors.push(`${path}.id "${entity.id}" is duplicated`);
    entities.set(entity.id, entity);
    if (entity.parent !== undefined && entity.parent !== null && typeof entity.parent !== "string") {
      errors.push(`${path}.parent must be null or an object id`);
    }
    if (entity.components !== undefined) validateComponents(entity.components, registry, `${path}.components`, errors, true);
  });
  for (const [id, entity] of entities) {
    if (typeof entity.parent === "string" && !entities.has(entity.parent)) {
      errors.push(`scene object "${id}" refers to missing parent "${entity.parent}"`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function cloneComponents(components) {
  if (!isRecord(components)) return {};
  return Object.fromEntries(Object.entries(components).map(([key, value]) => [
    key,
    isRecord(value) ? { ...value } : value
  ]));
}

/** Validate an AI scene response against the supplied runtime component registry. */
export function validateSceneResponse(input, scene = [], registry = DEFAULT_COMPONENT_SCHEMAS) {
  const errors = [];
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["response must contain valid JSON"], value: null };
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ["response must be a JSON object"], value };
  hasOnlyKeys(value, ["summary", "ops"], "response", errors);
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("summary must be a non-empty string");
  if (!Array.isArray(value.ops)) return { ok: false, errors: [...errors, "ops must be an array"], value };
  if (!isRecord(registry)) return { ok: false, errors: [...errors, "component registry must be an object"], value };
  const sceneValidation = validateCurrentScene(scene, registry);
  if (!sceneValidation.ok) return { ok: false, errors: [...errors, ...sceneValidation.errors], value };

  const entities = new Map();
  for (const entity of sceneEntities(scene)) {
    if (isRecord(entity) && typeof entity.id === "string") {
      entities.set(entity.id, { ...entity, components: cloneComponents(entity.components) });
    }
  }
  const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id);

  value.ops.forEach((operation, index) => {
    const path = `ops[${index}]`;
    if (!isRecord(operation)) return errors.push(`${path} must be an object`);
    if (operation.op === "create") {
      hasOnlyKeys(operation, ["op", "id", "name", "parent", "components"], path, errors);
      if (!validId(operation.id)) errors.push(`${path}.id must be 1-80 letters, numbers, underscores, or hyphens`);
      else if (entities.has(operation.id)) errors.push(`${path}.id "${operation.id}" already exists`);
      if (typeof operation.name !== "string" || !operation.name.trim()) errors.push(`${path}.name must be a non-empty string`);
      if (operation.parent !== null && !validId(operation.parent)) errors.push(`${path}.parent must be null or a valid id`);
      else if (operation.parent === operation.id) errors.push(`${path}.parent cannot refer to the object itself`);
      else if (operation.parent !== null && !entities.has(operation.parent)) errors.push(`${path}.parent "${operation.parent}" does not exist yet`);
      validateComponents(operation.components, registry, `${path}.components`, errors);
      if (validId(operation.id) && !entities.has(operation.id)) {
        entities.set(operation.id, { id: operation.id, parent: operation.parent, components: cloneComponents(operation.components) });
      }
    } else if (operation.op === "update") {
      hasOnlyKeys(operation, ["op", "id", "components"], path, errors);
      if (!validId(operation.id)) errors.push(`${path}.id must be 1-80 letters, numbers, underscores, or hyphens`);
      else if (!entities.has(operation.id)) errors.push(`${path}.id "${operation.id}" does not exist`);
      validateComponents(operation.components, registry, `${path}.components`, errors);
      if (validId(operation.id) && entities.has(operation.id) && isRecord(operation.components)) {
        const entity = entities.get(operation.id);
        for (const [component, fields] of Object.entries(operation.components)) {
          entity.components[component] = { ...(entity.components[component] ?? {}), ...(isRecord(fields) ? fields : {}) };
        }
      }
    } else if (operation.op === "delete") {
      hasOnlyKeys(operation, ["op", "id"], path, errors);
      if (!validId(operation.id)) errors.push(`${path}.id must be 1-80 letters, numbers, underscores, or hyphens`);
      else if (!entities.has(operation.id)) errors.push(`${path}.id "${operation.id}" does not exist`);
      else entities.delete(operation.id);
    } else {
      errors.push(`${path}.op must be "create", "update", or "delete"`);
    }
  });

  const rigidBodyCount = [...entities.values()].filter((entity) =>
    entity.components && Object.hasOwn(entity.components, "RigidBody"),
  ).length;
  if (rigidBodyCount > 500) errors.push(`scene would contain ${rigidBodyCount} rigid bodies; maximum is 500`);
  for (const entity of entities.values()) {
    if (entity.parent !== null && entity.parent !== undefined && !entities.has(entity.parent)) {
      errors.push(`object "${entity.id}" refers to missing parent "${entity.parent}"`);
    }
  }
  return { ok: errors.length === 0, errors, value };
}
