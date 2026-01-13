/**
 * Tree-sitter based parser for Popcorn DSL
 * Transforms tree-sitter CST into our AST types
 */

import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter';
import type {
  StyleSheet,
  Rule,
  Selector,
  Declaration,
  Value,
  KeyframeRule,
  KeyframeBlock,
  CanvasConfig,
  VariableDefinition,
} from './ast';

let parser: Parser | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the tree-sitter parser with Popcorn language
 * Must be called before parsing
 */
export async function initParser(): Promise<void> {
  if (parser) return;

  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    await Parser.init({
      locateFile: (scriptName: string) => `/${scriptName}`,
    });

    parser = new Parser();
    const language = await Language.load('/tree-sitter-popcorn.wasm');
    parser.setLanguage(language);
  })();

  await initPromise;
  isInitializing = false;
}

/**
 * Check if parser is initialized
 */
export function isParserReady(): boolean {
  return parser !== null;
}

/**
 * Parse SceneGraph DSL source into AST
 */
export function parse(source: string): StyleSheet {
  if (!parser) {
    throw new Error('Parser not initialized. Call initParser() first.');
  }

  const tree = parser.parse(source);
  if (!tree) {
    throw new Error('Failed to parse source');
  }

  return transformStylesheet(tree.rootNode);
}

// =============================================
// CST to AST Transformation
// =============================================

function transformStylesheet(node: SyntaxNode): StyleSheet {
  const stylesheet: StyleSheet = {
    type: 'stylesheet',
    rules: [],
    keyframes: [],
    variables: [],
  };

  for (const child of node.namedChildren) {
    if (child.type === 'rule') {
      const rule = transformRule(child);

      if (rule.selector.type === 'canvas') {
        stylesheet.canvas = extractCanvasConfig(rule);
      } else if (rule.selector.type === 'root') {
        // Extract variable definitions from :root
        stylesheet.variables = extractVariables(rule);
      } else {
        stylesheet.rules.push(rule);
      }
    } else if (child.type === 'keyframes_rule') {
      stylesheet.keyframes.push(transformKeyframesRule(child));
    }
  }

  return stylesheet;
}

function transformRule(node: SyntaxNode): Rule {
  const selectorNode = findChild(node, 'selector');
  const blockNode = findChild(node, 'block');

  const rule: Rule = {
    type: 'rule',
    selector: selectorNode ? transformSelector(selectorNode) : { type: 'id', name: 'unknown' },
    declarations: [],
    children: [],
  };

  if (blockNode) {
    for (const child of blockNode.namedChildren) {
      if (child.type === 'declaration') {
        rule.declarations.push(transformDeclaration(child));
      } else if (child.type === 'child_rule') {
        const innerRule = findChild(child, 'rule');
        if (innerRule) {
          rule.children.push(transformRule(innerRule));
        }
      }
    }
  }

  return rule;
}

function transformSelector(node: SyntaxNode): Selector {
  const child = node.firstNamedChild;
  if (!child) {
    return { type: 'id', name: 'unknown' };
  }

  switch (child.type) {
    case 'id_selector': {
      const ident = findChild(child, 'identifier');
      return { type: 'id', name: ident?.text ?? 'unknown' };
    }
    case 'class_selector': {
      const ident = findChild(child, 'identifier');
      return { type: 'class', name: ident?.text ?? 'unknown' };
    }
    case 'canvas_selector':
      return { type: 'canvas', name: 'canvas' };
    case 'root_selector':
      return { type: 'root', name: 'root' };
    default:
      return { type: 'id', name: 'unknown' };
  }
}

function transformDeclaration(node: SyntaxNode): Declaration {
  const propertyNode = findChild(node, 'property');
  const property = getPropertyName(propertyNode);

  // Collect all value nodes
  const values: Value[] = [];
  for (const child of node.namedChildren) {
    if (isValueNode(child)) {
      values.push(transformValue(child));
    }
  }

  return {
    type: 'declaration',
    property,
    value: values.length === 1 ? values[0] : { type: 'list', values },
  };
}

function getPropertyName(node: SyntaxNode | null): string {
  if (!node) return 'unknown';

  const customProp = findChild(node, 'custom_property');
  if (customProp) {
    return customProp.text;
  }

  const ident = findChild(node, 'identifier');
  return ident?.text ?? node.text;
}

function isValueNode(node: SyntaxNode): boolean {
  return [
    'number', 'dimension', 'percentage', 'color', 'string',
    'function_call', 'keyword', 'var_function'
  ].includes(node.type);
}

