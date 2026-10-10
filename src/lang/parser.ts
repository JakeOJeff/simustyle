import type { EntityDescription, MoveDestination, ScriptCommand, ScriptExpression, ScriptHandler, ScriptParam, ScriptProgram, ScriptStatement, ScriptTarget, ScriptTypeName, ScriptVector } from "./ast.js";
import { lexScript, ScriptError } from "./lexer.js";
import type { Token } from "./lexer.js";
import { COLOR_NAMES, COMMAND_WORDS, DIRECTION_ALIASES, DIRECTIONS, FILLER_WORDS, SUPERLATIVES, type Direction, type RelationName } from "./vocabulary.js";

const types = new Set<ScriptTypeName>(["float", "int", "bool", "color", "string"]);
const commandWords = new Set<string>(COMMAND_WORDS);
const durationWords = new Set(["over", "in", "for"]);
const secondWords = new Set(["s", "sec", "secs", "second", "seconds"]);

class Parser {
  private index = 0;
  private readonly params: ScriptParam[] = [];
  private readonly statements: ScriptStatement[] = [];
  private readonly handlers: ScriptHandler[] = [];

  constructor(private readonly tokens: Token[]) {}

  parse(): ScriptProgram {
    this.skipNewlines();
    while (!this.at("eof")) {
      if (this.word("param")) this.parseParam();
      else if (this.word("on") || this.word("every")) this.handlers.push(this.parseHandler());
      else this.statements.push(this.parseStatement());
      this.skipNewlines();
    }
    return { params: this.params, statements: this.statements, handlers: this.handlers };
  }

  private parseParam(): void {
    const start = this.expectWord("param");
    const name = this.expectIdentifier("Expected a parameter name");
    this.expectValue(":", "Expected ':' after parameter name");
    const typeToken = this.expectIdentifier("Expected a parameter type");
    if (!types.has(typeToken.value as ScriptTypeName)) this.failAt(typeToken, `Unknown parameter type '${typeToken.value}'`);
    const type = typeToken.value as ScriptTypeName;
    let min: number | undefined;
    let max: number | undefined;
    if (this.peek().kind === "number") {
      min = Number(this.advance().value);
      this.expectValue("..", "Expected '..' between parameter range values");
      max = Number(this.expectKind("number", "Expected maximum parameter value").value);
      if (min > max) this.failAt(start, "Parameter range minimum must not exceed its maximum");
    }
    this.expectValue("=", "Expected '=' before parameter default");
    const value = this.parsePrimary();
    if (!(value.kind === "number" || value.kind === "string" || value.kind === "boolean" || value.kind === "color")) {
      this.failAt(this.previous(), "Parameter defaults must be literal values");
    }
    const defaultValue = value.kind === "number" || value.kind === "boolean" ? value.value : value.value;
    this.params.push({ name: name.value, type, ...(min === undefined ? {} : { min, max }), defaultValue, line: start.line, column: start.column });
    this.requireLineEnd();
  }

  private parseHandler(): ScriptHandler {
    const start = this.advance();
    let event: ScriptHandler["event"];
    let parameter: string | undefined;
    let intervalSeconds: number | undefined;
    if (start.value === "on") {
      const kind = this.expectIdentifier("Expected 'start' or 'collide' after 'on'");
      if (kind.value === "start") event = "start";
      else if (kind.value === "collide") {
        event = "collide";
        this.expectValue("(", "Expected '(' after 'collide'");
        parameter = this.expectIdentifier("Expected collision parameter name").value;
        this.expectValue(")", "Expected ')' after collision parameter");
      } else this.failAt(kind, `Unknown event '${kind.value}'`);
    } else {
      if (this.word("frame")) { this.advance(); event = "frame"; }
      else {
        const amount = this.expectKind("number", "Expected 'frame' or an interval in seconds");
        intervalSeconds = Number(amount.value);
        if (!this.word("s")) this.failAt(this.peek(), "Expected 's' after interval seconds");
        this.advance();
        if (intervalSeconds <= 0) this.failAt(amount, "Interval must be greater than zero");
        event = "interval";
      }
    }
    this.expectValue(":", "Expected ':' after handler declaration");
    const body = this.parseIndentedBlock(start);
    return { event, ...(parameter === undefined ? {} : { parameter }), ...(intervalSeconds === undefined ? {} : { intervalSeconds }), body, line: start.line };
  }

