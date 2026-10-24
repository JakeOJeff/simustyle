import { componentSchemas } from "../registry";
import { applyOps } from "../scene/applyOps";
import { groupOps } from "../scene/hierarchy";
import type { Scene, SceneOp, Vec3 } from "../scene/types";

export const MAX_BUILD_OPERATIONS = 1500;

export type BuildOperation = SceneOp
  | { op: "assemble"; id: string; name: string; parent: string | null; transform?: Record<string, unknown>;
      parts: { id: string; name: string; parent?: string; components: Record<string, Record<string, unknown>> }[] }
  | { op: "repeat"; source: string; idPrefix: string; name: string; count: number; step: Vec3; rotationStep?: Vec3 }
  | { op: "group"; id: string; name: string; ids: string[] };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const vector = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));

/** Compile higher-level build tools to ordinary undoable scene ops; never mutate the input scene. */
export function expandBuildOperations(scene: Scene, input: readonly unknown[]): { ops: SceneOp[]; errors: string[] } {
  const ops: SceneOp[] = [];
  if (input.length > MAX_BUILD_OPERATIONS) return { ops: [], errors: [`Build exceeds ${MAX_BUILD_OPERATIONS} operations. Reduce repetition or detail.`] };
  const add = (batch: SceneOp[]) => {
    if (ops.length + batch.length > MAX_BUILD_OPERATIONS) throw new Error(`Expanded build exceeds ${MAX_BUILD_OPERATIONS} operations. Reduce repetition or detail.`);
    ops.push(...batch);
  };
  for (const [index, raw] of input.entries()) {
    try {
      if (!record(raw)) throw new Error("must be an operation object");
      if (raw.op === "assemble") {
        if (!text(raw.id) || !text(raw.name) || (raw.parent !== null && !text(raw.parent)) ||
            !Array.isArray(raw.parts) || !raw.parts.length || raw.parts.length > 300 ||
            (raw.transform !== undefined && !record(raw.transform))) throw new Error("assemble requires id, name, parent, 1..300 parts and an optional Transform object");
        const ids = new Set([raw.id]);
        const taken = new Set(scene.entities.map((entity) => entity.id));
        for (const earlier of ops) {
          if (earlier.op === "create") taken.add(earlier.id);
          if (earlier.op === "delete") taken.delete(earlier.id);
        }
        if (taken.has(raw.id)) throw new Error(`assembly id '${raw.id}' already exists; choose a unique id`);
        const batch: SceneOp[] = [{ op: "create", id: raw.id, name: raw.name, parent: raw.parent, components: { Transform: raw.transform ?? {} } }];
        for (const part of raw.parts) {
          if (!record(part) || !text(part.id) || !text(part.name) || !record(part.components) ||
              (part.parent !== undefined && !text(part.parent))) throw new Error("each assembly part requires id, name and components");
          if (ids.has(part.id)) throw new Error(`duplicate part id '${part.id}'`);
          if (taken.has(part.id)) throw new Error(`part id '${part.id}' already exists; choose a unique id`);
          const parent = part.parent ?? raw.id;
          if (!ids.has(parent)) throw new Error(`part '${part.id}' must reference the assembly or an earlier part as parent`);
          ids.add(part.id);
          batch.push({ op: "create", id: part.id, name: part.name, parent, components: part.components as Record<string, Record<string, unknown>> });
        }
        add(batch);
      } else if (raw.op === "repeat" || raw.op === "group") {
        // These tools operate on the original scene plus earlier operations in this same batch.
        const current = applyOps(scene, ops);
        if (current.errors.length) throw new Error(`earlier operations must be valid before ${raw.op}: ${current.errors.join("; ")}`);
        if (raw.op === "group") {
          if (!text(raw.id) || !text(raw.name) || !Array.isArray(raw.ids) || !raw.ids.length || !raw.ids.every(text)) throw new Error("group requires id, name and a nonempty ids array");
          if (raw.ids.some((id) => !current.scene.entities.some((entity) => entity.id === id))) throw new Error("group contains an unknown object id");
          const grouped = groupOps(current.scene, raw.ids, raw.id, raw.name);
          if (grouped.error) throw new Error(grouped.error);
          add(grouped.ops);
          continue;
        }
        if (!text(raw.source) || !text(raw.idPrefix) || !text(raw.name) || typeof raw.count !== "number" ||
            !Number.isInteger(raw.count) || raw.count < 1 || raw.count > 200 || !vector(raw.step) ||
            (raw.rotationStep !== undefined && !vector(raw.rotationStep))) throw new Error("repeat requires source, idPrefix, name, count 1..200, step vec3 and optional rotationStep vec3");
        const root = current.scene.entities.find((entity) => entity.id === raw.source);
        if (!root) throw new Error(`source '${raw.source}' does not exist`);
        const tree = [root];
        for (let cursor = 0; cursor < tree.length; cursor++) tree.push(...current.scene.entities.filter((entity) => entity.parent === tree[cursor]!.id));
        if (ops.length + tree.length * raw.count > MAX_BUILD_OPERATIONS) throw new Error(`Expanded build exceeds ${MAX_BUILD_OPERATIONS} operations. Reduce count or simplify the source.`);
        const used = new Set(current.scene.entities.map((entity) => entity.id));
        for (let copy = 1; copy <= raw.count; copy++) {
          const ids = new Map(tree.map((entity, part) => [entity.id, part === 0 ? `${raw.idPrefix}_${copy}` : `${raw.idPrefix}_${copy}_part_${part}`]));
          for (const id of ids.values()) {
            if (used.has(id)) throw new Error(`generated id '${id}' already exists; choose a different idPrefix`);
            used.add(id);
          }
          add(tree.map((entity, part): SceneOp => {
            const components = structuredClone(entity.components);
            if (part === 0) {
              const position = components.Transform?.position ?? [0, 0, 0];
              const rotation = components.Transform?.rotation ?? [0, 0, 0];
              components.Transform = { ...components.Transform,
                position: (position as Vec3).map((value, axis) => value + (raw.step as Vec3)[axis]! * copy),
                ...(raw.rotationStep ? { rotation: (rotation as Vec3).map((value, axis) => value + (raw.rotationStep as Vec3)[axis]! * copy) } : {}) };
            }
            for (const [component, fields] of Object.entries(components)) {
              for (const [field, schema] of Object.entries(componentSchemas[component]?.fields ?? {})) {
                if (schema.type === "entityRef" && typeof fields[field] === "string" && ids.has(fields[field] as string)) fields[field] = ids.get(fields[field] as string)!;
              }
            }
            if (components.Camera) components.Camera.isActive = false;
            return { op: "create", id: ids.get(entity.id)!, name: part === 0 ? `${raw.name} ${copy}` : `${raw.name} ${copy} / ${entity.name}`,
              parent: part === 0 ? root.parent : ids.get(entity.parent!)!, components };
          }));
        }
      } else add([raw as unknown as SceneOp]);
    } catch (error) {
      return { ops: [], errors: [`ops[${index}]: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
  return { ops, errors: [] };
}
