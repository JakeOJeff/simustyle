import type { EntityDescription, MoveDestination, ScriptCommand, ScriptExpression, ScriptHandler, ScriptParam, ScriptProgram, ScriptStatement, ScriptTarget, ScriptTypeName, ScriptVector } from "./ast.js";
import { lexScript, ScriptError } from "./lexer.js";
import type { Token } from "./lexer.js";
import { ANIMATION_MODIFIERS, ANIMATION_VERBS, COLOR_NAMES, COMMAND_WORDS, DIRECTION_ALIASES, DIRECTIONS, FILLER_WORDS, KEY_WORDS, SENTENCE_WORDS, SHAPE_NOUNS, SUPERLATIVES, type Direction, type RelationName } from "./vocabulary.js";

const types = new Set<ScriptTypeName>(["float", "int", "bool", "color", "string"]);
const commandWords = new Set<string>([...COMMAND_WORDS, ...SENTENCE_WORDS]);
const durationWords = new Set(["over", "in", "for"]);
const secondWords = new Set(["s", "sec", "secs", "second", "seconds"]);
const unitWords = new Set(["m", "meter", "meters", "metre", "metres", "unit", "units", "step", "steps"]);
const selfWords = new Set(["self", "me", "myself", "I"]);
const propertyWords = new Set(["x", "y", "z", "color", "colour", "size", "name"]);
const meshShapes = new Set(["sphere", "box", "cylinder", "cone", "capsule", "plane"]);
const reserved = new Set(["param", "setting", "let", "on", "every", "when", "forever", "if", "else", "otherwise", "while", "repeat", "and", "or", "not"]);

