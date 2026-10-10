export type ScriptTypeName = "float" | "int" | "bool" | "color" | "string";

export interface ScriptParam {
  name: string;
  type: ScriptTypeName;
  min?: number;
  max?: number;
  defaultValue: number | boolean | string;
  line: number;
  column: number;
}

export interface ScriptProgram {
  params: ScriptParam[];
  statements: ScriptStatement[];
  handlers: ScriptHandler[];
}

export interface ScriptHandler {
  event: "start" | "frame" | "collide" | "interval";
  parameter?: string;
  intervalSeconds?: number;
  body: ScriptStatement[];
  line: number;
}

export type ScriptStatement =
  | { kind: "let"; name: string; value: ScriptExpression; line: number }
  | { kind: "assign"; target: ScriptExpression; operator: "=" | "+=" | "-=" | "*=" | "/="; value: ScriptExpression; line: number }
  | { kind: "if"; branches: { condition: ScriptExpression; body: ScriptStatement[] }[]; otherwise: ScriptStatement[]; line: number }
  | { kind: "while"; condition: ScriptExpression; body: ScriptStatement[]; line: number }
  | { kind: "expression"; expression: ScriptExpression; line: number };

export type ScriptExpression =
  | { kind: "number"; value: number; line: number; column: number }
  | { kind: "string"; value: string; line: number; column: number }
  | { kind: "boolean"; value: boolean; line: number; column: number }
  | { kind: "color"; value: string; line: number; column: number }
  | { kind: "identifier"; name: string; line: number; column: number }
  | { kind: "member"; object: ScriptExpression; property: string; line: number; column: number }
  | { kind: "call"; callee: ScriptExpression; args: ScriptExpression[]; line: number; column: number }
  | { kind: "binary"; operator: string; left: ScriptExpression; right: ScriptExpression; line: number; column: number }
  | { kind: "unary"; operator: string; argument: ScriptExpression; line: number; column: number };