  private parseIndentedBlock(header: Token): ScriptStatement[] {
    this.requireLineEnd();
    this.skipNewlines();
    if (!this.at("indent")) this.failAt(this.peek(), "Expected an indented block after ':'");
    this.advance();
    const body: ScriptStatement[] = [];
    this.skipNewlines();
    while (!this.at("dedent") && !this.at("eof")) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    if (this.at("eof")) this.failAt(header, "Expected the indented block to end");
    this.advance();
    return body;
  }

  private parseStatement(): ScriptStatement {
    const start = this.peek();
    if (this.word("let")) {
      this.advance();
      const name = this.expectIdentifier("Expected a name after 'let'");
      this.expectValue("=", "Expected '=' in let declaration");
      const value = this.parseExpression();
      this.requireLineEnd();
      return { kind: "let", name: name.value, value, line: start.line };
    }
    if (this.isCommandStart()) return this.parseCommand();
    if (this.word("if")) return this.parseIf();
    if (this.word("while")) {
      this.advance();
      const condition = this.parseExpression();
      this.expectValue(":", "Expected ':' after while condition");
      const body = this.parseIndentedBlock(start);
      return { kind: "while", condition, body, line: start.line };
    }

    const target = this.parseExpression();
    if (this.peek().kind === "operator" && ["=", "+=", "-=", "*=", "/="].includes(this.peek().value)) {
      const operator = this.advance().value as "=" | "+=" | "-=" | "*=" | "/=";
      const value = this.parseExpression();
      this.requireLineEnd();
      return { kind: "assign", target, operator, value, line: start.line };
    }
    this.requireLineEnd();
    return { kind: "expression", expression: target, line: start.line };
  }

  private parseIf(): ScriptStatement {
    const start = this.expectWord("if");
    const branches: { condition: ScriptExpression; body: ScriptStatement[] }[] = [];
    const condition = this.parseExpression();
    this.expectValue(":", "Expected ':' after if condition");
    branches.push({ condition, body: this.parseIndentedBlock(start) });
    this.skipNewlines();
    while (this.word("else") && this.peek(1).value === "if") {
      const branchStart = this.advance();
      this.advance();
      const branchCondition = this.parseExpression();
      this.expectValue(":", "Expected ':' after else if condition");
      branches.push({ condition: branchCondition, body: this.parseIndentedBlock(branchStart) });
      this.skipNewlines();
    }
    let otherwise: ScriptStatement[] = [];
    if (this.word("else")) {
      const elseToken = this.advance();
      this.expectValue(":", "Expected ':' after else");
      otherwise = this.parseIndentedBlock(elseToken);
    }
    return { kind: "if", branches, otherwise, line: start.line };
  }

  /** `destroy(x)` and `color = ...` keep their old meaning; `destroy x` is a command. */
  private isCommandStart(): boolean {
    const token = this.peek();
    if (token.kind !== "identifier" || !commandWords.has(token.value)) return false;
    const next = this.peek(1);
    if (next.kind === "punctuation" && (next.value === "." || next.value === "(")) return false;
    if (next.kind === "operator" && next.value !== "-") return false;
    return true;
  }

