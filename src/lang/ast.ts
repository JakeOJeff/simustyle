import type { Direction, RelationName, Superlative } from "./vocabulary";

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
  | { kind: "expression"; expression: ScriptExpression; line: number }
  | { kind: "command"; command: ScriptCommand; line: number; column: number };

/** "the red ball above the box": filters applied to scene entities at run time. */
export interface EntityDescription {
  text: string;
  colors: string[];
  noun: string;
  superlative?: Superlative;
  relation?: { relation: RelationName; target: ScriptTarget };
}

/** Who a command acts on. A bare name is a variable when one is declared, otherwise an entity name or id. */
export type ScriptTarget =
  | { kind: "self"; line: number; column: number }
  | { kind: "name"; name: string; quoted: boolean; line: number; column: number }
  | { kind: "describe"; description: EntityDescription; line: number; column: number }
  | { kind: "expression"; expression: ScriptExpression; line: number; column: number };

export type ScriptVector = [ScriptExpression, ScriptExpression, ScriptExpression];

export type MoveDestination =
  | { kind: "point"; value: ScriptVector }
  | { kind: "offset"; value: ScriptVector }
  | { kind: "direction"; direction: Direction; amount: ScriptExpression }
  | { kind: "relative"; relation: RelationName; target: ScriptTarget };

export type ScriptCommand =
  | { name: "move"; target: ScriptTarget; destination: MoveDestination; duration?: ScriptExpression }
  | { name: "destroy"; target: ScriptTarget }
  | { name: "animate"; target: ScriptTarget; words: string[]; wordsLine: number; wordsColumn: number }
  | { name: "stop"; target: ScriptTarget }
  | { name: "turn"; target: ScriptTarget; amount: ScriptVector; duration?: ScriptExpression }
  | { name: "scale"; target: ScriptTarget; mode: "to" | "by"; amount: ScriptExpression; duration?: ScriptExpression }
  | { name: "paint"; target: ScriptTarget; color: ScriptExpression }
  | { name: "push"; target: ScriptTarget; vector: ScriptVector }
  | { name: "hide" | "show"; target: ScriptTarget }
  | { name: "say"; args: ScriptExpression[] };

export type ScriptExpression =
  | { kind: "number"; value: number; line: number; column: number }
  | { kind: "string"; value: string; line: number; column: number }
  | { kind: "boolean"; value: boolean; line: number; column: number }
  | { kind: "color"; value: string; line: number; column: number }
  | { kind: "identifier"; name: string; line: number; column: number }
  | { kind: "member"; object: ScriptExpression; property: string; line: number; column: number }
  | { kind: "call"; callee: ScriptExpression; args: ScriptExpression[]; line: number; column: number }
  | { kind: "binary"; operator: string; left: ScriptExpression; right: ScriptExpression; line: number; column: number }
  | { kind: "unary"; operator: string; argument: ScriptExpression; line: number; column: number }
  | { kind: "describe"; description: EntityDescription; line: number; column: number };
