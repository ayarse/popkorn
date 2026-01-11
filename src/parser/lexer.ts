// Token types for the CSS-like DSL

export type TokenType =
  | 'IDENT'
  | 'HASH'        // #id
  | 'DOT'         // .class
  | 'COLON'       // :
  | 'SEMICOLON'   // ;
  | 'LBRACE'      // {
  | 'RBRACE'      // }
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'COMMA'       // ,
  | 'GT'          // > (child combinator)
  | 'NUMBER'
  | 'DIMENSION'   // 100px, 45deg
  | 'PERCENTAGE'  // 50%
  | 'STRING'      // "..."
  | 'COLOR'       // #ffffff
  | 'AT_KEYWORD'  // @keyframes
  | 'WHITESPACE'
  | 'COMMENT'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.input.length) {
      const token = this.nextToken();
      if (token.type !== 'WHITESPACE' && token.type !== 'COMMENT') {
        tokens.push(token);
      }
    }

    tokens.push({ type: 'EOF', value: '', line: this.line, column: this.column });
    return tokens;
  }

  private nextToken(): Token {
    const startLine = this.line;
    const startColumn = this.column;

    // Whitespace
    if (this.isWhitespace(this.current())) {
      return this.readWhitespace(startLine, startColumn);
    }

    // Comments
    if (this.current() === '/' && this.peek() === '*') {
      return this.readComment(startLine, startColumn);
    }

    // At-keywords (@keyframes)
    if (this.current() === '@') {
      return this.readAtKeyword(startLine, startColumn);
    }

    // Hash (ID selector or color)
    if (this.current() === '#') {
      return this.readHash(startLine, startColumn);
    }

    // String
    if (this.current() === '"' || this.current() === "'") {
      return this.readString(startLine, startColumn);
    }

    // Number, dimension, percentage
    if (this.isDigit(this.current()) || (this.current() === '-' && this.isDigit(this.peek())) || (this.current() === '.' && this.isDigit(this.peek()))) {
      return this.readNumber(startLine, startColumn);
    }

    // Identifier
    if (this.isIdentStart(this.current()) || this.current() === '-') {
      return this.readIdent(startLine, startColumn);
    }

    // Single character tokens
    const char = this.current();
    this.advance();

    switch (char) {
      case '.':
        return { type: 'DOT', value: '.', line: startLine, column: startColumn };
      case ':':
        return { type: 'COLON', value: ':', line: startLine, column: startColumn };
      case ';':
        return { type: 'SEMICOLON', value: ';', line: startLine, column: startColumn };
      case '{':
        return { type: 'LBRACE', value: '{', line: startLine, column: startColumn };
      case '}':
        return { type: 'RBRACE', value: '}', line: startLine, column: startColumn };
      case '(':
        return { type: 'LPAREN', value: '(', line: startLine, column: startColumn };
      case ')':
        return { type: 'RPAREN', value: ')', line: startLine, column: startColumn };
      case ',':
        return { type: 'COMMA', value: ',', line: startLine, column: startColumn };
      case '>':
        return { type: 'GT', value: '>', line: startLine, column: startColumn };
      default:
        throw new Error(`Unexpected character '${char}' at line ${startLine}, column ${startColumn}`);
    }
  }

  private readWhitespace(startLine: number, startColumn: number): Token {
    let value = '';
    while (this.pos < this.input.length && this.isWhitespace(this.current())) {
      value += this.current();
      this.advance();
    }
    return { type: 'WHITESPACE', value, line: startLine, column: startColumn };
  }

  private readComment(startLine: number, startColumn: number): Token {
    let value = '';
    this.advance(); // /
    this.advance(); // *
    while (this.pos < this.input.length) {
      if (this.current() === '*' && this.peek() === '/') {
        this.advance(); // *
        this.advance(); // /
        break;
      }
      value += this.current();
      this.advance();
    }
    return { type: 'COMMENT', value, line: startLine, column: startColumn };
  }

  private readAtKeyword(startLine: number, startColumn: number): Token {
    this.advance(); // @
    let value = '@';
    while (this.pos < this.input.length && this.isIdentChar(this.current())) {
      value += this.current();
      this.advance();
    }
    return { type: 'AT_KEYWORD', value, line: startLine, column: startColumn };
  }

  private readHash(startLine: number, startColumn: number): Token {
    this.advance(); // #
    let value = '';
    while (this.pos < this.input.length && (this.isIdentChar(this.current()) || this.isDigit(this.current()))) {
      value += this.current();
      this.advance();
    }

    // Determine if it's a color or ID
    if (/^[0-9a-fA-F]{3,8}$/.test(value)) {
      return { type: 'COLOR', value: '#' + value, line: startLine, column: startColumn };
    }
    return { type: 'HASH', value, line: startLine, column: startColumn };
  }

  private readString(startLine: number, startColumn: number): Token {
    const quote = this.current();
    this.advance();
    let value = '';
    while (this.pos < this.input.length && this.current() !== quote) {
      if (this.current() === '\\') {
        this.advance();
        if (this.pos < this.input.length) {
          value += this.current();
          this.advance();
        }
      } else {
        value += this.current();
        this.advance();
      }
    }
    this.advance(); // closing quote
    return { type: 'STRING', value, line: startLine, column: startColumn };
  }

  private readNumber(startLine: number, startColumn: number): Token {
    let value = '';

    // Optional negative sign
    if (this.current() === '-') {
      value += this.current();
      this.advance();
    }

    // Integer part
    while (this.pos < this.input.length && this.isDigit(this.current())) {
      value += this.current();
      this.advance();
    }

    // Decimal part
    if (this.current() === '.' && this.isDigit(this.peek())) {
      value += this.current();
      this.advance();
      while (this.pos < this.input.length && this.isDigit(this.current())) {
        value += this.current();
        this.advance();
      }
    }

    // Check for unit (px, deg, em, rem, etc.) or percentage
    if (this.current() === '%') {
      value += this.current();
      this.advance();
      return { type: 'PERCENTAGE', value, line: startLine, column: startColumn };
    }

    if (this.isLetter(this.current())) {
      let unit = '';
      while (this.pos < this.input.length && this.isLetter(this.current())) {
        unit += this.current();
        this.advance();
      }
      return { type: 'DIMENSION', value: value + unit, line: startLine, column: startColumn };
    }

    return { type: 'NUMBER', value, line: startLine, column: startColumn };
  }

  private readIdent(startLine: number, startColumn: number): Token {
    let value = '';

    // Handle leading hyphen(s) for custom properties or vendor prefixes
    while (this.current() === '-') {
      value += this.current();
      this.advance();
    }

    while (this.pos < this.input.length && this.isIdentChar(this.current())) {
      value += this.current();
      this.advance();
    }
    return { type: 'IDENT', value, line: startLine, column: startColumn };
  }

  private current(): string {
    return this.input[this.pos] || '';
  }

  private peek(): string {
    return this.input[this.pos + 1] || '';
  }

  private advance(): void {
    if (this.current() === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    this.pos++;
  }

  private isWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isLetter(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
  }

  private isIdentStart(char: string): boolean {
    return this.isLetter(char) || char === '_';
  }

  private isIdentChar(char: string): boolean {
    return this.isIdentStart(char) || this.isDigit(char) || char === '-';
  }
}
