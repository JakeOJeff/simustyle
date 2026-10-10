import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { generateScript, type GeneratedScript } from "../lang/codegen";
import { typecheckScript } from "../lang/checker";
import { parseScript } from "../lang/parser";
import type { ScriptProgram } from "../lang/ast";
import { COLOR_NAMES, DIRECTIONS, SHAPE_NOUNS } from "../lang/vocabulary";

type Runner = (ctx: ScriptContext, state: Record<string, unknown>) => void;
interface ScriptInstance { id: string; program: ScriptProgram; generated: GeneratedScript; state: Record<string, unknown>; initialize: Runner; start?: Runner; frame?: Runner; collide?: Runner; intervals: { seconds: number; elapsed: number; run: Runner }[]; }
type RuntimeTarget = string | { id?: string; name?: string; kind?: string; description?: { noun: string; colors: string[]; superlative?: string } } | null;
type RuntimeDestination = { kind: "point"; value: number[] } | { kind: "offset"; value: number[] } | { kind: "direction"; direction: keyof typeof DIRECTIONS; amount: number } | { kind: "relative"; relation: string; target: RuntimeTarget };
type RuntimeCommand = { name: "move"; target: RuntimeTarget; destination: RuntimeDestination; duration: number | null }
  | { name: "turn"; target: RuntimeTarget; amount: number[]; duration: number | null }
  | { name: "scale"; target: RuntimeTarget; mode: "to" | "by"; amount: number; duration: number | null }
  | { name: "paint"; target: RuntimeTarget; color: string }
  | { name: "push"; target: RuntimeTarget; vector: number[] }
  | { name: "destroy" | "hide" | "show" | "stop"; target: RuntimeTarget }
  | { name: "animate"; target: RuntimeTarget; words: string[] }
  | { name: "say"; args: unknown[] };
interface ScriptContext { time: number; dt: number; self: { id: string; name: string } | null; other?: { id: string; name: string }; param(name: string): unknown; get(path: string[]): unknown; set(path: string[], operator: string, value: unknown): void; call(name: string, args: unknown[]): unknown; command(command: RuntimeCommand): void; describe(description: { noun: string; colors: string[]; superlative?: string }): { id: string; name: string } | null; rigidbody(method: string, args: unknown[]): unknown; setMember(target: unknown, key: string, operator: string, value: unknown): void; assignLocal(current: unknown, operator: string, value: unknown): unknown; }

export interface ScriptIssue { entityId: string; line: number; column: number; message: string; }
export interface ScriptPrint { entityId: string; values: unknown[]; }

function sourceOf(scene: Scene, id: string): string {
  const value = scene.entities.find((entity) => entity.id === id)?.components.Script?.source;
  return typeof value === "string" ? value : "";
}

function applyOperator(current: unknown, operator: string, value: unknown): unknown {
  if (operator === "=") return value;
  const left = Number(current); const right = Number(value);
  if (operator === "+=") return left + right;
  if (operator === "-=") return left - right;
  if (operator === "*=") return left * right;
  if (operator === "/=") return left / right;
  return value;
}

function makeRunner(code: string): Runner {
  // The function body is generated from validated AST nodes; source text is never evaluated.
  return new Function("ctx", "state", `"use strict";\n${code}`) as Runner;
}

export class ScriptRuntime {
  readonly issues: ScriptIssue[] = [];
  readonly prints: ScriptPrint[] = [];
  private readonly instances = new Map<string, ScriptInstance>();
  private randomState: number;
  private currentScene: Scene;
  private elapsed = 0;
  private physicsActions: ((id: string, method: string, args: number[]) => boolean) | undefined;

  constructor(scene: Scene, seed = 1, physicsActions?: (id: string, method: string, args: number[]) => boolean) {
    this.currentScene = scene;
    this.randomState = seed >>> 0 || 1;
    this.physicsActions = physicsActions;
    for (const entity of scene.entities) {
      if (!entity.components.Script) continue;
      this.compile(entity.id, sourceOf(scene, entity.id));
    }
  }

