import { componentSchemas } from "../registry";
import type { FieldSchema } from "../registry/types";
import { ANIMATION_STYLE_LIST, matchAnimation } from "./vocabulary";
import type { ScriptExpression, ScriptProgram, ScriptStatement, ScriptTarget, ScriptTypeName } from "./ast";

export interface ScriptDiagnostic {
  line: number;
  column: number;
  message: string;
}

type ValueType = "number" | "boolean" | "string" | "color" | "vec3" | "entity" | "component" | "null" | "unknown";

function fieldType(field: FieldSchema): ValueType {
  switch (field.type) {
    case "float":
    case "int": return "number";
    case "bool": return "boolean";
    case "color": return "color";
    case "vec3": return "vec3";
    case "enum":
    case "string": return "string";
    case "entityRef": return "entity";
  }
}

function parameterType(type: ScriptTypeName): ValueType {
  if (type === "float" || type === "int") return "number";
  if (type === "bool") return "boolean";
  if (type === "color") return "color";
  return "string";
}

function flatten(expression: ScriptExpression): string[] | null {
  if (expression.kind === "identifier") return [expression.name];
  if (expression.kind !== "member") return null;
  const parent = flatten(expression.object);
  return parent ? [...parent, expression.property] : null;
}

/** Rough type of a value from its shape, used for variables created with "set". */
function guessType(expression: ScriptExpression): ValueType {
  switch (expression.kind) {
    case "number": return "number";
    case "string": return "string";
    case "boolean": case "keyDown": return "boolean";
    case "color": return "color";
    case "describe": case "it": return "entity";
    case "unary": return expression.operator === "not" ? "boolean" : "number";
    case "binary":
      if (["and", "or", "==", "!=", "<", "<=", ">", ">="].includes(expression.operator)) return "boolean";
      return guessType(expression.left) === "string" || guessType(expression.right) === "string" ? "string" : "number";
    case "property": return expression.property === "color" || expression.property === "colour" ? "color" : expression.property === "name" ? "string" : "number";
    case "call": {
      const name = expression.callee.kind === "identifier" ? expression.callee.name : "";
      return ["spawn", "find"].includes(name) ? "entity" : ["print", "destroy"].includes(name) ? "unknown" : "number";
    }
    default: return "unknown";
  }
}

/**
 * Variables a script creates with "set x to ...", "change x by ...", or "x = ...".
 * They belong to the whole script, so every event can read them. Numbers start at 0.
 */
export function scriptGlobals(program: ScriptProgram): Map<string, "number" | "string" | "boolean" | "other"> {
  const declared = new Set(program.params.map((param) => param.name));
  const found = new Map<string, "number" | "string" | "boolean" | "other">();
  const visit = (statements: ScriptStatement[]) => {
    for (const statement of statements) {
      if (statement.kind === "let") declared.add(statement.name);
      else if (statement.kind === "assign" && statement.target.kind === "identifier" && !found.has(statement.target.name)) {
        const type = statement.operator === "=" ? guessType(statement.value) : "number";
        found.set(statement.target.name, type === "number" || type === "string" || type === "boolean" ? type : "other");
      } else if (statement.kind === "if") { statement.branches.forEach((branch) => visit(branch.body)); visit(statement.otherwise); }
      else if (statement.kind === "while" || statement.kind === "repeat") visit(statement.body);
    }
  };
  visit(program.statements);
  for (const handler of program.handlers) visit(handler.body);
  for (const name of declared) found.delete(name);
  return found;
}

function componentSchema(name: string) {
  return Object.values(componentSchemas).find((schema) => schema.name.toLowerCase() === name.toLowerCase());
}

