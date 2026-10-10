import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { generateScript, type GeneratedHandler } from "../lang/codegen";
import { typecheckScript } from "../lang/checker";
import { parseScript } from "../lang/parser";
import type { ScriptProgram } from "../lang/ast";
import { COLOR_NAMES, DIRECTIONS, matchAnimation, type RelationName } from "../lang/vocabulary";
import type { Entity } from "../scene/types";
import { MotionController, describedMatches, findNamed, placeRelative, positionOf, rotationOf, scaleOf, type RuntimeDescription } from "./commands";

/** Generated handler bodies are generator functions: `yield n` means "wait n seconds". */
type Runner = (ctx: ScriptContext, state: Record<string, unknown>) => Generator<number, void, unknown>;
interface HandlerEntry extends Omit<GeneratedHandler, "body"> { run: Runner; elapsed: number; busy: boolean; }
interface ScriptInstance { id: string; program: ScriptProgram; state: Record<string, unknown>; initialize: Runner; handlers: HandlerEntry[]; }
interface Coroutine { instanceId: string; generator: Generator<number, void, unknown>; wait: number; handler?: HandlerEntry; }
type Handle = { id: string; name: string };
/** An entity handle ({id,name}), a by-name lookup, a description, or a family lookup, as emitted by codegen. */
type RuntimeTarget = string | { id: string; name?: string } | { kind: "name"; name: string } | { kind: "describe"; description: RuntimeDescription & { all?: boolean } } | { kind: "family"; relation: "children" | "parent"; of: RuntimeTarget } | null | undefined;
type Vector = [number, number, number];
type RuntimeDestination = { kind: "point"; value: Vector } | { kind: "offset"; value: Vector } | { kind: "direction"; direction: keyof typeof DIRECTIONS; amount: number } | { kind: "relative"; relation: RelationName; target: RuntimeTarget };
type RuntimeCommand = { line: number } & (
  | { name: "move"; target: RuntimeTarget; destination: RuntimeDestination; duration: number | null }
  | { name: "turn"; target: RuntimeTarget; amount: Vector; duration: number | null }
  | { name: "scale"; target: RuntimeTarget; mode: "to" | "by"; amount: number; duration: number | null }
  | { name: "paint"; target: RuntimeTarget; color: string }
  | { name: "push"; target: RuntimeTarget; vector: Vector }
  | { name: "destroy" | "hide" | "show" | "stop"; target: RuntimeTarget }
  | { name: "animate"; target: RuntimeTarget; words: string[] }
  | { name: "create"; shape: string; color: string | null; place: RuntimeDestination | null; called: unknown });
interface ScriptContext {
  readonly time: number; readonly dt: number; self: Handle | null; other?: Handle;
  param(name: string): unknown; get(path: string[]): unknown; set(path: string[], operator: string, value: unknown): void;
  call(name: string, args: unknown[]): unknown; command(command: RuntimeCommand): void; describe(description: RuntimeDescription): Handle | null;
  rigidbody(method: string, args: unknown[]): unknown; setMember(target: unknown, key: string, operator: string, value: unknown): void;
  assignLocal(current: unknown, operator: string, value: unknown): unknown;
  eq(left: unknown, right: unknown): boolean; prop(target: unknown, property: string): unknown; setProp(target: unknown, property: string, operator: string, value: unknown, line: number): void;
  matches(other: unknown, target: unknown): boolean; keyDown(key: string): boolean; broadcast(message: string): void; loop(line: number): void;
}

/** Thrown by ctx.loop() so a loop without a `wait` cannot freeze the editor. */
class LoopLimitError extends Error {
  constructor(readonly line: number) { super("This loop ran 10,000 times without waiting. Add a line like 'wait 0.1 seconds' inside it."); }
}

const LOOP_LIMIT = 10000;
const GeneratorFunction = Object.getPrototypeOf(function* () { /* generator constructor */ }).constructor as new (...args: string[]) => Runner;

function targetLabel(target: RuntimeTarget): string {
  if (!target) return "(nothing)";
  if (typeof target === "string") return `'${target}'`;
  if ("kind" in target) {
    if (target.kind === "name") return `'${target.name}'`;
    if (target.kind === "family") return target.relation === "children" ? "any children" : "a parent";
    return `'${target.description.text ?? `the ${target.description.noun}`}'`;
  }
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
  // Variables made with "change score by 1" start at zero.
  const left = Number(current ?? 0); const right = Number(value);
  if (operator === "+=") return typeof current === "string" ? current + String(value) : left + right;
  if (operator === "-=") return left - right;
  if (operator === "*=") return left * right;
  if (operator === "/=") return left / right;
  return value;
}

