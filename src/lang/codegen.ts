import type { EntityDescription, MoveDestination, ScriptCommand, ScriptExpression, ScriptHandler, ScriptProgram, ScriptStatement, ScriptTarget } from "./ast";
import { scriptGlobals } from "./checker";

function quote(value: string): string { return JSON.stringify(value); }

function pathOf(expression: ScriptExpression): string[] | null {
  if (expression.kind === "identifier") return [expression.name];
  if (expression.kind !== "member") return null;
  const parent = pathOf(expression.object);
  return parent ? [...parent, expression.property] : null;
}

function targetCode(target: ScriptTarget): string {
  switch (target.kind) {
    case "self": return "ctx.self";
    case "it": return "(ctx.other ?? ctx.self)";
    // A bare name means a variable or parameter when one exists, otherwise an entity name.
    case "name": return target.quoted ? `{kind:"name",name:${quote(target.name)}}` : `(state[${quote(target.name)}] ?? {kind:"name",name:${quote(target.name)}})`;
    case "describe": return `{kind:"describe",description:${descriptionCode(target.description)}}`;
    case "family": return `{kind:"family",relation:${quote(target.relation)},of:${targetCode(target.of)}}`;
    case "expression": return expressionCode(target.expression);
  }
}

function descriptionCode(description: EntityDescription): string {
  const relation = description.relation ? `,relation:{relation:${quote(description.relation.relation)},target:${targetCode(description.relation.target)}}` : "";
  const superlative = description.superlative ? `,superlative:${quote(description.superlative)}` : "";
  const index = description.index === undefined ? "" : `,index:${description.index}`;
  const all = description.all ? ",all:true" : "";
  return `{text:${quote(description.text)},colors:${JSON.stringify(description.colors)},noun:${quote(description.noun)}${superlative}${index}${relation}${all}}`;
}

function destinationCode(destination: MoveDestination): string {
  const vector = (values: ScriptExpression[]) => `[${values.map(expressionCode).join(",")}]`;
  if (destination.kind === "point" || destination.kind === "offset") return `{kind:${quote(destination.kind)},value:${vector(destination.value)}}`;
  if (destination.kind === "direction") return `{kind:"direction",direction:${quote(destination.direction)},amount:${expressionCode(destination.amount)}}`;
  return `{kind:"relative",relation:${quote(destination.relation)},target:${targetCode(destination.target)}}`;
}

function commandCode(command: ScriptCommand, line: number): string {
  const expression = (value: ScriptExpression) => expressionCode(value);
  const vector = (values: ScriptExpression[]) => `[${values.map(expression).join(",")}]`;
  const duration = (value?: ScriptExpression) => value ? expression(value) : "null";
  let fields: string;
  switch (command.name) {
    case "move": fields = `target:${targetCode(command.target)},destination:${destinationCode(command.destination)},duration:${duration(command.duration)}`; break;
    case "turn": fields = `target:${targetCode(command.target)},mode:${quote(command.mode)},amount:${vector(command.amount)},duration:${duration(command.duration)}`; break;
    case "scale": fields = `target:${targetCode(command.target)},mode:${quote(command.mode)},amount:${expression(command.amount)},duration:${duration(command.duration)}`; break;
    case "paint": fields = `target:${targetCode(command.target)},color:${expression(command.color)}`; break;
    case "push": fields = `target:${targetCode(command.target)},vector:${vector(command.vector)}`; break;
    case "animate": fields = `target:${targetCode(command.target)},words:${JSON.stringify(command.words)}`; break;
    case "create": fields = `shape:${quote(command.shape)},color:${command.color ? expression(command.color) : "null"},place:${command.place ? destinationCode(command.place) : "null"},called:${command.called ? expression(command.called) : "null"},count:${command.count ?? 1},onlyIfMissing:${command.onlyIfMissing === true}`; break;
    case "say": return `ctx.call("print", [${command.args.map(expression).join(", ")}]);`;
    default: fields = `target:${targetCode(command.target)}`;
  }
  return `ctx.command({name:${quote(command.name)},line:${line},${fields}});`;
}

function expressionCode(expression: ScriptExpression): string {
  switch (expression.kind) {
    case "number": return String(expression.value);
    case "string": return quote(expression.value);
    case "boolean": return String(expression.value);
    case "color": return quote(expression.value);
    case "describe": return `ctx.describe(${descriptionCode(expression.description)})`;
    case "it": return "(ctx.other ?? ctx.self)";
    case "keyDown": return `ctx.keyDown(${quote(expression.key)})`;
    case "property": return `ctx.prop(${targetCode(expression.target)}, ${quote(expression.property)})`;
    case "identifier":
      if (expression.name === "self") return "ctx.self";
      if (expression.name === "time" || expression.name === "dt") return `ctx.${expression.name}`;
      return `(state[${quote(expression.name)}] ?? ctx.param(${quote(expression.name)}))`;
    case "member": {
      const path = pathOf(expression);
      if (path?.[0] === "self") return `ctx.get(${JSON.stringify(path.slice(1))})`;
      if (path && path.length === 2 && path[0] === "other") return `ctx.other?.[${quote(path[1])}]`;
      return `(${expressionCode(expression.object)})[${quote(expression.property)}]`;
    }
    case "call": {
      const name = pathOf(expression.callee)?.join(".") ?? "";
      const args = expression.args.map(expressionCode).join(", ");
      if (name.startsWith("self.rigidbody.")) return `ctx.rigidbody(${quote(name.slice("self.rigidbody.".length))}, [${args}])`;
      return `ctx.call(${quote(name)}, [${args}])`;
    }
    case "unary": return expression.operator === "not" ? `(!${expressionCode(expression.argument)})` : `(${expression.operator}${expressionCode(expression.argument)})`;
    case "binary": {
      // Objects are compared by identity, so "if it is the floor" works.
      if (expression.operator === "==") return `ctx.eq(${expressionCode(expression.left)}, ${expressionCode(expression.right)})`;
      if (expression.operator === "!=") return `(!ctx.eq(${expressionCode(expression.left)}, ${expressionCode(expression.right)}))`;
      const operator = expression.operator === "and" ? "&&" : expression.operator === "or" ? "||" : expression.operator;
      return `(${expressionCode(expression.left)} ${operator} ${expressionCode(expression.right)})`;
    }
  }
}