  private parseCommand(): ScriptStatement {
    const start = this.advance();
    const name = start.value;
    let command: ScriptCommand;
    if (name === "move" || name === "glide") {
      let target = this.parseTarget();
      let destination: MoveDestination;
      // "move the ball above the box": the description grabbed "above the box", but it is the destination.
      if (target.kind === "describe" && target.description.relation && (this.atLineEnd() || this.atDuration())) {
        const { relation, ...rest } = target.description;
        destination = { kind: "relative", relation: relation.relation, target: relation.target };
        target = { ...target, description: rest };
      } else destination = this.parseDestination();
      const duration = this.parseDuration() ?? (name === "glide" ? { kind: "number" as const, value: 1, line: start.line, column: start.column } : undefined);
      command = { name: "move", target, destination, ...(duration ? { duration } : {}) };
    } else if (name === "destroy" || name === "hide" || name === "show") {
      command = { name, target: this.parseTarget() };
    } else if (name === "animate") {
      const target = this.parseTarget();
      if (this.word("as") || this.word("like")) this.advance();
      const first = this.peek();
      const words: string[] = [];
      while (!this.atLineEnd()) {
        const token = this.advance();
        words.push(...(token.kind === "string" ? token.value.split(/\s+/).filter(Boolean) : [token.value]));
      }
      if (!words.length) this.failAt(first, "Describe the animation, for example 'animate ball like a bouncing ball'");
      command = { name: "animate", target, words, wordsLine: first.line, wordsColumn: first.column };
    } else if (name === "stop") {
      if (this.word("animating") || this.word("moving")) this.advance();
      command = { name: "stop", target: this.atLineEnd() ? { kind: "self", line: start.line, column: start.column } : this.parseTarget() };
    } else if (name === "turn") {
      const target = this.parseTarget();
      if (this.word("by")) this.advance();
      let amount: ScriptVector;
      if (this.word("left") || this.word("right")) {
        const side = this.advance();
        const degrees = this.parseUnary();
        amount = [this.zero(side), side.value === "left" ? degrees : { kind: "unary", operator: "-", argument: degrees, line: side.line, column: side.column }, this.zero(side)];
      } else {
        const first = this.parseUnary();
        amount = this.startsValue() ? [first, this.parseComponent(), this.parseComponent()] : [this.zero(start), first, this.zero(start)];
      }
      if (this.word("degrees") || this.word("deg")) this.advance();
      const duration = this.parseDuration();
      command = { name: "turn", target, amount, ...(duration ? { duration } : {}) };
    } else if (name === "scale" || name === "resize") {
      const target = this.parseTarget();
      if (!this.word("to") && !this.word("by")) this.failAt(this.peek(), `Expected 'to' or 'by' after the object in '${name}'`);
      const mode = this.advance().value as "to" | "by";
      const amount = this.parseUnary();
      if (this.word("times") || this.word("x")) this.advance();
      const duration = this.parseDuration();
      command = { name: "scale", target, mode, amount, ...(duration ? { duration } : {}) };
    } else if (name === "paint" || name === "color") {
      const target = this.parseTarget();
      if (this.word("to") || this.word("with")) this.advance();
      const token = this.peek();
      const color = token.kind === "identifier" && COLOR_NAMES[token.value.toLowerCase()]
        ? (this.advance(), { kind: "color" as const, value: COLOR_NAMES[token.value.toLowerCase()]!, line: token.line, column: token.column })
        : this.parseExpression();
      command = { name: "paint", target, color };
    } else if (name === "push") {
      const target = this.parseTarget();
      const direction = DIRECTION_ALIASES[this.peek().value];
      if (direction && this.peek().kind === "identifier") {
        const word = this.advance();
        const amount = this.atLineEnd() ? { kind: "number" as const, value: 5, line: word.line, column: word.column } : this.parseUnary();
        command = { name: "push", target, vector: this.directionVector(direction, amount, word) };
      } else {
        if (this.word("by") || this.word("with")) this.advance();
        command = { name: "push", target, vector: this.parseVector() };
      }
    } else {
      const args: ScriptExpression[] = [];
      while (!this.atLineEnd()) {
        args.push(this.parseExpression());
        if (this.peek().value === ",") this.advance();
      }
      command = { name: "say", args };
    }
    this.requireLineEnd();
    return { kind: "command", command, line: start.line, column: start.column };
  }

  private parseTarget(): ScriptTarget {
    const token = this.peek();
    if (this.word("the")) return { kind: "describe", description: this.parseDescription(), line: token.line, column: token.column };
    if (this.word("self") || this.word("me") || this.word("myself")) {
      // `self.transform...` is an expression, not a plain self target.
      if (this.peek(1).value !== ".") { this.advance(); return { kind: "self", line: token.line, column: token.column }; }
    }
    if (token.kind === "string") { this.advance(); return { kind: "name", name: token.value, quoted: true, line: token.line, column: token.column }; }
    if (token.kind === "identifier") {
      const next = this.peek(1);
      if (next.value === "." || next.value === "(") return { kind: "expression", expression: this.parsePostfix(), line: token.line, column: token.column };
      this.advance();
      return { kind: "name", name: token.value, quoted: false, line: token.line, column: token.column };
    }
    this.failAt(token, "Expected an object: a name, 'self', or a description such as 'the red ball'");
  }

  /** the [nearest|biggest...] [red|blue...] <ball|box|one|name> [above|beside|... <target>] */
  private parseDescription(): EntityDescription {
    this.expectWord("the");
    const words = ["the"];
    const colors: string[] = [];
    let superlative: EntityDescription["superlative"];
    let noun = "";
    while (this.peek().kind === "identifier") {
      const token = this.advance();
      const word = token.value.toLowerCase();
      words.push(token.value);
      if (COLOR_NAMES[word]) colors.push(word === "grey" ? "gray" : word);
      else if (SUPERLATIVES[word] && !superlative) superlative = SUPERLATIVES[word];
      else { noun = word; break; }
    }
    if (!noun) this.failAt(this.peek(), "Say what kind of object you mean, for example 'the red ball' or 'the one above the box'");
    const save = this.index;
    while (this.peek().kind === "identifier" && FILLER_WORDS.has(this.peek().value)) this.advance();
    const relation = this.parseRelation();
    if (!relation) {
      this.index = save;
      return { text: words.join(" "), colors, noun, ...(superlative ? { superlative } : {}) };
    }
    const target = this.parseTarget();
    return { text: words.join(" "), colors, noun, ...(superlative ? { superlative } : {}), relation: { relation, target } };
  }

