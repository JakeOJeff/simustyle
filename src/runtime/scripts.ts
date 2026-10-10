import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { generateScript, type GeneratedScript } from "../lang/codegen";
import { typecheckScript } from "../lang/checker";
import { parseScript } from "../lang/parser";
import type { ScriptProgram } from "../lang/ast";
import { DIRECTIONS, matchAnimation, type RelationName } from "../lang/vocabulary";
import type { Entity } from "../scene/types";
import { MotionController, findDescribed, findNamed, placeRelative, positionOf, rotationOf, scaleOf, type RuntimeDescription } from "./commands";

type Runner = (ctx: ScriptContext, state: Record<string, unknown>) => void;
interface ScriptInstance { id: string; program: ScriptProgram; generated: GeneratedScript; state: Record<string, unknown>; initialize: Runner; start?: Runner; frame?: Runner; collide?: Runner; intervals: { seconds: number; elapsed: number; run: Runner }[]; }
/** An entity handle ({id,name}), a by-name lookup, or a description, as emitted by codegen. */
type RuntimeTarget = string | { id: string; name?: string } | { kind: "name"; name: string } | { kind: "describe"; description: RuntimeDescription } | null | undefined;
type Vector = [number, number, number];
type RuntimeDestination = { kind: "point"; value: Vector } | { kind: "offset"; value: Vector } | { kind: "direction"; direction: keyof typeof DIRECTIONS; amount: number } | { kind: "relative"; relation: RelationName; target: RuntimeTarget };
type RuntimeCommand = { line: number } & (
  | { name: "move"; target: RuntimeTarget; destination: RuntimeDestination; duration: number | null }
  | { name: "turn"; target: RuntimeTarget; amount: Vector; duration: number | null }
  | { name: "scale"; target: RuntimeTarget; mode: "to" | "by"; amount: number; duration: number | null }
  | { name: "paint"; target: RuntimeTarget; color: string }
  | { name: "push"; target: RuntimeTarget; vector: Vector }
  | { name: "destroy" | "hide" | "show" | "stop"; target: RuntimeTarget }
  | { name: "animate"; target: RuntimeTarget; words: string[] });
interface ScriptContext { time: number; dt: number; self: { id: string; name: string } | null; other?: { id: string; name: string }; param(name: string): unknown; get(path: string[]): unknown; set(path: string[], operator: string, value: unknown): void; call(name: string, args: unknown[]): unknown; command(command: RuntimeCommand): void; describe(description: RuntimeDescription): { id: string; name: string } | null; rigidbody(method: string, args: unknown[]): unknown; setMember(target: unknown, key: string, operator: string, value: unknown): void; assignLocal(current: unknown, operator: string, value: unknown): unknown; }

