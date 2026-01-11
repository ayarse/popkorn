import type { Value, VariableDefinition } from '../parser/ast';
import {
  isVariableRefValue,
  isFunctionValue,
  isNumberValue,
  isLengthValue,
  isKeywordValue,
} from '../parser/ast';
import type { InputState } from './inputs';

/**
 * Variable resolution system
 * Handles CSS variables and input bindings
 */
export class VariableResolver {
  private staticVariables: Map<string, Value> = new Map();
  private dynamicVariables: Map<string, () => number> = new Map();

  constructor() {
    // Set up built-in input bindings
    this.setupBuiltinInputs();
  }

  /**
   * Initialize with variable definitions from :root
   */
  setVariables(variables: VariableDefinition[]): void {
    this.staticVariables.clear();

    for (const v of variables) {
      // Check if the value is an input() function
      if (isFunctionValue(v.value) && v.value.name === 'input') {
        // Register as a dynamic variable that will be resolved at runtime
        const inputPath = this.getInputPath(v.value.args);
        if (inputPath) {
          this.dynamicVariables.set(v.name, () => this.resolveInputPath(inputPath));
        }
      } else {
        // Static variable
        this.staticVariables.set(v.name, v.value);
      }
    }
  }

  /**
   * Update input state for dynamic variables
   */
  private inputState: InputState = {
    cursor: { x: 0, y: 0, isDown: false },
    scroll: { x: 0, y: 0 },
    time: 0,
  };

  updateInputState(state: InputState): void {
    this.inputState = state;
  }

  /**
   * Resolve a value, substituting any variable references
   */
  resolveValue(value: Value): Value {
    if (isVariableRefValue(value)) {
      return this.resolveVariable(value.name, value.fallback);
    }
    return value;
  }

  /**
   * Resolve a variable by name
   */
  resolveVariable(name: string, fallback?: Value): Value {
    // Check dynamic variables first (input bindings)
    if (this.dynamicVariables.has(name)) {
      const resolver = this.dynamicVariables.get(name)!;
      return { type: 'number', value: resolver() };
    }

    // Check static variables
    if (this.staticVariables.has(name)) {
      const value = this.staticVariables.get(name)!;
      // Recursively resolve if it's also a variable reference
      return this.resolveValue(value);
    }

    // Use fallback or return 0
    if (fallback) {
      return this.resolveValue(fallback);
    }

    return { type: 'number', value: 0 };
  }

  /**
   * Resolve a numeric value (for properties like cx, cy, r, etc.)
   */
  resolveNumeric(value: Value): number {
    const resolved = this.resolveValue(value);

    if (isNumberValue(resolved)) {
      return resolved.value;
    }
    if (isLengthValue(resolved)) {
      return resolved.value;
    }
    return 0;
  }

  /**
   * Check if a value contains any variable references
   */
  hasVariables(value: Value): boolean {
    if (isVariableRefValue(value)) {
      return true;
    }
    if (isFunctionValue(value) && value.name === 'input') {
      return true;
    }
    return false;
  }

  private setupBuiltinInputs(): void {
    // These are resolved directly without needing variable definitions
  }

  private getInputPath(args: Value[]): string | null {
    if (args.length === 0) return null;

    const arg = args[0];
    // Handle dot notation like cursor.x
    if (isKeywordValue(arg)) {
      return arg.value;
    }
    return null;
  }

  private resolveInputPath(path: string): number {
    const parts = path.split('.');

    switch (parts[0]) {
      case 'cursor':
        if (parts[1] === 'x') return this.inputState.cursor.x;
        if (parts[1] === 'y') return this.inputState.cursor.y;
        if (parts[1] === 'isDown') return this.inputState.cursor.isDown ? 1 : 0;
        break;
      case 'scroll':
        if (parts[1] === 'x') return this.inputState.scroll.x;
        if (parts[1] === 'y') return this.inputState.scroll.y;
        break;
      case 'time':
        return this.inputState.time;
    }

    return 0;
  }
}

// Singleton instance
let resolver: VariableResolver | null = null;

export function getVariableResolver(): VariableResolver {
  if (!resolver) {
    resolver = new VariableResolver();
  }
  return resolver;
}

export function createVariableResolver(): VariableResolver {
  return new VariableResolver();
}
