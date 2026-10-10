import type { ScriptCommand, ScriptExpression, ScriptProgram, ScriptStatement, ScriptTarget } from "./ast";

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
    case "name": return `{kind:"name",name:${quote(target.name)}}`;
    case "describe": return `{kind:"describe",description:${JSON.stringify(target.description)}}`;
    case "expression": return expressionCode(target.expression);
  }
}

function commandCode(command: ScriptCommand): string {
  const expression = (value: ScriptExpression) => expressionCode(value);
  const vector = (values: ScriptExpression[]) => `[${values.map(expression).join(",")}]`;
  let fields: string;
  switch (command.name) {
    case "move": {
      const destination = command.destination.kind === "point" || command.destination.kind === "offset"
        ? `{kind:${quote(command.destination.kind)},value:${vector(command.destination.value)}}`
        : command.destination.kind === "direction"
          ? `{kind:"direction",direction:${quote(command.destination.direction)},amount:${expression(command.destination.amount)}}`
          : `{kind:"relative",relation:${quote(command.destination.relation)},target:${targetCode(command.destination.target)}}`;
      fields = `target:${targetCode(command.target)},destination:${destination},duration:${command.duration ? expression(command.duration) : "null"}`;
      break;
    }
    case "turn": fields = `target:${targetCode(command.target)},amount:${vector(command.amount)},duration:${command.duration ? expression(command.duration) : "null"}`; break;
    case "scale": fields = `target:${targetCode(command.target)},mode:${quote(command.mode)},amount:${expression(command.amount)},duration:${command.duration ? expression(command.duration) : "null"}`; break;
    case "paint": fields = `target:${targetCode(command.target)},color:${expression(command.color)}`; break;
    case "push": fields = `target:${targetCode(command.target)},vector:${vector(command.vector)}`; break;
    case "animate": fields = `target:${targetCode(command.target)},words:${JSON.stringify(command.words)}`; break;
    case "say": return `ctx.call("print", [${command.args.map(expression).join(", ")}]);`;
    default: fields = `target:${targetCode(command.target)}`;
  }
  return `ctx.command({name:${quote(command.name)},${fields}});`;
}

function expressionCode(expression: ScriptExpression): string {
  switch (expression.kind) {
    case "number": return String(expression.value);
    case "string": return quote(expression.value);
    case "boolean": return String(expression.value);
    case "color": return quote(expression.value);
    case "describe": return `ctx.describe(${JSON.stringify(expression.description)})`;
    case "identifier":
      if (expression.name === "self") return "ctx.self";
      if (expression.name === "time" || expression.name === "dt") return `ctx.${expression.name}`;
      return `state[${quote(expression.name)}] ?? ctx.param(${quote(expression.name)})`;
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
      const operator = expression.operator === "and" ? "&&" : expression.operator === "or" ? "||" : expression.operator;
      return `(${expressionCode(expression.left)} ${operator} ${expressionCode(expression.right)})`;
    }
  }
}

function statementCode(statement: ScriptStatement, depth = 1): string {
  const pad = "  ".repeat(depth);
  switch (statement.kind) {
    case "let": return `${pad}state[${quote(statement.name)}] = ${expressionCode(statement.value)};`;
    case "assign": {
      const path = pathOf(statement.target);
      if (path?.[0] === "self") return `${pad}ctx.set(${JSON.stringify(path.slice(1))}, ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      if (statement.target.kind === "identifier") {
        const name = statement.target.name;
        return `${pad}state[${quote(name)}] = ctx.assignLocal(state[${quote(name)}], ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      }
      if (statement.target.kind === "member") return `${pad}ctx.setMember(${expressionCode(statement.target.object)}, ${quote(statement.target.property)}, ${quote(statement.operator)}, ${expressionCode(statement.value)});`;
      return `${pad}void 0;`;
    }
    case "if": {
      const branches = statement.branches.map((branch, index) => `${pad}${index ? "else " : ""}if (${expressionCode(branch.condition)}) {\n${branch.body.map((child) => statementCode(child, depth + 1)).join("\n")}\n${pad}}`).join(" ");
      return `${branches}${statement.otherwise.length ? ` else {\n${statement.otherwise.map((child) => statementCode(child, depth + 1)).join("\n")}\n${pad}}` : ""}`;
    }
    case "while": return `${pad}{ let __guard = 0; while (${expressionCode(statement.condition)} && __guard++ < 10000) {\n${statement.body.map((child) => statementCode(child, depth + 1)).join("\n")}\n${pad}} }`;
    case "expression": return `${pad}${expressionCode(statement.expression)};`;
    case "command": return `${pad}${commandCode(statement.command)}`;
  }
}

export interface GeneratedScript {
  start?: string;
  frame?: string;
  collide?: string;
  interval: { seconds: number; body: string }[];
  initialize: string;
}

/** Emits only syntax generated from parsed AST nodes; user source is never embedded directly. */
export function generateScript(program: ScriptProgram): GeneratedScript {
  const compileBody = (body: ScriptStatement[]) => body.map((statement) => statementCode(statement)).join("\n");
  const handlers = {
    start: program.handlers.find((handler) => handler.event === "start"),
    frame: program.handlers.find((handler) => handler.event === "frame"),
    collide: program.handlers.find((handler) => handler.event === "collide")
  };
  return {
    initialize: compileBody(program.statements),
    ...(handlers.start ? { start: compileBody(handlers.start.body) } : {}),
    ...(handlers.frame ? { frame: compileBody(handlers.frame.body) } : {}),
    ...(handlers.collide ? { collide: compileBody(handlers.collide.body) } : {}),
    interval: program.handlers.filter((handler) => handler.event === "interval").map((handler) => ({ seconds: handler.intervalSeconds ?? 1, body: compileBody(handler.body) }))
  };
}
