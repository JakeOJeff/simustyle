import type { ScriptExpression, ScriptProgram, ScriptStatement } from "./ast";

function quote(value: string): string { return JSON.stringify(value); }

function pathOf(expression: ScriptExpression): string[] | null {
  if (expression.kind === "identifier") return [expression.name];
  if (expression.kind !== "member") return null;
  const parent = pathOf(expression.object);
  return parent ? [...parent, expression.property] : null;
}

function expressionCode(expression: ScriptExpression): string {
  switch (expression.kind) {
    case "number": return String(expression.value);
    case "string": return quote(expression.value);
    case "boolean": return String(expression.value);
    case "color": return quote(expression.value);
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
