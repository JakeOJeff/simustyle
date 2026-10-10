import type { ScriptExpression, ScriptHandler, ScriptParam, ScriptProgram, ScriptStatement, ScriptTypeName } from "./ast.js";
import { lexScript, ScriptError } from "./lexer.js";
import type { Token } from "./lexer.js";

const types = new Set<ScriptTypeName>(["float", "int", "bool", "color", "string"]);

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