function transformValue(node: SyntaxNode): Value {
  switch (node.type) {
    case 'number':
      return { type: 'number', value: parseFloat(node.text) };

    case 'dimension': {
      const text = node.text;
      const match = text.match(/^(-?[\d.]+)(\w+)$/);
      if (match) {
        return {
          type: 'length',
          value: parseFloat(match[1]),
          unit: match[2] as 'px' | 'deg' | '%' | 'em' | 'rem' | 's' | 'ms',
        };
      }
      return { type: 'number', value: parseFloat(text) };
    }

    case 'percentage': {
      const text = node.text;
      return {
        type: 'length',
        value: parseFloat(text),
        unit: '%',
      };
    }

    case 'color':
      return { type: 'color', value: node.text };

    case 'string': {
      // Remove quotes
      const text = node.text;
      return { type: 'string', value: text.slice(1, -1) };
    }

    case 'var_function': {
      const customProp = findChild(node, 'custom_property');
      return {
        type: 'variable',
        name: customProp?.text ?? '',
      };
    }

    case 'function_call': {
      const nameNode = findChild(node, 'identifier');
      const argsNode = findChild(node, 'arguments');

      const args: Value[] = [];
      if (argsNode) {
        for (const child of argsNode.namedChildren) {
          if (isValueNode(child)) {
            args.push(transformValue(child));
          }
        }
      }

      return {
        type: 'function',
        name: nameNode?.text ?? 'unknown',
        args,
      };
    }

    case 'keyword': {
      // Check for member expression (e.g., cursor.x)
      const memberExpr = findChild(node, 'member_expression');
      if (memberExpr) {
        return { type: 'keyword', value: memberExpr.text };
      }
      const ident = findChild(node, 'identifier');
      return { type: 'keyword', value: ident?.text ?? node.text };
    }

    default:
      return { type: 'keyword', value: node.text };
  }
}

function transformKeyframesRule(node: SyntaxNode): KeyframeRule {
  const nameNode = findChild(node, 'keyframes_name');
  const blockNode = findChild(node, 'keyframes_block');

  const blocks: KeyframeBlock[] = [];
  if (blockNode) {
    for (const child of blockNode.namedChildren) {
      if (child.type === 'keyframe') {
        blocks.push(transformKeyframe(child));
      }
    }
  }

  return {
    type: 'keyframes',
    name: nameNode?.firstNamedChild?.text ?? 'unknown',
    blocks,
  };
}

function transformKeyframe(node: SyntaxNode): KeyframeBlock {
  const selectorListNode = findChild(node, 'keyframe_selector_list');
  const declBlockNode = findChild(node, 'declaration_block');

  const selectors: number[] = [];
  if (selectorListNode) {
    for (const child of selectorListNode.children) {
      if (child.type === 'percentage') {
        selectors.push(parseFloat(child.text));
      } else if (child.type === 'number') {
        selectors.push(parseFloat(child.text));
      } else if (child.text === 'from') {
        selectors.push(0);
      } else if (child.text === 'to') {
        selectors.push(100);
      }
    }
  }

  const declarations: Declaration[] = [];
  let easing: string | undefined;

  if (declBlockNode) {
    for (const child of declBlockNode.namedChildren) {
      if (child.type === 'declaration') {
        const decl = transformDeclaration(child);
        // Extract animation-timing-function as per-keyframe easing
        if (decl.property === 'animation-timing-function') {
          easing = extractEasingString(decl.value);
        } else {
          declarations.push(decl);
        }
      }
    }
  }

  const block: KeyframeBlock = {
    type: 'keyframe-block',
    selectors,
    declarations,
  };

  if (easing) {
    block.easing = easing;
  }

  return block;
}

/**
 * Extract easing string from a Value
 * Handles keywords (ease, ease-in, etc.) and cubic-bezier() functions
 */
function extractEasingString(value: Value): string {
  if (value.type === 'keyword') {
    return value.value;
  }
  if (value.type === 'function' && value.name === 'cubic-bezier') {
    const args = value.args.map(arg => {
      if (arg.type === 'number') return arg.value.toString();
      if (arg.type === 'length') return arg.value.toString();
      return '0';
    });
    return `cubic-bezier(${args.join(', ')})`;
  }
  return 'ease';
}

function extractCanvasConfig(rule: Rule): CanvasConfig {
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

function extractVariables(rule: Rule): VariableDefinition[] {
  const variables: VariableDefinition[] = [];

  for (const decl of rule.declarations) {
    if (decl.property.startsWith('--')) {
      variables.push({
        name: decl.property,
        value: decl.value,
      });
    }
  }

  return variables;
}

// =============================================
// Helper functions
// =============================================

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) {
      return child;
    }
  }
  return null;
}