  private compile(id: string, source: string): void {
    try {
      const program = parseScript(source);
      const errors = typecheckScript(program);
      if (errors.length) { this.issues.push(...errors.map((issue) => ({ entityId: id, ...issue }))); return; }
      const generated = generateScript(program);
      this.instances.set(id, {
        id, program, generated,
      state: Object.fromEntries(program.params.map((param) => [param.name, (this.currentScene.entities.find((entity) => entity.id === id)?.components.Script?.parameters as Record<string, unknown> | undefined)?.[param.name] ?? param.defaultValue])),
        initialize: makeRunner(generated.initialize),
        ...(generated.start ? { start: makeRunner(generated.start) } : {}),
        ...(generated.frame ? { frame: makeRunner(generated.frame) } : {}),
        ...(generated.collide ? { collide: makeRunner(generated.collide) } : {}),
        intervals: generated.interval.map((entry) => ({ seconds: entry.seconds, elapsed: 0, run: makeRunner(entry.body) }))
      });
    } catch (error) {
      const issue = error as { line?: number; column?: number; message?: string };
      this.issues.push({ entityId: id, line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message ?? String(error) });
    }
  }

  private context(instance: ScriptInstance, dt: number, other?: { id: string; name: string }): ScriptContext {
    const self = () => this.currentScene.entities.find((entity) => entity.id === instance.id);
    const resolve = (target: unknown) => {
      if (target && typeof target === "object" && "id" in target) return this.currentScene.entities.find((entity) => entity.id === String((target as Record<string, unknown>).id));
      if (target && typeof target === "object" && "kind" in target && target.kind === "name" && "name" in target) target = (target as Record<string, unknown>).name;
      if (typeof target === "string") return this.currentScene.entities.find((entity) => entity.name === target || entity.id === target);
      if (target && typeof target === "object" && "kind" in target && target.kind === "describe" && "description" in target) {
        const description = target.description as { noun?: string; colors?: string[]; superlative?: string };
        let matches = this.currentScene.entities.filter((entity) => {
          const shape = entity.components.Mesh?.shape;
          const noun = SHAPE_NOUNS[description.noun ?? ""];
          return (!noun || (noun === "Light" || noun === "Camera" ? noun in entity.components : shape === noun)) &&
            (description.colors ?? []).every((color) => entity.components.Material?.color === COLOR_NAMES[color]);
        });
        if (description.superlative === "nearest") matches = matches.sort((a, b) => Math.hypot(...(a.components.Transform?.position as number[] ?? [0, 0, 0])) - Math.hypot(...(b.components.Transform?.position as number[] ?? [0, 0, 0])));
        if (description.superlative === "farthest") matches = matches.sort((a, b) => Math.hypot(...(b.components.Transform?.position as number[] ?? [0, 0, 0])) - Math.hypot(...(a.components.Transform?.position as number[] ?? [0, 0, 0])));
        return matches[0];
      }
      return undefined;
    };
    const setFields = (id: string, component: string, fields: Record<string, unknown>) => {
      const result = applyOps(this.currentScene, [{ op: "update", id, components: { [component]: fields } }]);
      if (result.errors.length) this.issues.push({ entityId: instance.id, line: 1, column: 1, message: result.errors.join("; ") });
      else this.currentScene = result.scene;
    };
    const context: ScriptContext = {
      time: this.elapsed, dt, self: self() ? { id: instance.id, name: self()!.name } : null, ...(other ? { other } : {}),
      param: (name) => instance.state[name] ?? instance.program.params.find((param) => param.name === name)?.defaultValue,
      get: (path) => {
        const entity = self();
        if (!entity) return undefined;
        if (path[0] === "name") return entity.name;
        const component = Object.entries(entity.components).find(([name]) => name.toLowerCase() === path[0]?.toLowerCase())?.[1];
        let value: unknown = component?.[path[1] ?? ""];
        for (const key of path.slice(2)) {
          const vectorIndex = ["x", "y", "z"].indexOf(key);
          value = Array.isArray(value) && vectorIndex >= 0 ? value[vectorIndex] : (value as Record<string, unknown> | undefined)?.[key];
        }
        return value;
      },
      set: (path, operator, value) => {
        if (path.length < 2) return;
        const entity = self();
        if (!entity) return;
        const actual = Object.keys(entity.components).find((name) => name.toLowerCase() === path[0].toLowerCase());
        if (!actual) return;
        const component = structuredClone(entity.components[actual]);
        const field = path[1];
        if (path.length === 2) component[field] = applyOperator(component[field], operator, value);
        else {
          let target = component[field] as Record<string, unknown>;
          for (const key of path.slice(2, -1)) target = target?.[key] as Record<string, unknown>;
          const key = path.at(-1)!;
          const vectorIndex = ["x", "y", "z"].indexOf(key);
          if (Array.isArray(target) && vectorIndex >= 0) target[vectorIndex] = applyOperator(target[vectorIndex], operator, value);
          else target[key] = applyOperator(target[key], operator, value);
        }
        const result = applyOps(this.currentScene, [{ op: "update", id: instance.id, components: { [actual]: component } }]);
        if (result.errors.length) this.issues.push({ entityId: instance.id, line: 1, column: 1, message: result.errors.join("; ") });
        else this.currentScene = result.scene;
      },
      call: (name, args) => {
        switch (name) {
          case "random": return this.random(Number(args[0]), Number(args[1]));
          case "sin": return Math.sin(Number(args[0]));
          case "cos": return Math.cos(Number(args[0]));
          case "abs": return Math.abs(Number(args[0]));
          case "sqrt": return Math.sqrt(Number(args[0]));
          case "min": return Math.min(...args.map(Number));
          case "max": return Math.max(...args.map(Number));
          case "clamp": return Math.max(Number(args[1]), Math.min(Number(args[2]), Number(args[0])));
          case "lerp": return Number(args[0]) + (Number(args[1]) - Number(args[0])) * Number(args[2]);
          case "print": this.prints.push({ entityId: instance.id, values: args }); return undefined;
          case "find": {
            const found = this.currentScene.entities.find((entity) => entity.name === String(args[0]));
            return found ? { id: found.id, name: found.name } : null;
          }
          case "destroy": {
            const id = (args[0] as { id?: string } | null)?.id;
            if (id) this.currentScene = applyOps(this.currentScene, [{ op: "delete", id }]).scene;
            return undefined;
          }
          case "spawn": {
            const [prefabId, x, y, z] = args;
            const id = `${String(prefabId)}_${Math.floor(this.random(1, 1e9))}`;
            const spawned = { op: "create" as const, id, name: String(prefabId), parent: null, components: { Transform: { position: [Number(x), Number(y), Number(z)] }, Mesh: { shape: "box" }, Material: { color: "#ffffff" } } };
            const result = applyOps(this.currentScene, [spawned]);
            if (result.errors.length) this.issues.push({ entityId: instance.id, line: 1, column: 1, message: result.errors.join("; ") });
            else this.currentScene = result.scene;
            return { id, name: String(prefabId) };
          }
          default: return undefined;
        }
      },
      describe: (description) => {
        const entity = resolve({ kind: "describe", description });
        return entity ? { id: entity.id, name: entity.name } : null;
      },
      command: (command) => {
        if (command.name === "say") return;
        if ((command.name === "move" || command.name === "turn" || command.name === "scale") && command.duration !== null) {
          this.issues.push({ entityId: instance.id, line: 1, column: 1, message: "Timed scene commands currently apply immediately; duration was ignored." });
        }
        const entity = resolve(command.target);
        if (!entity) { this.issues.push({ entityId: instance.id, line: 1, column: 1, message: "Scene command could not find its target entity." }); return; }
        const transform = entity.components.Transform ?? {};
        const position = (transform.position as number[] | undefined) ?? [0, 0, 0];
        const rotation = (transform.rotation as number[] | undefined) ?? [0, 0, 0];
        const scale = (transform.scale as number[] | undefined) ?? [1, 1, 1];
        if (command.name === "destroy") {
          const pending = [entity.id];
          for (let index = 0; index < pending.length; index += 1) pending.push(...this.currentScene.entities.filter((item) => item.parent === pending[index]).map((item) => item.id));
          const result = applyOps(this.currentScene, pending.reverse().map((id) => ({ op: "delete" as const, id })));
          if (result.errors.length) this.issues.push({ entityId: instance.id, line: 1, column: 1, message: result.errors.join("; ") }); else this.currentScene = result.scene;
        } else if (command.name === "move") {
          const destination = command.destination;
          let next = [...position];
          if (destination.kind === "point") next = destination.value;
          else if (destination.kind === "offset") next = position.map((part, index) => part + destination.value[index]!);
          else if (destination.kind === "direction") next = position.map((part, index) => part + DIRECTIONS[destination.direction][index]! * destination.amount);
          else {
            const otherEntity = resolve(destination.target);
            const otherPosition = (otherEntity?.components.Transform?.position as number[] | undefined) ?? [0, 0, 0];
            const [x, y, z] = otherPosition;
            const gap = 1.5;
            next = destination.relation === "above" ? [x!, y! + gap, z!] : destination.relation === "below" ? [x!, y! - gap, z!] : destination.relation === "left" ? [x! - gap, y!, z!] : destination.relation === "right" ? [x! + gap, y!, z!] : destination.relation === "front" ? [x!, y!, z! - gap] : destination.relation === "behind" ? [x!, y!, z! + gap] : [x! + gap, y!, z!];
          }
          setFields(entity.id, "Transform", { position: next });
        } else if (command.name === "turn") setFields(entity.id, "Transform", { rotation: rotation.map((part, index) => part + command.amount[index]!) });
        else if (command.name === "scale") setFields(entity.id, "Transform", { scale: command.mode === "by" ? scale.map((part) => part * command.amount) : [command.amount, command.amount, command.amount] });
        else if (command.name === "paint") setFields(entity.id, "Material", { color: command.color });
        else if (command.name === "hide") setFields(entity.id, "Material", { opacity: 0 });
        else if (command.name === "show") setFields(entity.id, "Material", { opacity: 1 });
        else if (command.name === "push") this.physicsActions?.(entity.id, "applyImpulse", command.vector);
        else if (command.name === "animate" || command.name === "stop") this.issues.push({ entityId: instance.id, line: 1, column: 1, message: `The '${command.name}' command is not implemented; use the Timeline to edit animations.` });
      },
      rigidbody: (method, args) => this.physicsActions?.(instance.id, method, args.map(Number)) ?? false,
      setMember: (target, key, operator, value) => {
        if (target && typeof target === "object") (target as Record<string, unknown>)[key] = applyOperator((target as Record<string, unknown>)[key], operator, value);
      },
      assignLocal: applyOperator
    };
    return context;
  }