  /** Consumes a spatial phrase ("above", "next to", "to the left of", "in front of") if one is next. */
  private parseRelation(): RelationName | null {
    const word = this.peek().kind === "identifier" ? this.peek().value : "";
    const next = this.peek(1).value;
    const take = (count: number, relation: RelationName) => { for (let index = 0; index < count; index += 1) this.advance(); return relation; };
    if (word === "above") return take(1, "above");
    if (word === "on") return next === "top" && this.peek(2).value === "of" ? take(3, "above") : take(1, "above");
    if (["below", "under", "underneath", "beneath"].includes(word)) return take(1, "below");
    if (word === "beside") return take(1, "beside");
    if (word === "next" && next === "to") return take(2, "beside");
    if (word === "near" || word === "nearby") return take(1, "near");
    if (word === "behind") return take(1, "behind");
    if ((word === "left" || word === "right") && next === "of") return take(2, word);
    if (word === "to" && next === "the" && ["left", "right"].includes(this.peek(2).value) && this.peek(3).value === "of") return take(4, this.peek(2).value as RelationName);
    if (word === "in" && next === "front" && this.peek(2).value === "of") return take(3, "front");
    return null;
  }

  private parseDestination(): MoveDestination {
    const relation = this.parseRelation();
    if (relation) return { kind: "relative", relation, target: this.parseTarget() };
    if (this.word("to")) {
      this.advance();
      const after = this.parseRelation();
      if (after) return { kind: "relative", relation: after, target: this.parseTarget() };
      return { kind: "point", value: this.parseVector() };
    }
    if (this.word("by")) { this.advance(); return { kind: "offset", value: this.parseVector() }; }
    const direction = this.peek().kind === "identifier" ? DIRECTION_ALIASES[this.peek().value] : undefined;
    if (direction) {
      const word = this.advance();
      const amount = this.atLineEnd() || this.atDuration() ? { kind: "number" as const, value: 1, line: word.line, column: word.column } : this.parseUnary();
      return { kind: "direction", direction, amount };
    }
    this.failAt(this.peek(), "Expected where to move: 'to x y z', 'by x y z', 'up 2', or a place such as 'above the box'");
  }

  /** Three coordinates separated by spaces or commas. Use parentheses for arithmetic: `to (x + 1) 0 0`. */
  private parseVector(): ScriptVector {
    const x = this.parseComponent();
    if (this.peek().value === ",") this.advance();
    const y = this.parseComponent();
    if (this.peek().value === ",") this.advance();
    return [x, y, this.parseComponent()];
  }

  private parseComponent(): ScriptExpression {
    if (this.peek().value === ",") this.advance();
    if (this.atLineEnd() || this.atDuration()) this.failAt(this.peek(), "Expected three numbers here: x y z (for example 'to 0 2 0')");
    if (this.peek().value === "(") {
      this.advance();
      const inner = this.parseExpression();
      this.expectValue(")", "Expected ')' to close the coordinate");
      return inner;
    }
    return this.parseUnary();
  }

  private parseDuration(): ScriptExpression | undefined {
    if (!this.atDuration()) return undefined;
    this.advance();
    const amount = this.parseComponent();
    if (this.peek().kind === "identifier" && secondWords.has(this.peek().value)) this.advance();
    return amount;
  }

  private directionVector(direction: Direction, amount: ScriptExpression, at: Token): ScriptVector {
    const unit = DIRECTIONS[direction];
    return unit.map((sign) => sign === 0 ? this.zero(at)
      : sign > 0 ? amount
      : { kind: "unary", operator: "-", argument: amount, line: at.line, column: at.column }) as ScriptVector;
  }

