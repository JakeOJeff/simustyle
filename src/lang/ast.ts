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

/**
 * "when game starts", "forever", "every 2 seconds", "when I touch the floor",
 * "when clicked", "when space is pressed", "when I receive "win"".
 */
export interface ScriptHandler {
  event: "start" | "frame" | "collide" | "interval" | "click" | "key" | "message";
  /** Name the touched object is stored under (always set for collide; "it" by default). */
  parameter?: string;
  intervalSeconds?: number;
  /** key: lower-case key name such as "space", "left", "a". */
  key?: string;
  /** message: the broadcast text this handler listens for. */
  message?: string;
  /** collide: only run when the other object matches this target. */
  filter?: ScriptTarget;
  body: ScriptStatement[];
  line: number;
}

export type ScriptStatement =
  | { kind: "let"; name: string; value: ScriptExpression; line: number }
  | { kind: "assign"; target: ScriptExpression; operator: "=" | "+=" | "-=" | "*=" | "/="; value: ScriptExpression; line: number }
  | { kind: "if"; branches: { condition: ScriptExpression; body: ScriptStatement[] }[]; otherwise: ScriptStatement[]; line: number }
  | { kind: "while"; condition: ScriptExpression; body: ScriptStatement[]; line: number }
  | { kind: "repeat"; count: ScriptExpression; body: ScriptStatement[]; line: number }
  | { kind: "wait"; seconds: ScriptExpression; line: number }
  | { kind: "broadcast"; message: ScriptExpression; line: number }
  | { kind: "expression"; expression: ScriptExpression; line: number }
  | { kind: "command"; command: ScriptCommand; line: number; column: number };

/** "the red ball above the box": filters applied to scene entities at run time. */
export interface EntityDescription {
  text: string;
  colors: string[];
  noun: string;
  superlative?: Superlative;
  relation?: { relation: RelationName; target: ScriptTarget };
  /** "all the red balls", "every cube": the command acts on every match. */
  all?: boolean;
}

/** Who a command acts on. A bare name is a variable when one is declared, otherwise an entity name or id. */
export type ScriptTarget =
  | { kind: "self"; line: number; column: number }
  | { kind: "it"; line: number; column: number }
  | { kind: "name"; name: string; quoted: boolean; line: number; column: number }
  | { kind: "describe"; description: EntityDescription; line: number; column: number }
  | { kind: "family"; relation: "children" | "parent"; of: ScriptTarget; line: number; column: number }
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
  | { name: "create"; shape: string; color?: ScriptExpression; place?: MoveDestination; called?: ScriptExpression }
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
  | { kind: "describe"; description: EntityDescription; line: number; column: number }
  /** "my y", "x of the ball", "distance to the player". */
  | { kind: "property"; target: ScriptTarget; property: string; line: number; column: number }
  | { kind: "keyDown"; key: string; line: number; column: number }
  | { kind: "it"; line: number; column: number };