  private random(min: number, max: number): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return min + (this.randomState / 4294967296) * (max - min);
  }

  start(): Scene { for (const instance of this.instances.values()) { this.invoke(instance, instance.initialize, 0); this.invoke(instance, instance.start, 0); } return this.currentScene; }

  advance(elapsedSeconds: number): Scene {
    const dt = Math.max(0, Math.min(elapsedSeconds, 0.25));
    this.elapsed += dt;
    for (const instance of this.instances.values()) {
      this.invoke(instance, instance.frame, dt);
      for (const interval of instance.intervals) {
        interval.elapsed += dt;
        if (interval.elapsed >= interval.seconds) { interval.elapsed %= interval.seconds; this.invoke(instance, interval.run, dt); }
      }
    }
    return this.currentScene;
  }

  collide(selfId: string, otherId: string): void {
    const instance = this.instances.get(selfId);
    const entity = this.currentScene.entities.find((candidate) => candidate.id === otherId);
    if (instance && entity) this.invoke(instance, instance.collide, 0, { id: entity.id, name: entity.name });
  }

  private invoke(instance: ScriptInstance, runner: Runner | undefined, dt: number, other?: { id: string; name: string }): void {
    if (!runner) return;
    try { runner(this.context(instance, dt, other), instance.state); }
    catch (error) { this.issues.push({ entityId: instance.id, line: 1, column: 1, message: error instanceof Error ? error.message : String(error) }); }
  }

  get scene(): Scene { return this.currentScene; }
  /** Rebase script reads on the latest physics/animation scene while preserving local script state. */
  setScene(scene: Scene): void { this.currentScene = scene; }
  setParameter(entityId: string, name: string, value: unknown): boolean {
    const instance = this.instances.get(entityId);
    const parameter = instance?.program.params.find((candidate) => candidate.name === name);
    if (!instance || !parameter) return false;
    if (parameter.type === "float" || parameter.type === "int") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      const bounded = Math.max(parameter.min ?? -Infinity, Math.min(parameter.max ?? Infinity, value));
      instance.state[name] = parameter.type === "int" ? Math.round(bounded) : bounded;
    } else if (parameter.type === "bool" && typeof value === "boolean") instance.state[name] = value;
    else if (parameter.type === "string" && typeof value === "string") instance.state[name] = value;
    else return false;
    return true;
  }
  takeIssues(): ScriptIssue[] { return this.issues.splice(0); }
  takePrints(): ScriptPrint[] { return this.prints.splice(0); }
}

export function validateScripts(scene: Scene): ScriptIssue[] {
  return new ScriptRuntime(scene).takeIssues();
}

export function scriptOps(before: Scene, after: Scene): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const entity of after.entities) {
    const original = before.entities.find((candidate) => candidate.id === entity.id);
    if (!original) ops.push({ op: "create", id: entity.id, name: entity.name, parent: entity.parent, components: entity.components });
    else if (JSON.stringify(original.components) !== JSON.stringify(entity.components)) ops.push({ op: "update", id: entity.id, components: entity.components });
  }
  for (const entity of before.entities) if (!after.entities.some((candidate) => candidate.id === entity.id)) ops.push({ op: "delete", id: entity.id });
  return ops;
}