type Comparison = { operator: string; length: number };

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
      else if (this.word("setting")) this.parseSetting();
      else if (this.atHandler()) this.handlers.push(this.parseHandler());
      else this.statements.push(this.parseStatement());
      this.skipNewlines();
    }
    return { params: this.params, statements: this.statements, handlers: this.handlers };
  }

  // --- Settings ---------------------------------------------------------------------

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
    this.params.push({ name: name.value, type, ...(min === undefined ? {} : { min, max }), defaultValue: value.value, line: start.line, column: start.column });
    this.requireLineEnd();
  }

  /** setting speed = 3 from 0 to 10 · setting tint = red · setting message = "hi" */
  private parseSetting(): void {
    const start = this.expectWord("setting");
    const name = this.expectIdentifier("Name the setting, for example 'setting speed = 3'");
    if (this.peek().value === "=" || this.word("to") || this.word("is")) this.advance();
    else this.failAt(this.peek(), `Expected '=' after the setting name, for example 'setting ${name.value} = 3'`);
    const literal = this.parseLiteral("Settings start with a value such as 3, true, red, or \"text\"");
    let min: number | undefined;
    let max: number | undefined;
    if (this.word("from") || this.word("between")) {
      this.advance();
      min = this.numberLiteral("Expected the lowest value");
      if (!this.word("to") && !this.word("and")) this.failAt(this.peek(), "Expected 'to' between the lowest and highest value");
      this.advance();
      max = this.numberLiteral("Expected the highest value");
      if (min > max) this.failAt(start, "The lowest value must not be above the highest value");
      if (typeof literal.value !== "number") this.failAt(start, "Only number settings can have a range");
    }
    const type: ScriptTypeName = typeof literal.value === "number" ? "float" : typeof literal.value === "boolean" ? "bool" : literal.kind === "color" ? "color" : "string";
    this.params.push({ name: name.value, type, ...(min === undefined ? {} : { min, max }), defaultValue: literal.value, line: start.line, column: start.column });
    this.requireLineEnd();
  }

  private parseLiteral(message: string): { kind: string; value: number | boolean | string } {
    const token = this.peek();
    if (token.kind === "operator" && token.value === "-" && this.peek(1).kind === "number") { this.advance(); return { kind: "number", value: -Number(this.advance().value) }; }
    if (token.kind === "number") return { kind: "number", value: Number(this.advance().value) };
    if (token.kind === "string") return { kind: "string", value: this.advance().value };
    if (token.kind === "color") return { kind: "color", value: this.advance().value };
    const lower = token.value.toLowerCase();
    if (token.kind === "identifier" && COLOR_NAMES[lower]) { this.advance(); return { kind: "color", value: COLOR_NAMES[lower]! }; }
    if (token.kind === "identifier" && ["true", "yes", "on"].includes(lower)) { this.advance(); return { kind: "boolean", value: true }; }
    if (token.kind === "identifier" && ["false", "no", "off"].includes(lower)) { this.advance(); return { kind: "boolean", value: false }; }
    this.failAt(token, message);
  }

  private numberLiteral(message: string): number {
    const literal = this.parseLiteral(message);
    if (typeof literal.value !== "number") this.failAt(this.previous(), message);
    return literal.value;
  }

  // --- Event headers ----------------------------------------------------------------

  private atHandler(): boolean {
    if (this.word("when") || this.word("every") || this.word("forever")) return true;
    return this.word("on") && ["start", "collide"].includes(this.peek(1).value);
  }

  private parseHandler(): ScriptHandler {
    const start = this.peek();
    const header = this.word("when") ? this.parseWhen() : this.word("forever") ? (this.advance(), { event: "frame" as const }) : this.word("every") ? this.parseEvery() : this.parseOn();
    const body = this.parseBlock(start);
    return { ...header, body, line: start.line };
  }

  private parseOn(): Omit<ScriptHandler, "body" | "line"> {
    this.expectWord("on");
    const kind = this.advance();
    if (kind.value === "start") return { event: "start" };
    this.expectValue("(", "Expected '(' after 'collide'");
    const parameter = this.expectIdentifier("Expected collision parameter name").value;
    this.expectValue(")", "Expected ')' after collision parameter");
    return { event: "collide", parameter };
  }

  /** every frame · every 2 seconds · every 0.5s · every second */
  private parseEvery(): Omit<ScriptHandler, "body" | "line"> {
    this.expectWord("every");
    if (this.word("frame") || this.word("tick")) { this.advance(); return { event: "frame" }; }
    if (this.word("second")) { this.advance(); return { event: "interval", intervalSeconds: 1 }; }
    const amount = this.expectKind("number", "Expected 'frame' or a time, for example 'every 2 seconds'");
    const intervalSeconds = Number(amount.value);
    if (!(this.peek().kind === "identifier" && secondWords.has(this.peek().value))) this.failAt(this.peek(), `Expected 'seconds' after the number, for example 'every ${amount.value} seconds'`);
    this.advance();
    if (intervalSeconds <= 0) this.failAt(amount, "Interval must be greater than zero");
    return { event: "interval", intervalSeconds };
  }

  /**
   * "when ..." headers are matched by their key word so several phrasings work:
   * when game starts · when clicked · when I'm clicked · when space is pressed ·
   * when I press left · when I touch the floor · when I receive "win"
   */
  private parseWhen(): Omit<ScriptHandler, "body" | "line"> {
    const when = this.expectWord("when");
    const first = this.index;
    let end = first;
    while (!["newline", "eof", "dedent"].includes(this.tokens[end]!.kind) && this.tokens[end]!.value !== ":") end += 1;
    const words = this.tokens.slice(first, end);
    const lower = words.map((token) => token.kind === "identifier" ? token.value.toLowerCase() : "");
    const has = (...candidates: string[]) => lower.findIndex((word) => candidates.includes(word));
    const finish = <T,>(value: T): T => { this.index = end; return value; };

    if (has("clicked", "tapped", "click", "tap") >= 0) return finish({ event: "click" });
    const message = words.find((token) => token.kind === "string");
    if (message && has("receive", "receives", "hear", "hears", "get", "gets") >= 0) return finish({ event: "message", message: message.value });
    const press = has("pressed", "press", "presses", "held");
    if (press >= 0) {
      const key = this.keyInHeader(words.map((token) => token.value.toLowerCase()));
      if (!key) this.failAt(words[press]!, "Say which key, for example 'when space is pressed' or 'when I press left'");
      return finish({ event: "key", key });
    }
    const touch = has("touch", "touches", "touching", "touched", "bump", "bumps", "hit", "hits", "collide", "collides");
    if (touch >= 0) {
      this.index = first + touch + 1;
      while (this.word("into") || this.word("with") || this.word("against") || this.word("by")) this.advance();
      const isAnything = this.word("anything") || this.word("something") || this.word("anyone");
      if (isAnything) this.advance();
      const filter = isAnything || this.atBlockStart() ? undefined : this.parseTarget();
      return { event: "collide", parameter: "it", ...(filter ? { filter } : {}) };
    }
    if (has("starts", "start", "started", "begins", "begin", "runs", "loads", "plays") >= 0) return finish({ event: "start" });
    this.failAt(words[0] ?? when, "I don't know that event. Try: when game starts · when clicked · when space is pressed · when I touch the floor · when I receive \"go\"");
  }

  /** "press space", "press the left key", "space is pressed", "the a key is pressed", "key up is pressed". */
  private keyInHeader(words: string[]): string | undefined {
    const pick = (index: number) => {
      const word = words[index] === "the" ? words[index + 1] : words[index];
      return word && KEY_WORDS.has(word) ? word : undefined;
    };
    const press = words.findIndex((word) => word === "press" || word === "presses");
    if (press >= 0) return pick(press + 1) ?? (words[press + 1] === "key" ? pick(press + 2) : undefined);
    const key = words.indexOf("key");
    if (key >= 0) return pick(key + 1) ?? (key > 0 ? pick(key - 1) : undefined);
    const is = words.indexOf("is");
    return is > 0 ? pick(is - 1) : undefined;
  }

  private atBlockStart(): boolean { return this.peek().value === ":" || this.atLineEnd(); }

  /** Optional ':' then an indented block of statements. */
  private parseBlock(header: Token): ScriptStatement[] {
    if (this.peek().value === ":") this.advance();
    this.requireLineEnd();
    this.skipNewlines();
    if (!this.at("indent")) this.failAt(this.peek(), "Indent the lines that belong to this block (press Tab)");
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

  // --- Statements -------------------------------------------------------------------

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
    if (this.word("if")) return this.parseIf();
    if (this.atHandler() && !this.word("forever")) this.failAt(start, "Lines like 'when ...' and 'every ...' start a new event, so they must not be indented");
    if (this.word("while")) {
      this.advance();
      const condition = this.parseExpression();
      return { kind: "while", condition, body: this.parseBlock(start), line: start.line };
    }
    if (this.word("forever") && this.isCommandStart()) {
      this.advance();
      return { kind: "while", condition: this.literalTrue(start), body: this.parseBlock(start), line: start.line };
    }
    if (this.skipPoliteMakePrefix()) return this.parseCommand();
    if (this.isCommandStart() || this.isAnimationVerb()) return this.parseCommand();

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

  /** Accept a short conversational lead-in when the request ends at `make`. */
  private skipPoliteMakePrefix(): boolean {
    if (!(["can", "could", "would"].includes(this.peek().value) && this.peek().kind === "identifier")) return false;
    let offset = 1;
    if (["you", "u"].includes(this.peek(offset).value.toLowerCase())) offset += 1;
    while (["please", "just", "like"].includes(this.peek(offset).value.toLowerCase())) offset += 1;
    if (this.peek(offset).value !== "make" || this.peek(offset).kind !== "identifier") return false;
    this.index += offset;
    return true;
  }

  private parseIf(): ScriptStatement {
    const start = this.expectWord("if");
    const branches: { condition: ScriptExpression; body: ScriptStatement[] }[] = [];
    branches.push({ condition: this.parseCondition(), body: this.parseBlock(start) });
    this.skipNewlines();
    while ((this.word("else") || this.word("otherwise")) && this.peek(1).value === "if") {
      const branchStart = this.advance();
      this.advance();
      branches.push({ condition: this.parseCondition(), body: this.parseBlock(branchStart) });
      this.skipNewlines();
    }
    let otherwise: ScriptStatement[] = [];
    if (this.word("else") || this.word("otherwise")) otherwise = this.parseBlock(this.advance());
    return { kind: "if", branches, otherwise, line: start.line };
  }

  private parseCondition(): ScriptExpression {
    const condition = this.parseExpression();
    if (this.word("then")) this.advance();
    return condition;
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

  private isAnimationVerb(): boolean {
    const token = this.peek();
    if (token.kind !== "identifier" || !ANIMATION_VERBS.has(token.value)) return false;
    const next = this.peek(1);
    return !(next.kind === "operator" || next.value === "." || next.value === "(");
  }

  private parseCommand(): ScriptStatement {
    const start = this.advance();
    const name = start.value;
    const self = (): ScriptTarget => ({ kind: "self", line: start.line, column: start.column });
    const finish = (statement: ScriptStatement): ScriptStatement => { this.requireLineEnd(); return statement; };
    const command = (value: ScriptCommand) => finish({ kind: "command", command: value, line: start.line, column: start.column });

    switch (name) {
      case "set": return finish(this.parseSet(start));
      case "change": case "increase": case "decrease": return finish(this.parseChange(start));
      // "add a box" creates an object; "add 10 to score" still adds to a variable.
      case "add": if (this.atCreatable()) return command(this.parseCreate(start)); return finish(this.parseAdd(start));
      case "subtract": return finish(this.parseAdd(start));
      case "wait": {
        if (this.atLineEnd()) this.failAt(this.peek(), "Say how long to wait, for example 'wait 1 second'");
        const seconds = this.parseExpression();
        if (this.peek().kind === "identifier" && secondWords.has(this.peek().value)) this.advance();
        return finish({ kind: "wait", seconds, line: start.line });
      }
      case "repeat": {
        if (this.word("forever")) { this.advance(); return { kind: "while", condition: this.literalTrue(start), body: this.parseBlock(start), line: start.line }; }
        if (this.word("until")) {
          this.advance();
          const condition = this.parseExpression();
          return { kind: "while", condition: { kind: "unary", operator: "not", argument: condition, line: start.line, column: start.column }, body: this.parseBlock(start), line: start.line };
        }
        const count = this.parseExpression();
        if (this.word("times") || this.word("time")) this.advance();
        return { kind: "repeat", count, body: this.parseBlock(start), line: start.line };
      }
      case "broadcast": case "announce": case "send": case "tell": {
        if (name === "tell" && (this.word("everyone") || this.word("everybody") || this.word("all"))) this.advance();
        const message = this.parseExpression();
        if (this.word("to") && ["everyone", "everybody", "all"].includes(this.peek(1).value)) { this.advance(); this.advance(); }
        return finish({ kind: "broadcast", message, line: start.line });
      }
      case "create": case "spawn": return command(this.parseCreate(start));
      case "make": {
        const target = this.parseTarget();
        if (this.word("be") || this.word("to")) this.advance();
        if (!this.atColor()) this.failAt(this.peek(), "Name a color, for example 'make the box red'");
        return command({ name: "paint", target, color: this.parseColor() });
      }
      case "say": case "print": {
        const args: ScriptExpression[] = [];
        while (!this.atLineEnd()) {
          args.push(this.parseExpression());
          if (this.peek().value === ",") this.advance();
        }
        return command({ name: "say", args });
      }
    }

    // "grow"/"shrink" resize with 'by'/'to' ("grow the box by 2") and animate otherwise ("grow slowly").
    if (name === "grow" || name === "shrink") {
      if (this.word("by") || this.word("to")) return this.parseResize(start, self());
      if (!this.atLineEnd() && !this.atAnimationModifier()) {
        const save = this.index;
        const target = this.parseTarget();
        if (this.word("by") || this.word("to")) return this.parseResize(start, target);
        this.index = save;
      }
    }
    if (ANIMATION_VERBS.has(name) || name === "grow" || name === "shrink") {
      const target = this.atLineEnd() || this.atAnimationModifier() ? self() : this.parseTarget();
      const words = [name, ...this.restWords()];
      return command({ name: "animate", target, words, wordsLine: start.line, wordsColumn: start.column });
    }

    switch (name) {
      case "move": case "glide": case "go": {
        let target = name === "go" || this.atDestination() ? self() : this.parseTarget();
        let destination: MoveDestination;
        // "move the ball above the box": the description grabbed "above the box", but it is the destination.
        if (target.kind === "describe" && target.description.relation && (this.atLineEnd() || this.atDuration())) {
          const { relation, ...rest } = target.description;
          destination = { kind: "relative", relation: relation.relation, target: relation.target };
          target = { ...target, description: rest };
        } else destination = this.parseDestination();
        const duration = this.parseDuration() ?? (name === "glide" ? { kind: "number" as const, value: 1, line: start.line, column: start.column } : undefined);
        return command({ name: "move", target, destination, ...(duration ? { duration } : {}) });
      }
      case "destroy": case "delete": case "remove": case "hide": case "show":
        return command({ name: name === "delete" || name === "remove" ? "destroy" : name, target: this.atLineEnd() ? self() : this.parseTarget() });
      case "animate": {
        const target = this.word("as") || this.word("like") ? self() : this.parseTarget();
        if (this.word("as") || this.word("like")) this.advance();
        const first = this.peek();
        const words = this.restWords();
        if (!words.length) this.failAt(first, "Describe the animation, for example 'animate like a bouncing ball'");
        return command({ name: "animate", target, words, wordsLine: first.line, wordsColumn: first.column });
      }
      case "stop": {
        if (this.word("animating") || this.word("moving") || this.word("spinning")) this.advance();
        return command({ name: "stop", target: this.atLineEnd() ? self() : this.parseTarget() });
      }
      case "turn": case "rotate": {
        const turnStarts = () => this.word("left") || this.word("right") || this.word("around") || this.word("by") || this.word("to") || this.startsNumber();
        const target = turnStarts() ? self() : this.parseTarget();
        // "rotate box1 to 0 90 0" sets the rotation; "rotate box1 (by) 90" adds to it.
        const mode = this.word("to") ? "to" : "by";
        if (this.word("by") || this.word("to")) this.advance();
        let amount: ScriptVector;
        if (mode === "to") {
          const first = this.parseUnary();
          amount = this.startsValue() ? [first, this.parseComponent(), this.parseComponent()] : [this.zero(start), first, this.zero(start)];
        } else if (this.word("around")) {
          const word = this.advance();
          amount = [this.zero(word), { kind: "number", value: 180, line: word.line, column: word.column }, this.zero(word)];
        } else if (this.word("left") || this.word("right")) {
          const side = this.advance();
          const degrees: ScriptExpression = this.atLineEnd() || this.atDuration() ? { kind: "number", value: 90, line: side.line, column: side.column } : this.parseUnary();
          amount = [this.zero(side), side.value === "left" ? degrees : { kind: "unary", operator: "-", argument: degrees, line: side.line, column: side.column }, this.zero(side)];
        } else {
          const first = this.parseUnary();
          amount = this.startsValue() ? [first, this.parseComponent(), this.parseComponent()] : [this.zero(start), first, this.zero(start)];
        }
        if (this.word("degrees") || this.word("degree") || this.word("deg")) this.advance();
        const duration = this.parseDuration();
        return command({ name: "turn", target, mode, amount, ...(duration ? { duration } : {}) });
      }
      case "scale": case "resize":
        return this.parseResize(start, this.word("to") || this.word("by") ? self() : this.parseTarget());
      case "paint": case "color": case "colour": {
        let target = this.atColor() || this.word("to") || this.word("with") ? self() : this.parseTarget();
        if (this.word("to") || this.word("with")) this.advance();
        let color: ScriptExpression;
        // "paint tint" (a color variable) reads like "paint <object>": treat a lone name as the color.
        if (this.atLineEnd() && target.kind === "name" && !target.quoted) {
          color = { kind: "identifier", name: target.name, line: target.line, column: target.column };
          target = self();
        } else color = this.parseColor();
        return command({ name: "paint", target, color });
      }
      case "push": {
        const target = this.word("by") || this.word("with") || this.atDirection() ? self() : this.parseTarget();
        if (this.atDirection()) {
          const word = this.advance();
          const amount: ScriptExpression = this.atLineEnd() ? { kind: "number", value: 5, line: word.line, column: word.column } : this.parseUnary();
          this.skipUnits();
          return command({ name: "push", target, vector: this.directionVector(DIRECTION_ALIASES[word.value]!, amount, word) });
        }
        if (this.word("by") || this.word("with")) this.advance();
        return command({ name: "push", target, vector: this.parseVector() });
      }
    }
    this.failAt(start, `Unknown command '${name}'`);
  }

  /** scale by 2 · scale the box to 0.5 over 1s · grow by 3 · shrink by 2 (half size) */
  private parseResize(start: Token, target: ScriptTarget): ScriptStatement {
    const name = start.value;
    if (!this.word("to") && !this.word("by")) this.failAt(this.peek(), `Expected 'to' or 'by', for example '${name} by 2'`);
    const mode = this.advance().value as "to" | "by";
    let amount = this.parseUnary();
    if (this.word("times") || this.word("x")) this.advance();
    if (name === "shrink" && mode === "by") amount = { kind: "binary", operator: "/", left: { kind: "number", value: 1, line: start.line, column: start.column }, right: amount, line: start.line, column: start.column };
    const duration = this.parseDuration();
    this.requireLineEnd();
    return { kind: "command", command: { name: "scale", target, mode, amount, ...(duration ? { duration } : {}) }, line: start.line, column: start.column };
  }

  /** set score to 0 · set my color to red · set y of the ball to 3 */
  private parseSet(start: Token): ScriptStatement {
    const target = this.parseAssignable("Say what to set, for example 'set score to 0'");
    if (!this.word("to") && this.peek().value !== "=") this.failAt(this.peek(), "Expected 'to', for example 'set score to 0'");
    this.advance();
    const value = target.kind === "property" && (target.property === "color" || target.property === "colour") ? this.parseColor() : this.parseExpression();
    return { kind: "assign", target, operator: "=", value, line: start.line };
  }

  /** change score by 1 · increase speed by 2 · decrease lives (by 1) */
  private parseChange(start: Token): ScriptStatement {
    const target = this.parseAssignable(`Say what to ${start.value}, for example '${start.value} score by 1'`);
    let value: ScriptExpression = { kind: "number", value: 1, line: start.line, column: start.column };
    if (this.word("by")) { this.advance(); value = this.parseExpression(); }
    else if (start.value === "change" || !this.atLineEnd()) this.failAt(this.peek(), `Expected 'by', for example '${start.value} score by 1'`);
    return { kind: "assign", target, operator: start.value === "decrease" ? "-=" : "+=", value, line: start.line };
  }

  /** add 10 to score · subtract 1 from lives */
  private parseAdd(start: Token): ScriptStatement {
    const value = this.parseExpression();
    const joiner = start.value === "add" ? "to" : "from";
    if (!this.word(joiner)) this.failAt(this.peek(), `Expected '${joiner}', for example '${start.value} 1 ${joiner} score'`);
    this.advance();
    const target = this.parseAssignable(`Say what to ${start.value} ${joiner}`);
    return { kind: "assign", target, operator: start.value === "add" ? "+=" : "-=", value, line: start.line };
  }

  private parseAssignable(message: string): ScriptExpression {
    const token = this.peek();
    if (this.word("my") && propertyWords.has(this.peek(1).value)) {
      this.advance();
      const property = this.advance().value;
      return { kind: "property", target: { kind: "self", line: token.line, column: token.column }, property, line: token.line, column: token.column };
    }
    if (propertyWords.has(token.value) && this.peek(1).value === "of") {
      this.advance(); this.advance();
      return { kind: "property", target: this.parseTarget(), property: token.value, line: token.line, column: token.column };
    }
    if (token.kind !== "identifier" || reserved.has(token.value)) this.failAt(token, message);
    return this.parsePostfix();
  }

  /** The mesh shape a noun names ("balls" → sphere), or undefined. */
  private meshShape(token: Token): string | undefined {
    if (token.kind !== "identifier") return undefined;
    const noun = token.value.toLowerCase();
    const shape = SHAPE_NOUNS[noun] ?? (noun.endsWith("s") ? SHAPE_NOUNS[noun.slice(0, -1)] ?? (noun.endsWith("es") ? SHAPE_NOUNS[noun.slice(0, -2)] : undefined) : undefined);
    return shape && meshShapes.has(shape) ? shape : undefined;
  }

  /** After "add": does a shape follow ("add a box", "add 3 red balls") rather than a value ("add 1 to score")? */
  private atCreatable(): boolean {
    let offset = 0;
    while (["a", "an", "another", "new"].includes(this.peek(offset).value)) offset += 1;
    if (this.peek(offset).kind === "number") offset += 1;
    const token = this.peek(offset);
    if (token.kind === "color" || (token.kind === "identifier" && COLOR_NAMES[token.value.toLowerCase()] && this.meshShape(this.peek(offset + 1)))) return true;
    return this.meshShape(token) !== undefined;
  }

  /**
   * create a red ball at 0 5 0 · spawn a box above me called "Crate" · add 3 boxes named crate
   * add a box named crate if not exists. Clauses after the shape can come in any order.
   */
  private parseCreate(start: Token): ScriptCommand {
    while (this.word("a") || this.word("an") || this.word("another") || this.word("new")) this.advance();
    let count: number | undefined;
    if (this.at("number")) {
      const token = this.advance();
      count = Number(token.value);
      if (!Number.isInteger(count) || count < 1 || count > 100) this.failAt(token, "Say how many to make as a whole number from 1 to 100");
    }
    let color: ScriptExpression | undefined;
    if (this.atColor()) color = this.parseColor();
    const shapeToken = this.peek();
    const shape = this.meshShape(shapeToken);
    if (!shape) this.failAt(shapeToken, `Say what shape to ${start.value}: ball, box, cylinder, cone, capsule, or plane`);
    this.advance();
    let place: MoveDestination | undefined;
    let called: ScriptExpression | undefined;
    let onlyIfMissing = false;
    while (!this.atLineEnd()) {
      if (this.word("at")) { this.advance(); place = { kind: "point", value: this.parseVector() }; continue; }
      if (this.word("called") || this.word("named")) { this.advance(); called = this.parseName(); continue; }
      if (this.word("colored") || this.word("coloured")) { this.advance(); color = this.parseColor(); continue; }
      if (this.atIfMissing()) { onlyIfMissing = true; continue; }
      const relation = this.parseRelation();
      if (relation) { place = { kind: "relative", relation, target: this.parseTarget() }; continue; }
      this.failAt(this.peek(), "Expected 'at x y z', a place such as 'above me', 'named crate', or 'if not exists'");
    }
    return { name: "create", shape, ...(count ? { count } : {}), ...(color ? { color } : {}), ...(place ? { place } : {}), ...(called ? { called } : {}), ...(onlyIfMissing ? { onlyIfMissing } : {}) };
  }

  /** "named crate", "named big crate", "named "Crate"", or "named (variable)" for a computed name. */
  private parseName(): ScriptExpression {
    const token = this.peek();
    if (token.kind === "string" || token.value === "(") return this.parseExpression();
    const words: string[] = [];
    while ((this.at("identifier") || this.at("number")) && !this.atClauseWord()) words.push(this.advance().value);
    if (!words.length) this.failAt(token, "Say the name, for example 'named crate'");
    return { kind: "string", value: words.join(" "), line: token.line, column: token.column };
  }

  /** Words that end a multi-word name and start the next clause of an add/create line. */
  private atClauseWord(): boolean {
    return ["at", "named", "called", "colored", "coloured", "if", "unless", "above", "below", "under", "beside", "near", "next", "on", "left", "right", "behind", "in", "over", "to"].includes(this.peek().value);
  }

  /** if not exists · if it does not exist · if missing · unless it exists */
  private atIfMissing(): boolean {
    const words = [0, 1, 2, 3, 4].map((offset) => this.peek(offset).value.toLowerCase());
    const phrases = [["if", "not", "exists"], ["if", "not", "exist"], ["if", "missing"], ["unless", "exists"], ["unless", "it", "exists"], ["if", "it", "does", "not", "exist"]];
    const phrase = phrases.find((candidate) => candidate.every((word, index) => words[index] === word));
    if (!phrase) return false;
    for (const _ of phrase) this.advance();
    return true;
  }

  private restWords(): string[] {
    const words: string[] = [];
    while (!this.atLineEnd()) {
      const token = this.advance();
      words.push(...(token.kind === "string" ? token.value.split(/\s+/).filter(Boolean) : [token.value]));
    }
    return words;
  }

  // --- Objects ----------------------------------------------------------------------

  private parseTarget(): ScriptTarget {
    const token = this.peek();
    const at = { line: token.line, column: token.column };
    if (this.word("my") && ["children", "kids", "parent"].includes(this.peek(1).value)) {
      this.advance();
      const relation = this.advance().value === "parent" ? "parent" : "children";
      return { kind: "family", relation, of: { kind: "self", ...at }, ...at };
    }
    if (this.word("the") && ["children", "parent"].includes(this.peek(1).value) && this.peek(2).value === "of") {
      this.advance();
      const relation = this.advance().value as "children" | "parent";
      this.advance();
      return { kind: "family", relation, of: this.parseTarget(), ...at };
    }
    if (this.word("the")) return { kind: "describe", description: this.parseDescription(), ...at };
    // "a coin", "an orb": a description like "the coin".
    if ((this.word("a") || this.word("an")) && this.peek(1).kind === "identifier") {
      this.advance();
      return { kind: "describe", description: this.parseDescription(), ...at };
    }
    if ((this.word("all") || this.word("every") || this.word("each")) && this.peek(1).kind === "identifier") {
      this.advance();
      if (this.word("of")) this.advance();
      return { kind: "describe", description: { ...this.parseDescription(), all: true }, ...at };
    }
    if (token.kind === "identifier" && selfWords.has(token.value)) {
      // `self.transform...` is an expression, not a plain self target.
      if (this.peek(1).value !== ".") { this.advance(); return { kind: "self", ...at }; }
    }
    if (this.word("it") && this.peek(1).value !== ".") { this.advance(); return { kind: "it", ...at }; }
    if (token.kind === "string") { this.advance(); return { kind: "name", name: token.value, quoted: true, ...at }; }
    if (token.kind === "identifier") {
      const next = this.peek(1);
      if (next.value === "." || next.value === "(") return { kind: "expression", expression: this.parsePostfix(), ...at };
      this.advance();
      return { kind: "name", name: token.value, quoted: false, ...at };
    }
    this.failAt(token, "Expected an object: a name, 'me', 'it', or a description such as 'the red ball'");
  }

  /** [the] [nearest|biggest...] [red|blue...] <ball|box|one|name> [above|beside|... <target>] */
  private parseDescription(): EntityDescription {
    const words: string[] = [];
    if (this.word("the")) words.push(this.advance().value);
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
    // "over" starts a duration ("over 2s") unless an object follows.
    if (word === "over" && this.peek(1).kind !== "number" && next !== "(") return take(1, "above");
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

  private atRelation(): boolean {
    const save = this.index;
    const relation = this.parseRelation();
    this.index = save;
    return relation !== null;
  }

  private atDestination(): boolean { return this.word("to") || this.word("by") || this.atDirection() || this.atRelation(); }
  private atDirection(): boolean { return this.peek().kind === "identifier" && DIRECTION_ALIASES[this.peek().value] !== undefined; }
  private atColor(): boolean { return this.at("color") || (this.peek().kind === "identifier" && COLOR_NAMES[this.peek().value.toLowerCase()] !== undefined); }
  private atAnimationModifier(): boolean { return this.peek().kind === "identifier" && ANIMATION_MODIFIERS.has(this.peek().value.toLowerCase()); }

  private parseColor(): ScriptExpression {
    const token = this.peek();
    const named = token.kind === "identifier" ? COLOR_NAMES[token.value.toLowerCase()] : undefined;
    if (named) { this.advance(); return { kind: "color", value: named, line: token.line, column: token.column }; }
    return this.parseExpression();
  }

  private parseDestination(): MoveDestination {
    const relation = this.parseRelation();
    if (relation) return { kind: "relative", relation, target: this.parseTarget() };
    if (this.word("to")) {
      this.advance();
      const after = this.parseRelation();
      if (after) return { kind: "relative", relation: after, target: this.parseTarget() };
      if (!this.startsNumber() && this.peek().kind === "identifier" && !this.atDuration()) return { kind: "relative", relation: "near", target: this.parseTarget() };
      return { kind: "point", value: this.parseVector() };
    }
    if (this.word("by")) { this.advance(); return { kind: "offset", value: this.parseVector() }; }
    // "move box1 at 1 2 3" reads like "add box at 1 2 3".
    if (this.word("at") && this.peek(1).kind !== "identifier") { this.advance(); return { kind: "point", value: this.parseVector() }; }
    if (this.atDirection()) {
      const word = this.advance();
      const amount: ScriptExpression = this.atLineEnd() || this.atDuration() ? { kind: "number", value: 1, line: word.line, column: word.column } : this.parseUnary();
      this.skipUnits();
      return { kind: "direction", direction: DIRECTION_ALIASES[word.value]!, amount };
    }
    this.failAt(this.peek(), "Expected where to move: 'to x y z', 'up 2', or a place such as 'above the box'");
  }

  private skipUnits(): void { if (this.peek().kind === "identifier" && unitWords.has(this.peek().value)) this.advance(); }

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
  private literalTrue(at: Token): ScriptExpression { return { kind: "boolean", value: true, line: at.line, column: at.column }; }
  private atDuration(): boolean { return this.peek().kind === "identifier" && durationWords.has(this.peek().value) && !(this.word("in") && this.peek(1).value === "front"); }
  private atLineEnd(): boolean { return this.at("newline") || this.at("dedent") || this.at("eof"); }
  private startsNumber(): boolean {
    const token = this.peek();
    return token.kind === "number" || token.value === "(" || (token.kind === "operator" && token.value === "-");
  }
  private startsValue(): boolean {
    const token = this.peek();
    if (this.startsNumber()) return true;
    return token.kind === "identifier" && !durationWords.has(token.value) && !["degrees", "degree", "deg"].includes(token.value);
  }

  // --- Expressions ------------------------------------------------------------------

  /** "is", "is not", "is more than", "is at least", "equals"... as comparison operators. */
  private peekComparison(): Comparison | null {
    const words = [0, 1, 2, 3].map((offset) => this.peek(offset).kind === "identifier" ? this.peek(offset).value.toLowerCase() : "");
    if (words[0] === "equals") return { operator: "==", length: 1 };
    if (words[0] === "isn't") return { operator: "!=", length: 1 };
    if (words[0] !== "is") return null;
    const rest = words.slice(1);
    const phrase = (operator: string, ...parts: string[]) => parts.every((part, index) => rest[index] === part) ? { operator, length: parts.length + 1 } : null;
    return phrase(">", "more", "than") ?? phrase(">", "greater", "than") ?? phrase(">", "bigger", "than") ?? phrase(">", "higher", "than") ?? phrase(">", "over")
      ?? phrase("<", "less", "than") ?? phrase("<", "smaller", "than") ?? phrase("<", "lower", "than") ?? phrase("<", "fewer", "than") ?? phrase("<", "under")
      ?? phrase(">=", "at", "least") ?? phrase("<=", "at", "most")
      ?? phrase("!=", "not") ?? phrase("==", "equal", "to") ?? { operator: "==", length: 1 };
  }

  private parseExpression(minPrecedence = 0): ScriptExpression {
    let left = this.parseUnary();
    const precedence: Record<string, number> = { or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
    while (true) {
      const token = this.peek();
      const comparison = this.peekComparison();
      const op = comparison?.operator ?? (token.kind === "identifier" && (token.value === "and" || token.value === "or") ? token.value : token.kind === "operator" ? token.value : "");
      const rank = precedence[op];
      if (rank === undefined || rank < minPrecedence) break;
      for (let index = 0; index < (comparison?.length ?? 1); index += 1) this.advance();
      const right = this.parseExpression(rank + 1);
      left = { kind: "binary", operator: op, left, right, line: token.line, column: token.column };
    }
    return left;
  }

  private parseUnary(): ScriptExpression {
    const token = this.peek();
    if ((token.kind === "operator" && (token.value === "+" || token.value === "-")) || this.word("not")) {
      this.advance();
      return { kind: "unary", operator: token.value, argument: this.parseUnary(), line: token.line, column: token.column };
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
      } else if (this.peek().value === "(" && (expr.kind === "identifier" || expr.kind === "member")) {
        // Only names can be called: in "to 1 (y + 1) 0" the bracket starts the next coordinate.
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
    const start = this.peek();
    const at = { line: start.line, column: start.column };
    if (this.word("the") && !(["children", "parent"].includes(this.peek(1).value) && this.peek(2).value === "of")) {
      return { kind: "describe", description: this.parseDescription(), ...at };
    }
    if (this.word("my") && propertyWords.has(this.peek(1).value)) {
      this.advance();
      return { kind: "property", target: { kind: "self", ...at }, property: this.advance().value, ...at };
    }
    if (propertyWords.has(start.value) && start.kind === "identifier" && this.peek(1).value === "of") {
      this.advance(); this.advance();
      return { kind: "property", target: this.parseTarget(), property: start.value, ...at };
    }
    if (this.word("distance") && (this.peek(1).value === "to" || this.peek(1).value === "from")) {
      this.advance(); this.advance();
      return { kind: "property", target: this.parseTarget(), property: "distance", ...at };
    }
    // random 1 to 10 · a random number from 1 to 10 · random number between 0 and 1
    if ((this.word("a") && this.peek(1).value === "random") || (this.word("random") && this.peek(1).value !== "(")) {
      if (this.word("a")) this.advance();
      this.advance();
      if (this.word("number")) this.advance();
      if (this.word("from") || this.word("between")) this.advance();
      const low = this.parseUnary();
      if (!this.word("to") && !this.word("and")) this.failAt(this.peek(), "Expected 'to', for example 'random 1 to 10'");
      this.advance();
      const high = this.parseUnary();
      return { kind: "call", callee: { kind: "identifier", name: "random", ...at }, args: [low, high], ...at };
    }
    // key space is pressed · key left is down
    if (this.word("key") && (this.peek(1).kind === "identifier" || this.peek(1).kind === "number")) {
      this.advance();
      const key = this.advance().value.toLowerCase();
      if (this.word("is") && ["pressed", "down", "held"].includes(this.peek(1).value)) { this.advance(); this.advance(); }
      return { kind: "keyDown", key, ...at };
    }
    if (this.word("it") && this.peek(1).value !== ".") { this.advance(); return { kind: "it", ...at }; }
    if (this.word("my") && ["children", "kids", "parent"].includes(this.peek(1).value)) this.failAt(start, "Use 'my children' or 'my parent' as the object of a command, for example 'paint my children red'");
    const token = this.advance();
    if (token.kind === "number") return { kind: "number", value: Number(token.value), ...at };
    if (token.kind === "string") return { kind: "string", value: token.value, ...at };
    if (token.kind === "color") return { kind: "color", value: token.value, ...at };
    if (token.kind === "identifier") {
      if (token.value === "true" || token.value === "yes") return { kind: "boolean", value: true, ...at };
      if (token.value === "false" || token.value === "no") return { kind: "boolean", value: false, ...at };
      if (token.value === "I" || token.value === "me") return { kind: "identifier", name: "self", ...at };
      if (reserved.has(token.value)) this.failAt(token, `Unexpected keyword '${token.value}' in expression`);
      return { kind: "identifier", name: token.value, ...at };
    }
    if (token.value === "(") {
      const inner = this.parseExpression();
      this.expectValue(")", "Expected ')'");
      return inner;
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
