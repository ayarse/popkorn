import { Lexer } from './lexer';
import type { Token, TokenType } from './lexer';
import type {
  StyleSheet,
  Rule,
  Selector,
  Declaration,
  Value,
  KeyframeRule,
  KeyframeBlock,
  CanvasConfig,
  FunctionValue,
  VariableDefinition,
  VariableRefValue,
} from './ast';

/**
 * CSS-like DSL Parser
 * Parses the scene graph DSL into an AST
 */
export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;

  parse(input: string): StyleSheet {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;

    const stylesheet: StyleSheet = {
      type: 'stylesheet',
      rules: [],
      keyframes: [],
      variables: [],
    };

    while (!this.isAtEnd()) {
      if (this.check('AT_KEYWORD')) {
        const atRule = this.parseAtRule();
        if (atRule.type === 'keyframes') {
          stylesheet.keyframes.push(atRule);
        }
      } else {
        const rule = this.parseRule();
        if (rule.selector.type === 'canvas') {
          stylesheet.canvas = this.extractCanvasConfig(rule);
        } else if (rule.selector.type === 'root') {
          // Extract variable definitions from :root
          this.extractVariables(rule, stylesheet.variables);
        } else {
          stylesheet.rules.push(rule);
        }
      }
    }

    return stylesheet;
  }

  private parseAtRule(): KeyframeRule {
    const atKeyword = this.consume('AT_KEYWORD');

    if (atKeyword.value === '@keyframes') {
      return this.parseKeyframes();
    }

    throw new Error(`Unknown at-rule: ${atKeyword.value}`);
  }

  private parseKeyframes(): KeyframeRule {
    const name = this.consume('IDENT').value;
    this.consume('LBRACE');

    const blocks: KeyframeBlock[] = [];

    while (!this.check('RBRACE') && !this.isAtEnd()) {
      blocks.push(this.parseKeyframeBlock());
    }

    this.consume('RBRACE');

    return {
      type: 'keyframes',
      name,
      blocks,
    };
  }

  private parseKeyframeBlock(): KeyframeBlock {
    const selectors: number[] = [];

    // Parse percentage selectors (0%, 50%, 100%, from, to)
    do {
      if (this.check('PERCENTAGE')) {
        const pct = this.consume('PERCENTAGE');
        selectors.push(parseFloat(pct.value));
      } else if (this.check('IDENT')) {
        const ident = this.consume('IDENT');
        if (ident.value === 'from') {
          selectors.push(0);
        } else if (ident.value === 'to') {
          selectors.push(100);
        } else {
          throw new Error(`Unexpected keyframe selector: ${ident.value}`);
        }
      } else if (this.check('NUMBER')) {
        // Handle case like "0" without %
        const num = this.consume('NUMBER');
        selectors.push(parseFloat(num.value));
      }
    } while (this.match('COMMA'));

    this.consume('LBRACE');
    const declarations = this.parseDeclarations();
    this.consume('RBRACE');

    return {
      type: 'keyframe-block',
      selectors,
      declarations,
    };
  }

  private parseRule(): Rule {
    const selector = this.parseSelector();
    this.consume('LBRACE');

    const declarations: Declaration[] = [];
    const children: Rule[] = [];

    while (!this.check('RBRACE') && !this.isAtEnd()) {
      // Check for child rule (> #child or > .child)
      if (this.check('GT')) {
        this.consume('GT');
        const childRule = this.parseRule();
        children.push(childRule);
      } else {
        // Parse declaration
        const decl = this.parseDeclaration();
        if (decl) {
          declarations.push(decl);
        }
      }
    }

    this.consume('RBRACE');

    return {
      type: 'rule',
      selector,
      declarations,
      children,
    };
  }

  private parseSelector(): Selector {
    if (this.check('HASH')) {
      const id = this.consume('HASH').value;
      return { type: 'id', name: id };
    }

    if (this.check('DOT')) {
      this.consume('DOT');
      const className = this.consume('IDENT').value;
      return { type: 'class', name: className };
    }

    if (this.check('COLON')) {
      this.consume('COLON');
      const pseudoName = this.consume('IDENT').value;
      if (pseudoName === 'canvas') {
        return { type: 'canvas', name: 'canvas' };
      }
      if (pseudoName === 'root') {
        return { type: 'root', name: 'root' };
      }
      throw new Error(`Unknown pseudo-selector: :${pseudoName}`);
    }

    throw new Error(`Expected selector, got ${this.current().type}`);
  }

  private parseDeclarations(): Declaration[] {
    const declarations: Declaration[] = [];
    while (!this.check('RBRACE') && !this.isAtEnd()) {
      const decl = this.parseDeclaration();
      if (decl) {
        declarations.push(decl);
      }
    }
    return declarations;
  }

  private parseDeclaration(): Declaration | null {
    if (!this.check('IDENT')) {
      return null;
    }

    const property = this.consume('IDENT').value;
    this.consume('COLON');
    const value = this.parseValue();

    // Semicolon is optional before }
    this.match('SEMICOLON');

    return {
      type: 'declaration',
      property,
      value,
    };
  }

  private parseValue(): Value {
    const values: Value[] = [];

    // Parse one or more values (for shorthand properties)
    while (!this.check('SEMICOLON') && !this.check('RBRACE') && !this.check('COMMA') && !this.check('RPAREN') && !this.isAtEnd()) {
      values.push(this.parseSingleValue());
    }

    if (values.length === 0) {
      throw new Error('Expected value');
    }

    if (values.length === 1) {
      return values[0];
    }

    return { type: 'list', values };
  }

  private parseSingleValue(): Value {
    // Color
    if (this.check('COLOR')) {
      return { type: 'color', value: this.consume('COLOR').value };
    }

    // Number
    if (this.check('NUMBER')) {
      const num = this.consume('NUMBER');
      return { type: 'number', value: parseFloat(num.value) };
    }

    // Dimension (100px, 45deg)
    if (this.check('DIMENSION')) {
      const dim = this.consume('DIMENSION');
      const match = dim.value.match(/^(-?[\d.]+)(\w+)$/);
      if (match) {
        return {
          type: 'length',
          value: parseFloat(match[1]),
          unit: match[2] as 'px' | 'deg' | '%' | 'em' | 'rem',
        };
      }
    }

    // Percentage
    if (this.check('PERCENTAGE')) {
      const pct = this.consume('PERCENTAGE');
      return {
        type: 'length',
        value: parseFloat(pct.value),
        unit: '%',
      };
    }

    // String
    if (this.check('STRING')) {
      return { type: 'string', value: this.consume('STRING').value };
    }

    // Function or keyword
    if (this.check('IDENT')) {
      const ident = this.consume('IDENT');

      // Check if it's a function call
      if (this.check('LPAREN')) {
        return this.parseFunction(ident.value);
      }

      // Check if it's a color keyword like rgb, rgba
      if ((ident.value === 'rgb' || ident.value === 'rgba') && this.check('LPAREN')) {
        return this.parseFunction(ident.value);
      }

      // Check for dot notation (e.g., cursor.x, cursor.y)
      let value = ident.value;
      while (this.check('DOT')) {
        this.consume('DOT');
        const nextIdent = this.consume('IDENT');
        value += '.' + nextIdent.value;
      }

      // It's a keyword (possibly with dot notation)
      return { type: 'keyword', value };
    }

    throw new Error(`Unexpected token in value: ${this.current().type} (${this.current().value})`);
  }

  private parseFunction(name: string): FunctionValue | VariableRefValue {
    this.consume('LPAREN');

    // Special handling for var() - returns VariableRefValue
    if (name === 'var') {
      // Parse variable name (e.g., --cursor-x)
      const varName = this.consume('IDENT').value;
      let fallback: Value | undefined;

      // Check for fallback value
      if (this.match('COMMA')) {
        fallback = this.parseValue();
      }

      this.consume('RPAREN');

      return {
        type: 'variable',
        name: varName,
        fallback,
      };
    }

    // Regular function parsing
    const args: Value[] = [];

    while (!this.check('RPAREN') && !this.isAtEnd()) {
      args.push(this.parseValue());
      if (!this.check('RPAREN')) {
        this.match('COMMA');
      }
    }

    this.consume('RPAREN');

    return {
      type: 'function',
      name,
      args,
    };
  }

  private extractCanvasConfig(rule: Rule): CanvasConfig {
    const config: CanvasConfig = {
      width: 800,
      height: 600,
    };

    for (const decl of rule.declarations) {
      if (decl.property === 'width' && decl.value.type === 'length') {
        config.width = decl.value.value;
      } else if (decl.property === 'height' && decl.value.type === 'length') {
        config.height = decl.value.value;
      } else if (decl.property === 'background' && decl.value.type === 'color') {
        config.background = decl.value.value;
      }
    }

    return config;
  }

  private extractVariables(rule: Rule, variables: VariableDefinition[]): void {
    for (const decl of rule.declarations) {
      // CSS custom properties start with --
      if (decl.property.startsWith('--')) {
        variables.push({
          name: decl.property,
          value: decl.value,
        });
      }
    }
  }

  // Helper methods

  private current(): Token {
    return this.tokens[this.pos];
  }

  private isAtEnd(): boolean {
    return this.current().type === 'EOF';
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.current().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(type: TokenType): Token {
    if (this.check(type)) {
      return this.advance();
    }
    throw new Error(
      `Expected ${type}, got ${this.current().type} (${this.current().value}) at line ${this.current().line}, column ${this.current().column}`
    );
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1];
  }
}

// Export a convenience function
export function parse(input: string): StyleSheet {
  const parser = new Parser();
  return parser.parse(input);
}