let loopCounter = 0;

function blockCode(statements: ScriptStatement[], depth: number): string {
  return statements.map((child) => statementCode(child, depth)).join("\n");
}

function statementCode(statement: ScriptStatement, depth = 1): string {
  const pad = "  ".repeat(depth);
  switch (statement.kind) {
    case "let": return `${pad}state[${quote(statement.name)}] = ${expressionCode(statement.value)};`;
    case "assign": {
      const path = pathOf(statement.target);
      if (statement.target.kind === "property") return `${pad}ctx.setProp(${targetCode(statement.target.target)}, ${quote(statement.target.property)}, ${quote(statement.operator)}, ${expressionCode(statement.value)}, ${statement.line});`;
      if (path?.[0] === "self") return `${pad}ctx.set(${JSON.stringify(path.slice(1))}, ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      if (statement.target.kind === "identifier") {
        const name = statement.target.name;
        return `${pad}state[${quote(name)}] = ctx.assignLocal(state[${quote(name)}], ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      }
      if (statement.target.kind === "member") return `${pad}ctx.setMember(${expressionCode(statement.target.object)}, ${quote(statement.target.property)}, ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      return `${pad}void 0;`;
    }
    case "if": {
      const branches = statement.branches.map((branch, index) => `${pad}${index ? "else " : ""}if (${expressionCode(branch.condition)}) {\n${blockCode(branch.body, depth + 1)}\n${pad}}`).join(" ");
      return `${branches}${statement.otherwise.length ? ` else {\n${blockCode(statement.otherwise, depth + 1)}\n${pad}}` : ""}`;
    }
    // ctx.loop() stops a loop that never waits before it can freeze the editor.
    case "while": return `${pad}while (${expressionCode(statement.condition)}) {\n${pad}  ctx.loop(${statement.line});\n${blockCode(statement.body, depth + 1)}\n${pad}}`;
    case "repeat": {
      const counter = `__i${loopCounter++}`;
      return `${pad}for (let ${counter} = 0, ${counter}n = Number(${expressionCode(statement.count)}); ${counter} < ${counter}n; ${counter} += 1) {\n${pad}  ctx.loop(${statement.line});\n${blockCode(statement.body, depth + 1)}\n${pad}}`;
    }
    case "wait": return `${pad}yield Math.max(0, Number(${expressionCode(statement.seconds)}) || 0);`;
    case "broadcast": return `${pad}ctx.broadcast(String(${expressionCode(statement.message)}));`;
    case "expression": return `${pad}${expressionCode(statement.expression)};`;
    case "command": return `${pad}${commandCode(statement.command, statement.line)}`;
  }
}

export interface GeneratedHandler {
  event: ScriptHandler["event"];
  seconds?: number;
  key?: string;
  message?: string;
  /** Body of a generator function: each `yield n` waits n seconds. */
  body: string;
}

export interface GeneratedScript {
  initialize: string;
  handlers: GeneratedHandler[];
}

function handlerCode(handler: ScriptHandler): GeneratedHandler {
  let prefix = "";
  if (handler.event === "collide" || handler.event === "created") {
    // Skip objects that do not match the event header's optional target filter.
    if (handler.parameter) prefix += `  state[${quote(handler.parameter)}] = ctx.other;\n`;
    if (handler.filter) prefix += `  if (!ctx.matches(ctx.other, ${targetCode(handler.filter)})) return;\n`;
  }
  return {
    event: handler.event,
    ...(handler.intervalSeconds === undefined ? {} : { seconds: handler.intervalSeconds }),
    ...(handler.key === undefined ? {} : { key: handler.key }),
    ...(handler.message === undefined ? {} : { message: handler.message }),
    body: prefix + blockCode(handler.body, 1)
  };
}

/** Emits only syntax generated from parsed AST nodes; user source is never embedded directly. */
export function generateScript(program: ScriptProgram): GeneratedScript {
  const defaults = [...scriptGlobals(program)].map(([name, type]) => {
    const initial = type === "number" ? "0" : type === "string" ? '""' : type === "boolean" ? "false" : "null";
    return `  if (state[${quote(name)}] === undefined) state[${quote(name)}] = ${initial};`;
  });
  return {
    initialize: [...defaults, blockCode(program.statements, 1)].filter(Boolean).join("\n"),
    handlers: program.handlers.map(handlerCode)
  };
}