function makeRunner(code: string): Runner {
  // The function body is generated from validated AST nodes; source text is never evaluated.
  return new GeneratorFunction("ctx", "state", `"use strict";\n${code}`);
}

function handle(entity: Entity): Handle { return { id: entity.id, name: entity.name }; }

export class ScriptRuntime {
  readonly issues: ScriptIssue[] = [];
  readonly prints: ScriptPrint[] = [];
  private readonly instances = new Map<string, ScriptInstance>();
  private coroutines: Coroutine[] = [];
  private randomState: number;
  private currentScene: Scene;
  private elapsed = 0;
  private lastDt = 0;
  private loopBudget = 0;
  private readonly keysHeld = new Set<string>();
  private readonly pendingEvents: ({ kind: "key"; key: string } | { kind: "click"; id: string })[] = [];
  private messages: string[] = [];
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
      const stored = this.currentScene.entities.find((entity) => entity.id === id)?.components.Script?.parameters as Record<string, unknown> | undefined;
      this.instances.set(id, {
        id, program,
        state: Object.fromEntries(program.params.map((param) => [param.name, stored?.[param.name] ?? param.defaultValue])),
        initialize: makeRunner(generated.initialize),
        handlers: generated.handlers.map(({ body, ...rest }) => ({ ...rest, run: makeRunner(body), elapsed: 0, busy: false }))
      });
    } catch (error) {
      const issue = error as { line?: number; column?: number; message?: string };
      this.issues.push({ entityId: id, line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message ?? String(error) });
    }
  }

  private context(instance: ScriptInstance, other?: Handle): ScriptContext {
    const runtime = this;
    const self = () => this.currentScene.entities.find((entity) => entity.id === instance.id);
    const selfEntity = self();
    const context: ScriptContext = {
      get time() { return runtime.elapsed; },
      get dt() { return runtime.lastDt; },
      self: selfEntity ? handle(selfEntity) : null, ...(other ? { other } : {}),
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
          case "print": this.prints.push({ entityId: instance.id, values: args.map((value) => value && typeof value === "object" && "name" in value ? (value as Handle).name : value) }); return undefined;
          case "find": {
            const found = findNamed(this.currentScene, String(args[0]));
            return found ? handle(found) : null;
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
        const entity = this.resolveTargets({ kind: "describe", description }, instance.id)[0];
        return entity ? handle(entity) : null;
      },
      command: (command) => this.runCommand(command, instance.id),
      rigidbody: (method, args) => this.physicsActions?.(instance.id, method, args.map(Number)) ?? false,
      setMember: (target, key, operator, value) => {
        if (target && typeof target === "object") (target as Record<string, unknown>)[key] = applyOperator((target as Record<string, unknown>)[key], operator, value);
      },
      assignLocal: applyOperator,
      eq: (left, right) => {
        const idOf = (value: unknown) => value && typeof value === "object" && "id" in value ? String((value as Handle).id) : undefined;
        const leftId = idOf(left);
        const rightId = idOf(right);
        if (leftId !== undefined && rightId !== undefined) return leftId === rightId;
        // "if it is "Wall"": compare an object with a name.
        if (leftId !== undefined && typeof right === "string") return findNamed(this.currentScene, right)?.id === leftId;
        if (rightId !== undefined && typeof left === "string") return findNamed(this.currentScene, left)?.id === rightId;
        return left === right;
      },
      prop: (target, property) => {
        const entity = this.resolveTargets(target as RuntimeTarget, instance.id)[0];
        if (!entity) return property === "name" ? "" : property === "color" || property === "colour" ? "#000000" : 0;
        const position = positionOf(entity);
        switch (property) {
          case "x": return position[0];
          case "y": return position[1];
          case "z": return position[2];
          case "size": return scaleOf(entity)[0];
          case "name": return entity.name;
          case "color": case "colour": return (entity.components.Material?.color as string | undefined) ?? "#ffffff";
          case "distance": {
            const from = self();
            return from ? Math.hypot(...positionOf(from).map((part, index) => part - position[index]!)) : 0;
          }
          default: return undefined;
        }
      },
      setProp: (target, property, operator, value, line) => {
        for (const entity of this.resolveTargets(target as RuntimeTarget, instance.id)) {
          if (property === "color" || property === "colour") { this.runCommand({ name: "paint", target: handle(entity), color: String(value), line }, instance.id); continue; }
          const current = Number(context.prop(handle(entity), property));
          const next = Number(applyOperator(current, operator, value));
          if (!Number.isFinite(next)) { this.report(instance.id, line, `${property} must be a number.`); continue; }
          if (property === "size") { this.runCommand({ name: "scale", target: handle(entity), mode: "to", amount: next, duration: null, line }, instance.id); continue; }
          const axis = ["x", "y", "z"].indexOf(property);
          if (axis < 0) continue;
          const position = positionOf(entity);
          position[axis] = next;
          this.runCommand({ name: "move", target: handle(entity), destination: { kind: "point", value: position }, duration: null, line }, instance.id);
        }
      },
      matches: (candidate, target) => {
        const id = (candidate as Handle | undefined)?.id;
        if (!id) return false;
        const lookup = target as RuntimeTarget;
        // "when I touch the floor" should match any floor, not just the nearest one.
        const widened = lookup && typeof lookup === "object" && "kind" in lookup && lookup.kind === "describe" ? { ...lookup, description: { ...lookup.description, all: true } } : lookup;
        return this.resolveTargets(widened, instance.id).some((entity) => entity.id === id);
      },
      keyDown: (key) => this.keysHeld.has(key),
      broadcast: (message) => { this.messages.push(message); },
      loop: (line) => { if (++this.loopBudget > LOOP_LIMIT) throw new LoopLimitError(line); }
    };
    return context;
  }

  /** Every entity a target refers to. Bare names fall back to descriptions, so `move ball up` finds a sphere. */
  private resolveTargets(target: RuntimeTarget, selfId: string | null): Entity[] {
    if (!target) return [];
    if (typeof target === "string") return this.resolveTargets({ kind: "name", name: target }, selfId);
    const scene = this.currentScene;
    if (!("kind" in target)) return scene.entities.filter((entity) => entity.id === target.id);
    const resolver = { scene, selfId, resolve: (nested: unknown) => this.resolveTargets(nested as RuntimeTarget, selfId)[0] };
    if (target.kind === "family") {
      const owners = this.resolveTargets(target.of, selfId);
      if (target.relation === "children") return scene.entities.filter((entity) => owners.some((owner) => owner.id === entity.parent));
      return owners.flatMap((owner) => scene.entities.filter((entity) => entity.id === owner.parent));
    }
    if (target.kind === "name") {
      const named = findNamed(scene, target.name);
      return named ? [named] : describedMatches({ colors: [], noun: target.name.toLowerCase() }, resolver).slice(0, 1);
    }
    const matches = describedMatches(target.description, resolver);
    return target.description.all ? matches : matches.slice(0, 1);
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
    if (command.name === "create") { this.create(command, ownerId); return; }
    const entities = this.resolveTargets(command.target, ownerId);
    if (!entities.length) { this.report(ownerId, command.line, `${command.name}: could not find ${targetLabel(command.target)} in the scene.`); return; }
    for (const entity of entities) {
      // An earlier step (such as destroying a parent) may already have removed this one.
      if (this.currentScene.entities.some((candidate) => candidate.id === entity.id)) this.runCommandOn(command, entity, ownerId);
    }
  }

  private runCommandOn(command: Exclude<RuntimeCommand, { name: "create" }>, entity: Entity, ownerId: string): void {
    const { line } = command;
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
        const next = this.destinationFor(entity, command.destination, ownerId, line);
        if (next) this.applyChanges(this.motion.set(entity, "position", next, duration), ownerId, line);
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

  private destinationFor(entity: Entity, destination: RuntimeDestination, ownerId: string, line: number): Vector | null {
    const position = positionOf(entity);
    let next: Vector;
    if (destination.kind === "point") next = destination.value.map(Number) as Vector;
    else if (destination.kind === "offset") next = position.map((part, index) => part + Number(destination.value[index])) as Vector;
    else if (destination.kind === "direction") next = position.map((part, index) => part + DIRECTIONS[destination.direction][index]! * Number(destination.amount)) as Vector;
    else {
      const anchor = this.resolveTargets(destination.target, ownerId)[0];
      if (!anchor) { this.report(ownerId, line, `could not find ${targetLabel(destination.target)} to move next to.`); return null; }
      if (anchor.id === entity.id) { this.report(ownerId, line, "an object cannot be placed relative to itself."); return null; }
      next = placeRelative(entity, anchor, destination.relation);
    }
    if (next.some((part) => !Number.isFinite(part))) { this.report(ownerId, line, "coordinates must be numbers."); return null; }
    return next;
  }

  /** create a red ball at 0 5 0 · create a box above me called "Crate" */
  private create(command: Extract<RuntimeCommand, { name: "create" }>, ownerId: string): void {
    const label = command.shape === "sphere" ? "Ball" : command.shape === "box" ? "Box" : command.shape[0]!.toUpperCase() + command.shape.slice(1);
    const name = command.called === null || command.called === undefined ? label : String(command.called);
    let index = 1;
    while (this.currentScene.entities.some((entity) => entity.id === `${command.shape}_${index}`)) index += 1;
    const id = `${command.shape}_${index}`;
    const owner = this.currentScene.entities.find((entity) => entity.id === ownerId);
    const color = command.color ? (COLOR_NAMES[command.color.toLowerCase()] ?? command.color) : "#8b7cff";
    const entity: Entity = { id, name, parent: null, components: {
      Transform: { position: owner ? positionOf(owner) : [0, 0.5, 0], ...(command.shape === "plane" ? { rotation: [-90, 0, 0] } : {}) },
      Mesh: { shape: command.shape }, Material: { color }
    } };
    // With no place given, new objects appear just above whoever created them.
    const position = command.place ? this.destinationFor(entity, command.place, ownerId, command.line) : owner ? placeRelative(entity, owner, "above") : [0, 0.5, 0] as Vector;
    if (!position) return;
    entity.components.Transform!.position = position;
    this.applyChanges([{ op: "create", ...entity }], ownerId, command.line);
  }

  private random(min: number, max: number): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return min + (this.randomState / 4294967296) * (max - min);
  }

  /** Run a handler as a coroutine. Handlers that are still waiting are not started again. */
  private invoke(instance: ScriptInstance, runner: Runner | undefined, other?: Handle, handler?: HandlerEntry): void {
    if (!runner || handler?.busy) return;
    let generator: Generator<number, void, unknown>;
    try { generator = runner(this.context(instance, other), instance.state); }
    catch (error) { this.reportError(instance.id, error); return; }
    const coroutine: Coroutine = { instanceId: instance.id, generator, wait: 0, ...(handler ? { handler } : {}) };
    if (handler) handler.busy = true;
    if (this.step(coroutine)) this.coroutines.push(coroutine);
  }

  /** Resume a coroutine until it waits or finishes. Returns true while it is still waiting. */
  private step(coroutine: Coroutine): boolean {
    this.loopBudget = 0;
    const alive = coroutine.instanceId === "" || this.currentScene.entities.some((entity) => entity.id === coroutine.instanceId);
    try {
      const result = alive ? coroutine.generator.next() : { done: true as const, value: undefined };
      if (!result.done) { coroutine.wait = result.value; return true; }
    } catch (error) {
      this.reportError(coroutine.instanceId, error);
    }
    if (coroutine.handler) coroutine.handler.busy = false;
    return false;
  }

  private reportError(entityId: string, error: unknown): void {
    this.issues.push({ entityId, line: error instanceof LoopLimitError ? error.line : 1, column: 1, message: error instanceof Error ? error.message : String(error) });
  }

  private handlersFor(event: HandlerEntry["event"]): [ScriptInstance, HandlerEntry][] {
    return [...this.instances.values()].flatMap((instance) => instance.handlers.filter((handler) => handler.event === event).map((handler) => [instance, handler] as [ScriptInstance, HandlerEntry]));
  }

  /** Deliver broadcasts (and the broadcasts they send) to every "when I receive" handler. */
  private deliverMessages(): void {
    for (let round = 0; round < 20 && this.messages.length; round += 1) {
      const messages = this.messages.splice(0);
      for (const message of messages) {
        for (const [instance, handler] of this.handlersFor("message")) {
          if (handler.message?.toLowerCase() === message.toLowerCase()) this.invoke(instance, handler.run, undefined, handler);
        }
      }
    }
    if (this.messages.length) { this.report("", 1, "Messages kept triggering more messages, so the rest were dropped."); this.messages = []; }
  }

  start(): Scene {
    for (const instance of this.instances.values()) this.invoke(instance, instance.initialize);
    for (const [instance, handler] of this.handlersFor("start")) this.invoke(instance, handler.run, undefined, handler);
    this.deliverMessages();
    return this.currentScene;
  }

  advance(elapsedSeconds: number): Scene {
    const dt = Math.max(0, Math.min(elapsedSeconds, 0.25));
    this.elapsed += dt;
    this.lastDt = dt;
    const waiting = this.coroutines;
    this.coroutines = [];
    for (const coroutine of waiting) {
      coroutine.wait -= dt;
      if (coroutine.wait > 0 || this.step(coroutine)) this.coroutines.push(coroutine);
    }
    for (const instance of this.instances.values()) {
      for (const handler of instance.handlers) {
        if (handler.event === "frame") this.invoke(instance, handler.run, undefined, handler);
        else if (handler.event === "interval") {
          handler.elapsed += dt;
          const seconds = handler.seconds ?? 1;
          if (handler.elapsed >= seconds) { handler.elapsed %= seconds; this.invoke(instance, handler.run, undefined, handler); }
        }
      }
    }
    for (const event of this.pendingEvents.splice(0)) {
      if (event.kind === "key") {
        for (const [instance, handler] of this.handlersFor("key")) if (handler.key === event.key) this.invoke(instance, handler.run, undefined, handler);
      } else {
        // A click on a child also counts as a click on its parent groups.
        const clicked = this.currentScene.entities.find((entity) => entity.id === event.id);
        let current = clicked;
        const seen = new Set<string>();
        while (clicked && current && !seen.has(current.id)) {
          seen.add(current.id);
          const instance = this.instances.get(current.id);
          for (const handler of instance?.handlers ?? []) if (handler.event === "click") this.invoke(instance!, handler.run, handle(clicked), handler);
          current = this.currentScene.entities.find((entity) => entity.id === current!.parent);
        }
      }
    }
    this.deliverMessages();
    this.applyChanges(this.motion.advance(this.currentScene, dt), "", 1);
    return this.currentScene;
  }

  /** A key went down during Play ("space", "left", "a", ... — see keyName in vocabulary). */
  pressKey(key: string): void {
    if (!this.keysHeld.has(key)) this.pendingEvents.push({ kind: "key", key });
    this.keysHeld.add(key);
  }

  releaseKey(key: string): void { this.keysHeld.delete(key); }

  /** An object was clicked in the viewport during Play. */
  click(id: string): void { this.pendingEvents.push({ kind: "click", id }); }

  /**
   * Run script statements once against a scene outside Play (the editor's command bar).
   * Timed moves and waits finish instantly; looping animations need Play, so they are reported instead.
   */
  static runOnce(scene: Scene, source: string): { scene: Scene; issues: ScriptIssue[]; prints: ScriptPrint[] } {
    const runtime = new ScriptRuntime({ ...scene, entities: scene.entities.filter((entity) => !entity.components.Script) });
    runtime.currentScene = scene;
    runtime.compile("", source);
    const instance = runtime.instances.get("");
    if (instance) {
      if (instance.program.handlers.length) runtime.report("", instance.program.handlers[0]!.line, "Event lines such as 'when game starts' only run during Play. Put them in an object's script.");
      else {
        runtime.invoke(instance, instance.initialize);
        for (let guard = 0; runtime.coroutines.length && guard < 1000; guard += 1) {
          runtime.coroutines = runtime.coroutines.filter((coroutine) => runtime.step(coroutine));
        }
      }
      const settled = runtime.motion.settle();
      if (settled.animating) runtime.report("", 1, "Animations loop during Play. Add the line to a script (for example under 'when game starts') and press Play.");
      runtime.applyChanges(settled.ops, "", 1);
    }
    return { scene: runtime.currentScene, issues: runtime.takeIssues(), prints: runtime.takePrints() };
  }

  collide(selfId: string, otherId: string): void {
    const instance = this.instances.get(selfId);
    const entity = this.currentScene.entities.find((candidate) => candidate.id === otherId);
    if (!instance || !entity) return;
    for (const handler of instance.handlers) if (handler.event === "collide") this.invoke(instance, handler.run, handle(entity), handler);
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
    else if ((parameter.type === "string" || parameter.type === "color") && typeof value === "string") instance.state[name] = value;
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