  private zero(at: Token): ScriptExpression { return { kind: "number", value: 0, line: at.line, column: at.column }; }
  private atDuration(): boolean { return this.peek().kind === "identifier" && durationWords.has(this.peek().value) && !(this.word("in") && this.peek(1).value === "front"); }
  private atLineEnd(): boolean { return this.at("newline") || this.at("dedent") || this.at("eof"); }
  private startsValue(): boolean {
    const token = this.peek();
    if (token.kind === "number" || token.value === "(" || (token.kind === "operator" && token.value === "-")) return true;
    return token.kind === "identifier" && !durationWords.has(token.value) && token.value !== "degrees" && token.value !== "deg";
  }

  private parseExpression(minPrecedence = 0): ScriptExpression {
    let left = this.parseUnary();
    const precedence: Record<string, number> = { or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
    while (true) {
      const token = this.peek();
      const op = token.kind === "identifier" && (token.value === "and" || token.value === "or") ? token.value : token.kind === "operator" ? token.value : "";
      const rank = precedence[op];
      if (rank === undefined || rank < minPrecedence) break;
      this.advance();
      const right = this.parseExpression(rank + 1);
      left = { kind: "binary", operator: op, left, right, line: token.line, column: token.column };
    }
    return left;
  }

  private parseUnary(): ScriptExpression {
    const token = this.peek();
    if ((token.kind === "operator" && (token.value === "+" || token.value === "-")) || this.word("not")) {
      this.advance();
      const operator = token.value;
      return { kind: "unary", operator, argument: this.parseUnary(), line: token.line, column: token.column };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ScriptExpression {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.peek().value === ".") {
        const dot = this.advance();
        const property = this.expectIdentifier("Expected a property name after '.'");
        expr = { kind: "member", object: expr, property: property.value, line: dot.line, column: dot.column };
      } else if (this.peek().value === "(") {
        const open = this.advance();
        const args: ScriptExpression[] = [];
        if (this.peek().value !== ")") {
          do {
            args.push(this.parseExpression());
            if (this.peek().value !== ",") break;
            this.advance();
          } while (true);
        }
        this.expectValue(")", "Expected ')' after function arguments");
        expr = { kind: "call", callee: expr, args, line: open.line, column: open.column };
      } else break;
    }
    return expr;
  }

  private parsePrimary(): ScriptExpression {
    if (this.word("the")) {
      const start = this.peek();
      return { kind: "describe", description: this.parseDescription(), line: start.line, column: start.column };
    }
    const token = this.advance();
    if (token.kind === "number") return { kind: "number", value: Number(token.value), line: token.line, column: token.column };
    if (token.kind === "string") return { kind: "string", value: token.value, line: token.line, column: token.column };
    if (token.kind === "color") return { kind: "color", value: token.value, line: token.line, column: token.column };
    if (token.kind === "identifier") {
      if (token.value === "true" || token.value === "false") return { kind: "boolean", value: token.value === "true", line: token.line, column: token.column };
      if (["param", "let", "on", "every", "if", "else", "while", "and", "or", "not"].includes(token.value)) this.failAt(token, `Unexpected keyword '${token.value}' in expression`);
      return { kind: "identifier", name: token.value, line: token.line, column: token.column };
    }
    this.failAt(token, "Expected a value");
  }

  private requireLineEnd(): void {
    if (!this.at("newline") && !this.at("dedent") && !this.at("eof")) this.failAt(this.peek(), "Unexpected text after statement");
    if (this.at("newline")) this.advance();
  }
  private skipNewlines(): void { while (this.at("newline")) this.advance(); }
  private expectWord(value: string): Token {
    if (!this.word(value)) this.failAt(this.peek(), `Expected '${value}'`);
    return this.advance();
  }
  private expectIdentifier(message: string): Token { return this.expectKind("identifier", message); }
  private expectKind(kind: Token["kind"], message: string): Token {
    if (!this.at(kind)) this.failAt(this.peek(), message);
    return this.advance();
  }
  private expectValue(value: string, message: string): Token {
    if (this.peek().value !== value) this.failAt(this.peek(), message);
    return this.advance();
  }
  private word(value: string): boolean { return this.peek().kind === "identifier" && this.peek().value === value; }
  private at(kind: Token["kind"]): boolean { return this.peek().kind === kind; }
  private peek(offset = 0): Token { return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!; }
  private previous(): Token { return this.tokens[Math.max(0, this.index - 1)]!; }
  private advance(): Token { const token = this.peek(); if (token.kind !== "eof") this.index += 1; return token; }
  private failAt(token: Token, message: string): never { throw new ScriptError(message, token.line, token.column); }
}

export function parseScript(source: string): ScriptProgram {
  return new Parser(lexScript(source)).parse();
}