function targetLabel(target: RuntimeTarget): string {
  if (!target) return "(nothing)";
  if (typeof target === "string") return `'${target}'`;
  if ("kind" in target) return target.kind === "name" ? `'${target.name}'` : `'${target.description.text ?? `the ${target.description.noun}`}'`;
  return `'${target.name ?? target.id}'`;
}

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
  private readonly motion = new MotionController();

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
    const resolve = (target: unknown): Entity | undefined => this.resolveTarget(target as RuntimeTarget, instance.id);
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
            const found = findNamed(this.currentScene, String(args[0]));
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
      command: (command) => this.runCommand(command, instance.id),
      rigidbody: (method, args) => this.physicsActions?.(instance.id, method, args.map(Number)) ?? false,
      setMember: (target, key, operator, value) => {
        if (target && typeof target === "object") (target as Record<string, unknown>)[key] = applyOperator((target as Record<string, unknown>)[key], operator, value);
      },
      assignLocal: applyOperator
    };
    return context;
  }

  /** Turn a command target into a scene entity. Bare names fall back to descriptions, so `move ball up` finds a sphere. */
  private resolveTarget(target: RuntimeTarget, selfId: string | null): Entity | undefined {
    if (!target) return undefined;
    if (typeof target === "string") return this.resolveTarget({ kind: "name", name: target }, selfId);
    const scene = this.currentScene;
    if (!("kind" in target)) return scene.entities.find((entity) => entity.id === target.id);
    const resolver = { scene, selfId, resolve: (nested: unknown) => this.resolveTarget(nested as RuntimeTarget, selfId) };
    if (target.kind === "name") return findNamed(scene, target.name) ?? findDescribed({ colors: [], noun: target.name.toLowerCase() }, resolver);
    return findDescribed(target.description, resolver);
  }

  private report(entityId: string, line: number, message: string): void {
    this.issues.push({ entityId, line, column: 1, message });
  }

  private applyChanges(ops: SceneOp[], entityId: string, line: number): void {
    if (!ops.length) return;
    const result = applyOps(this.currentScene, ops);
    if (result.errors.length) { this.report(entityId, line, result.errors.join("; ")); return; }
    this.currentScene = result.scene;
    // Physics owns dynamic bodies, so teleport them in Rapier as well or the next step would undo the move.
    for (const op of ops) {
      if (op.op !== "update" || !op.components.Transform) continue;
      const entity = this.currentScene.entities.find((candidate) => candidate.id === op.id);
      const position = op.components.Transform.position;
      if (entity && Array.isArray(position) && this.isDynamic(entity)) this.physicsActions?.(entity.id, "setTranslation", position as number[]);
    }
  }

  private isDynamic(entity: Entity): boolean {
    return Boolean(entity.components.RigidBody) && (entity.components.RigidBody?.bodyType ?? "dynamic") === "dynamic";
  }

  private runCommand(command: RuntimeCommand, ownerId: string): void {
    const { line } = command;
    const entity = this.resolveTarget(command.target, ownerId);
    if (!entity) { this.report(ownerId, line, `${command.name}: could not find ${targetLabel(command.target)} in the scene.`); return; }
    const duration = "duration" in command && command.duration !== null ? Math.max(0, Number(command.duration)) : 0;
    switch (command.name) {
      case "destroy": {
        const ids = [entity.id];
        for (let index = 0; index < ids.length; index += 1) ids.push(...this.currentScene.entities.filter((item) => item.parent === ids[index]).map((item) => item.id));
        for (const id of ids) this.motion.forget(id);
        this.applyChanges(ids.reverse().map((id) => ({ op: "delete" as const, id })), ownerId, line);
        return;
      }
      case "move": {
        const destination = command.destination;
        const position = positionOf(entity);
        let next: Vector;
        if (destination.kind === "point") next = destination.value.map(Number) as Vector;
        else if (destination.kind === "offset") next = position.map((part, index) => part + Number(destination.value[index])) as Vector;
        else if (destination.kind === "direction") next = position.map((part, index) => part + DIRECTIONS[destination.direction][index]! * Number(destination.amount)) as Vector;
        else {
          const anchor = this.resolveTarget(destination.target, ownerId);
          if (!anchor) { this.report(ownerId, line, `move: could not find ${targetLabel(destination.target)} to move next to.`); return; }
          if (anchor.id === entity.id) { this.report(ownerId, line, "move: an object cannot be placed relative to itself."); return; }
          next = placeRelative(entity, anchor, destination.relation);
        }
        if (next.some((part) => !Number.isFinite(part))) { this.report(ownerId, line, "move: coordinates must be numbers."); return; }
        this.applyChanges(this.motion.set(entity, "position", next, duration), ownerId, line);
        return;
      }
      case "turn":
        this.applyChanges(this.motion.set(entity, "rotation", rotationOf(entity).map((part, index) => part + Number(command.amount[index])) as Vector, duration), ownerId, line);
        return;
      case "scale": {
        const amount = Number(command.amount);
        if (!Number.isFinite(amount) || amount <= 0) { this.report(ownerId, line, "scale: the amount must be a positive number."); return; }
        const next = command.mode === "by" ? scaleOf(entity).map((part) => part * amount) as Vector : [amount, amount, amount] as Vector;
        this.applyChanges(this.motion.set(entity, "scale", next, duration), ownerId, line);
        return;
      }
      case "paint":
        if (!entity.components.Material) { this.report(ownerId, line, `paint: '${entity.name}' has no Material to color.`); return; }
        this.applyChanges([{ op: "update", id: entity.id, components: { Material: { color: command.color } } }], ownerId, line);
        return;
      case "hide":
      case "show":
        if (!entity.components.Material) { this.report(ownerId, line, `${command.name}: '${entity.name}' has no Material.`); return; }
        this.applyChanges([{ op: "update", id: entity.id, components: { Material: { opacity: command.name === "hide" ? 0 : 1 } } }], ownerId, line);
        return;
      case "push":
        if (!this.isDynamic(entity) || !this.physicsActions?.(entity.id, "applyImpulse", command.vector.map(Number))) {
          this.report(ownerId, line, `push: '${entity.name}' needs a dynamic RigidBody to be pushed.`);
        }
        return;
      case "animate": {
        const spec = matchAnimation(command.words);
        if (!spec) { this.report(ownerId, line, `animate: no animation matches '${command.words.join(" ")}'.`); return; }
        if (this.isDynamic(entity)) this.report(ownerId, line, `animate: '${entity.name}' has a dynamic RigidBody, so physics will fight the animation. Make it kinematic or remove the RigidBody.`);
        this.applyChanges(this.motion.animate(entity, spec), ownerId, line);
        return;
      }
      case "stop":
        this.applyChanges(this.motion.stop(entity.id), ownerId, line);
        return;
    }
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
    this.applyChanges(this.motion.advance(this.currentScene, dt), "", 1);
    return this.currentScene;
  }

  /**
   * Run script statements once against a scene outside Play (the editor's command bar).
   * Timed moves finish instantly; looping animations need Play, so they are reported instead.
   */
  static runOnce(scene: Scene, source: string): { scene: Scene; issues: ScriptIssue[]; prints: ScriptPrint[] } {
    const runtime = new ScriptRuntime({ ...scene, entities: scene.entities.filter((entity) => !entity.components.Script) });
    runtime.currentScene = scene;
    runtime.compile("", source);
    const instance = runtime.instances.get("");
    if (instance) {
      if (instance.program.handlers.length) runtime.report("", instance.program.handlers[0]!.line, "Event handlers such as 'on start:' only run during Play. Put them in an object's script.");
      else runtime.invoke(instance, instance.initialize, 0);
      const settled = runtime.motion.settle();
      if (settled.animating) runtime.report("", 1, "Animations loop during Play. Add the animate line to a script (for example under 'on start:') and press Play.");
      runtime.applyChanges(settled.ops, "", 1);
    }
    return { scene: runtime.currentScene, issues: runtime.takeIssues(), prints: runtime.takePrints() };
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