export function typecheckScript(program: ScriptProgram): ScriptDiagnostic[] {
  const diagnostics: ScriptDiagnostic[] = [];
  const params = new Map<string, ValueType>();
  for (const param of program.params) {
    if (params.has(param.name)) diagnostics.push({ line: param.line, column: param.column, message: `Parameter '${param.name}' is already declared.` });
    params.set(param.name, parameterType(param.type));
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      diagnostics.push({ line: param.line, column: param.column, message: `Parameter '${param.name}' has a minimum greater than its maximum.` });
    }
    if (param.type === "color" && (typeof param.defaultValue !== "string" || !/^#[0-9a-fA-F]{6}$/.test(param.defaultValue))) {
      diagnostics.push({ line: param.line, column: param.column, message: `Color parameter '${param.name}' needs a #rrggbb default.` });
    } else if ((param.type === "float" || param.type === "int") && typeof param.defaultValue !== "number") {
      diagnostics.push({ line: param.line, column: param.column, message: `Numeric parameter '${param.name}' needs a numeric default.` });
    } else if (param.type === "int" && typeof param.defaultValue === "number" && !Number.isInteger(param.defaultValue)) {
      diagnostics.push({ line: param.line, column: param.column, message: `Integer parameter '${param.name}' needs an integer default.` });
    }
    if (typeof param.defaultValue === "number" && param.min !== undefined && param.defaultValue < param.min) {
      diagnostics.push({ line: param.line, column: param.column, message: `Default for '${param.name}' is below its minimum.` });
    }
    if (typeof param.defaultValue === "number" && param.max !== undefined && param.defaultValue > param.max) {
      diagnostics.push({ line: param.line, column: param.column, message: `Default for '${param.name}' is above its maximum.` });
    }
  }

  function report(expression: ScriptExpression, message: string): void {
    diagnostics.push({ line: expression.line, column: expression.column, message });
  }

  function expressionType(expression: ScriptExpression, variables: Map<string, ValueType>, eventNames: Set<string>): ValueType {
    switch (expression.kind) {
      case "number": return "number";
      case "string": return "string";
      case "boolean": return "boolean";
      case "color": return "color";
      case "describe": case "it": return "entity";
      case "keyDown": return "boolean";
      case "property": {
        checkTarget(expression.target, variables, eventNames);
        return guessType(expression);
      }
      case "identifier": {
        if (expression.name === "self" || eventNames.has(expression.name)) return "entity";
        if (expression.name === "time" || expression.name === "dt") return "number";
        const variable = variables.get(expression.name) ?? params.get(expression.name);
        if (variable) return variable;
        report(expression, `Unknown name '${expression.name}'.`);
        return "unknown";
      }
      case "member": {
        const path = flatten(expression);
        if (path?.[0] === "self") {
          if (path.length === 2 && path[1] === "name") return "string";
          const schema = path[1] ? componentSchema(path[1]) : undefined;
          if (!schema) {
            const close = Object.values(componentSchemas).find((candidate) => candidate.name.toLowerCase().startsWith((path[1] ?? "").toLowerCase()[0] ?? ""));
            report(expression, `No component named '${path[1]}'.${close ? ` Did you mean ${close.name}?` : ""}`);
            return "unknown";
          }
          if (path.length === 2) return "component";
          const field = schema.fields[path[2]];
          if (!field) {
            report(expression, `${schema.name} has no field '${path[2]}'.`);
            return "unknown";
          }
          if (path.length === 3) return fieldType(field);
          if (path.length === 4 && field.type === "vec3" && ["x", "y", "z"].includes(path[3])) return "number";
          report(expression, `Field '${schema.name}.${path[2]}' has no member '${path[3]}'.`);
          return "unknown";
        }
        if (path?.length === 2 && eventNames.has(path[0]) && ["name", "id"].includes(path[1])) return "string";
        if (expression.object.kind === "identifier" && eventNames.has(expression.object.name) && ["name", "id"].includes(expression.property)) return "string";
        const objectType = expressionType(expression.object, variables, eventNames);
        if (objectType === "vec3" && ["x", "y", "z"].includes(expression.property)) return "number";
        report(expression, `Cannot read '${expression.property}' from a ${objectType} value.`);
        return "unknown";
      }
      case "call": {
        const path = flatten(expression.callee);
        const name = path?.join(".") ?? "";
        const args = expression.args.map((argument) => expressionType(argument, variables, eventNames));
        if (name === "self.rigidbody.applyImpulse" || name === "self.rigidbody.setVelocity") {
          if (args.length !== 3 || args.some((type) => type !== "number" && type !== "unknown")) report(expression, `${name} expects three numbers.`);
          return "null";
        }
        const arities: Record<string, [number, number, ValueType]> = {
          random: [2, 2, "number"], sin: [1, 1, "number"], cos: [1, 1, "number"], abs: [1, 1, "number"],
          sqrt: [1, 1, "number"], min: [1, Infinity, "number"], max: [1, Infinity, "number"],
          clamp: [3, 3, "number"], lerp: [3, 3, "number"], print: [0, Infinity, "null"],
          spawn: [4, 4, "entity"], destroy: [1, 1, "null"], find: [1, 1, "entity"]
        };
        const signature = arities[name];
        if (!signature) {
          report(expression, `Unknown function '${name || "(expression)"}'.`);
          return "unknown";
        }
        if (args.length < signature[0] || args.length > signature[1]) report(expression, `${name} expects ${signature[0] === signature[1] ? signature[0] : `at least ${signature[0]}`} argument${signature[0] === 1 ? "" : "s"}.`);
        if (["sin", "cos", "abs", "sqrt", "min", "max", "clamp", "lerp", "random"].includes(name) && args.some((type) => type !== "number" && type !== "unknown")) {
          report(expression, `${name} arguments must be numbers.`);
        }
        if (name === "destroy" && args[0] !== "entity" && args[0] !== "unknown") report(expression, "destroy expects an entity.");
        if (name === "find" && args[0] !== "string" && args[0] !== "unknown") report(expression, "find expects a string name.");
        if (name === "spawn" && args.some((type, index) => type !== "unknown" && type !== (index === 0 ? "string" : "number"))) {
          report(expression, "spawn expects a prefab name followed by three numbers.");
        }
        return signature[2];
      }
      case "unary": {
        const argument = expressionType(expression.argument, variables, eventNames);
        if (expression.operator === "not" && argument !== "boolean" && argument !== "unknown") report(expression, "not expects a boolean.");
        if (expression.operator !== "not" && argument !== "number" && argument !== "unknown") report(expression, `${expression.operator} expects a number.`);
        return expression.operator === "not" ? "boolean" : "number";
      }
      case "binary": {
        const left = expressionType(expression.left, variables, eventNames);
        const right = expressionType(expression.right, variables, eventNames);
        if (["and", "or"].includes(expression.operator)) {
          if ((left !== "boolean" && left !== "unknown") || (right !== "boolean" && right !== "unknown")) report(expression, `${expression.operator} expects boolean values.`);
          return "boolean";
        }
        if (["==", "!=", "<", "<=", ">", ">="].includes(expression.operator)) {
          if (left !== "unknown" && right !== "unknown" && left !== right && !(left === "null" && right === "entity") && !(left === "entity" && right === "null") && !(left === "string" && right === "entity") && !(left === "entity" && right === "string")) {
            report(expression, `Cannot compare ${left} and ${right}.`);
          }
          return "boolean";
        }
        if (expression.operator === "+" && (left === "string" || right === "string")) return "string";
        if ((left !== "number" && left !== "unknown") || (right !== "number" && right !== "unknown")) report(expression, `${expression.operator} expects numbers.`);
        return "number";
      }
    }
  }

  function checkTarget(target: ScriptTarget, variables: Map<string, ValueType>, eventNames: Set<string>): void {
    if (target.kind === "expression") expressionType(target.expression, variables, eventNames);
    else if (target.kind === "family") checkTarget(target.of, variables, eventNames);
    else if (target.kind === "describe" && target.description.relation) checkTarget(target.description.relation.target, variables, eventNames);
  }

  function checkStatements(statements: ScriptStatement[], variables: Map<string, ValueType>, eventNames: Set<string>): void {
    for (const statement of statements) {
      if (statement.kind === "let") {
        const value = expressionType(statement.value, variables, eventNames);
        if (params.has(statement.name) || variables.has(statement.name)) diagnostics.push({ line: statement.line, column: 1, message: `'${statement.name}' is already declared.` });
        variables.set(statement.name, value);
      } else if (statement.kind === "assign") {
        const target = expressionType(statement.target, variables, eventNames);
        const value = expressionType(statement.value, variables, eventNames);
        const path = flatten(statement.target);
        if (statement.target.kind === "property") {
          if (statement.target.property === "name") report(statement.target, "An object's name cannot be changed by a script.");
          else if (statement.target.property === "distance") report(statement.target, "Distance is measured, so it cannot be set. Move the object instead.");
          else if (statement.operator !== "=" && target !== "number") report(statement.target, "change only works on numbers.");
          else if (value !== "unknown" && value !== target) report(statement.value, `${statement.target.property} must be set to a ${target}.`);
          continue;
        }
        if (statement.target.kind === "identifier" && !variables.has(statement.target.name)) {
          report(statement.target, `Cannot assign to undeclared name '${statement.target.name}'.`);
        } else if (path?.[0] === "self" && path[1] === "name") {
          report(statement.target, "self.name is read-only.");
        } else if (!(statement.target.kind === "identifier" && variables.has(statement.target.name)) && (!path?.length || path[0] !== "self" || target === "component")) {
          report(statement.target, "Assignment target must be a local variable or self component field.");
        }
        if (statement.operator !== "=" && target !== "number" && target !== "unknown") report(statement.target, `${statement.operator} can only update numeric fields.`);
        if (target !== "unknown" && value !== "unknown" && target !== value && !(target === "number" && value === "number")) {
          report(statement.target, `Cannot assign ${value} to ${target}.`);
        }
      } else if (statement.kind === "if") {
        for (const branch of statement.branches) {
          const condition = expressionType(branch.condition, variables, eventNames);
          if (condition !== "boolean" && condition !== "unknown") report(branch.condition, "if condition must be a boolean.");
          checkStatements(branch.body, new Map(variables), eventNames);
        }
        checkStatements(statement.otherwise, new Map(variables), eventNames);
      } else if (statement.kind === "while") {
        const condition = expressionType(statement.condition, variables, eventNames);
        if (condition !== "boolean" && condition !== "unknown") report(statement.condition, "while condition must be a boolean.");
        checkStatements(statement.body, new Map(variables), eventNames);
      } else if (statement.kind === "repeat") {
        const count = expressionType(statement.count, variables, eventNames);
        if (count !== "number" && count !== "unknown") report(statement.count, "repeat needs a number of times.");
        checkStatements(statement.body, new Map(variables), eventNames);
      } else if (statement.kind === "wait") {
        const seconds = expressionType(statement.seconds, variables, eventNames);
        if (seconds !== "number" && seconds !== "unknown") report(statement.seconds, "wait needs a number of seconds.");
      } else if (statement.kind === "broadcast") {
        expressionType(statement.message, variables, eventNames);
      } else if (statement.kind === "expression") {
        expressionType(statement.expression, variables, eventNames);
      } else if (statement.kind === "command") {
        const command = statement.command;
        const requireType = (expression: ScriptExpression, expected: ValueType, label: string) => {
          const actual = expressionType(expression, variables, eventNames);
          if (actual !== expected && actual !== "unknown") report(expression, `${label} must be ${expected}.`);
        };
        if (command.name === "say") {
          for (const argument of command.args) expressionType(argument, variables, eventNames);
        } else if (command.name === "create") {
          if (command.color) requireType(command.color, "color", "The color");
          if (command.place?.kind === "point") command.place.value.forEach((value) => requireType(value, "number", "Coordinates"));
          else if (command.place?.kind === "relative") checkTarget(command.place.target, variables, eventNames);
          if (command.called) expressionType(command.called, variables, eventNames);
        } else {
          checkTarget(command.target, variables, eventNames);
          switch (command.name) {
            case "move":
              if (command.destination.kind === "point" || command.destination.kind === "offset") command.destination.value.forEach((value) => requireType(value, "number", "Coordinates"));
              else if (command.destination.kind === "direction") requireType(command.destination.amount, "number", "Distance");
              else checkTarget(command.destination.target, variables, eventNames);
              if (command.duration) requireType(command.duration, "number", "Duration");
              break;
            case "turn": command.amount.forEach((value) => requireType(value, "number", "Turn amount")); if (command.duration) requireType(command.duration, "number", "Duration"); break;
            case "scale": requireType(command.amount, "number", "Scale amount"); if (command.duration) requireType(command.duration, "number", "Duration"); break;
            case "paint": requireType(command.color, "color", "Paint color"); break;
            case "push": command.vector.forEach((value) => requireType(value, "number", "Push amount")); break;
            case "animate":
              if (!matchAnimation(command.words)) diagnostics.push({ line: command.wordsLine, column: command.wordsColumn, message: `I don't know how to animate '${command.words.join(" ")}'. Try a word like: ${ANIMATION_STYLE_LIST}.` });
              break;
            case "destroy":
            case "stop":
            case "hide":
            case "show": break;
          }
        }
      }
    }
  }

  const globalVariables = new Map<string, ValueType>();
  for (const [name, type] of scriptGlobals(program)) globalVariables.set(name, type === "other" ? "unknown" : type);
  checkStatements(program.statements, globalVariables, new Set());
  const events = new Set(program.handlers.filter((handler) => handler.parameter).map((handler) => handler.parameter!));
  for (const handler of program.handlers) {
    const variables = new Map(globalVariables);
    if (handler.parameter) variables.set(handler.parameter, "entity");
    if (handler.filter) checkTarget(handler.filter, variables, new Set());
    checkStatements(handler.body, variables, new Set([...events, ...(handler.parameter ? [handler.parameter] : [])]));
  }
  return diagnostics;
}
