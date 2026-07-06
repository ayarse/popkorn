import type { StyleSheet, Rule, Declaration, Value, KeyframeRule, KeyframeBlock, StateRule } from '@popcorn/parser';
import {
  isLengthValue,
  isColorValue,
  isKeywordValue,
  isNumberValue,
  isStringValue,
  isFunctionValue,
  isListValue,
  isVariableRefValue,
  getNumericValue,
  getStringValue,
} from '@popcorn/parser';
import type {
  SceneNode,
  ShapeType,
  Transform,
  KeyframeData,
  TimingFunction,
  AnimationDirection,
  AnimationFillMode,
  RectData,
  CircleData,
  EllipseData,
  PathData,
  TransformOriginValue,
  StateStyles,
} from './types';
import { createSceneNode, createDefaultTransformOrigin, snapshotNode } from './types';
import { parsePath } from './path-parser';

/**
 * Build scene graph from AST
 */
export class SceneBuilder {
  private keyframesMap: Map<string, KeyframeRule> = new Map();
  // Longhand animation-fill-mode for the node currently being built (it
  // overrides any value in the animation shorthand, regardless of source order).
  private pendingFillMode: AnimationFillMode | null = null;

  build(stylesheet: StyleSheet): SceneNode {
    // Index keyframes by name
    for (const kf of stylesheet.keyframes) {
      this.keyframesMap.set(kf.name, kf);
    }

    // Create root node
    const root = createSceneNode('root', 'group');

    // Process rules
    for (const rule of stylesheet.rules) {
      const node = this.buildNode(rule);
      node.parent = root;
      root.children.push(node);
    }

    return root;
  }

  private buildNode(rule: Rule): SceneNode {
    const id = rule.selector.name;
    let shapeType: ShapeType = 'group';

    // First pass: find shape type
    for (const decl of rule.declarations) {
      if (decl.property === 'type') {
        shapeType = getStringValue(decl.value) as ShapeType;
        break;
      }
    }

    const node = createSceneNode(id, shapeType);

    if (rule.selector.type === 'class') {
      node.className = id;
    }

    // Pre-scan the longhand animation-fill-mode so it wins over the shorthand.
    this.pendingFillMode = this.findFillMode(rule.declarations);

    // Apply declarations
    this.applyDeclarations(node, rule.declarations);

    this.pendingFillMode = null;

    // Extract state-specific styles from pseudo rules
    if (rule.states && rule.states.length > 0) {
      for (const stateRule of rule.states) {
        const stateStyles = this.buildStateStyles(stateRule);
        if (stateRule.state === 'hover') {
          node.hoverStyles = stateStyles;
        } else if (stateRule.state === 'active') {
          node.activeStyles = stateStyles;
        }
      }
      // Mark node as interactive if it has any state styles
      node.interactive = true;
    }

    // Process children
    for (const childRule of rule.children) {
      const childNode = this.buildNode(childRule);
      childNode.parent = node;
      node.children.push(childNode);
    }

    // Capture the authored render state as the immutable base for the
    // per-frame value-resolution pipeline.
    node.base = snapshotNode(node);

    return node;
  }

  /**
   * Build state-specific styles from a StateRule
   */
  private buildStateStyles(stateRule: StateRule): StateStyles {
    const styles: StateStyles = {};

    for (const decl of stateRule.declarations) {
      const { property, value } = decl;

      switch (property) {
        case 'fill':
          if (isColorValue(value)) {
            styles.fill = value.value;
          } else if (isKeywordValue(value)) {
            if (value.value === 'none') {
              styles.fill = null;
            } else {
              styles.fill = value.value;
            }
          } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
            styles.fill = this.buildColorString(value);
          }
          break;

        case 'stroke':
          if (isColorValue(value)) {
            styles.stroke = value.value;
          } else if (isKeywordValue(value)) {
            if (value.value === 'none') {
              styles.stroke = null;
            } else {
              styles.stroke = value.value;
            }
          } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
            styles.stroke = this.buildColorString(value);
          }
          break;

        case 'stroke-width':
          styles.strokeWidth = getNumericValue(value);
          break;

        case 'opacity':
          styles.opacity = getNumericValue(value);
          break;

        case 'transform':
          styles.transform = this.extractStateTransform(value);
          break;
      }
    }

    return styles;
  }

  /**
   * Extract transform properties from a transform value for state styles
   */
  private extractStateTransform(value: Value): Partial<Transform> {
    const transform: Partial<Transform> = {};

    const extractSingle = (funcValue: { name: string; args: Value[] }) => {
      switch (funcValue.name) {
        case 'translate':
          transform.translateX = getNumericValue(funcValue.args[0]);
          transform.translateY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : 0;
          break;
        case 'translateX':
          transform.translateX = getNumericValue(funcValue.args[0]);
          break;
        case 'translateY':
          transform.translateY = getNumericValue(funcValue.args[0]);
          break;
        case 'rotate':
          transform.rotate = getNumericValue(funcValue.args[0]);
          break;
        case 'scale':
          transform.scaleX = getNumericValue(funcValue.args[0]);
          transform.scaleY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : transform.scaleX;
          break;
        case 'scaleX':
          transform.scaleX = getNumericValue(funcValue.args[0]);
          break;
        case 'scaleY':
          transform.scaleY = getNumericValue(funcValue.args[0]);
          break;
      }
    };

    if (isFunctionValue(value)) {
      extractSingle(value);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          extractSingle(v);
        }
      }
    }

    return transform;
  }

  private findFillMode(declarations: Declaration[]): AnimationFillMode | null {
    for (const decl of declarations) {
      if (decl.property === 'animation-fill-mode' && isKeywordValue(decl.value)) {
        const kw = decl.value.value;
        if (kw === 'none' || kw === 'forwards' || kw === 'backwards' || kw === 'both') {
          return kw;
        }
      }
    }
    return null;
  }

  private applyDeclarations(node: SceneNode, declarations: Declaration[]): void {
    for (const decl of declarations) {
      this.applyDeclaration(node, decl);
    }
  }

  private applyDeclaration(node: SceneNode, decl: Declaration): void {
    const { property, value } = decl;

    // Check if this value contains a variable reference
    if (this.hasVariableReference(value)) {
      // Store as a dynamic binding to be resolved at render time
      node.bindings.push({ property, value });
      return;
    }

    switch (property) {
      case 'type':
        // Already handled
        break;

      // Transform properties
      case 'transform':
        this.applyTransform(node, value);
        break;

      case 'transform-origin':
        this.applyTransformOrigin(node, value);
        break;

      // Position/size for rect
      case 'x':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).x = getNumericValue(value);
        }
        break;
      case 'y':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).y = getNumericValue(value);
        }
        break;
      case 'width':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).width = getNumericValue(value);
        }
        break;
      case 'height':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).height = getNumericValue(value);
        }
        break;
      case 'rx':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).rx = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).rx = getNumericValue(value);
        }
        break;
      case 'ry':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).ry = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).ry = getNumericValue(value);
        }
        break;

      // Circle/ellipse properties
      case 'cx':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cx = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cx = getNumericValue(value);
        }
        break;
      case 'cy':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cy = getNumericValue(value);
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cy = getNumericValue(value);
        }
        break;
      case 'r':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).r = getNumericValue(value);
        }
        break;

      // Path
      case 'd':
        if (node.shapeData.type === 'path') {
          const pathStr = getStringValue(value);
          (node.shapeData as PathData).d = pathStr;
          (node.shapeData as PathData).commands = parsePath(pathStr);
        }
        break;

      // Appearance
      case 'fill':
        if (isColorValue(value)) {
          node.fill = value.value;
        } else if (isKeywordValue(value)) {
          if (value.value === 'none') {
            node.fill = null;
          } else {
            node.fill = value.value;
          }
        } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
          node.fill = this.buildColorString(value);
        }
        break;

      case 'stroke':
        if (isColorValue(value)) {
          node.stroke = value.value;
        } else if (isKeywordValue(value)) {
          if (value.value === 'none') {
            node.stroke = null;
          } else {
            node.stroke = value.value;
          }
        } else if (isFunctionValue(value) && (value.name === 'rgb' || value.name === 'rgba')) {
          node.stroke = this.buildColorString(value);
        }
        break;

      case 'stroke-width':
        node.strokeWidth = getNumericValue(value);
        break;

      case 'opacity':
        node.opacity = getNumericValue(value);
        break;

      // Animation (shorthand)
      case 'animation':
        this.applyAnimation(node, value);
        break;

      case 'animation-name':
        // Will be combined with other animation properties
        break;
      case 'animation-duration':
        break;
      case 'animation-timing-function':
        break;
      case 'animation-iteration-count':
        break;
      case 'animation-direction':
        break;
      case 'animation-delay':
        break;
      case 'animation-fill-mode':
        // Handled by the pre-scan in buildNode (see pendingFillMode).
        break;
    }

    // Initialize shape data if not set
    this.ensureShapeData(node);
  }

  private ensureShapeData(node: SceneNode): void {
    if (!node.shapeData || node.shapeData.type !== node.type) {
      switch (node.type) {
        case 'group':
          node.shapeData = { type: 'group' };
          break;
        case 'rect':
          node.shapeData = { type: 'rect', x: 0, y: 0, width: 0, height: 0, rx: 0, ry: 0 };
          break;
        case 'circle':
          node.shapeData = { type: 'circle', cx: 0, cy: 0, r: 0 };
          break;
        case 'ellipse':
          node.shapeData = { type: 'ellipse', cx: 0, cy: 0, rx: 0, ry: 0 };
          break;
        case 'path':
          node.shapeData = { type: 'path', d: '', commands: [] };
          break;
      }
    }
  }

  private applyTransform(node: SceneNode, value: Value): void {
    if (isFunctionValue(value)) {
      this.applySingleTransform(node.transform, value.name, value.args);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          this.applySingleTransform(node.transform, v.name, v.args);
        }
      }
    }
  }

  private applySingleTransform(transform: Transform, name: string, args: Value[]): void {
    switch (name) {
      case 'translate':
        transform.translateX = getNumericValue(args[0]);
        transform.translateY = args.length > 1 ? getNumericValue(args[1]) : 0;
        break;
      case 'translateX':
        transform.translateX = getNumericValue(args[0]);
        break;
      case 'translateY':
        transform.translateY = getNumericValue(args[0]);
        break;
      case 'rotate':
        transform.rotate = getNumericValue(args[0]);
        break;
      case 'scale':
        transform.scaleX = getNumericValue(args[0]);
        transform.scaleY = args.length > 1 ? getNumericValue(args[1]) : transform.scaleX;
        break;
      case 'scaleX':
        transform.scaleX = getNumericValue(args[0]);
        break;
      case 'scaleY':
        transform.scaleY = getNumericValue(args[0]);
        break;
    }
  }

  /**
   * Parse transform-origin property
   * Supports:
   * - Keywords: center, top, left, right, bottom, and combinations
   * - Percentages: 50%, 100%
   * - Pixels: 100px, 150px
   * - Mixed: center 100px, 50% top
   */
  private applyTransformOrigin(node: SceneNode, value: Value): void {
    const origin = createDefaultTransformOrigin();

    // Handle single value or list of values
    let values: Value[] = [];
    if (isListValue(value)) {
      values = value.values;
    } else {
      values = [value];
    }

    // Process first value (x-axis or keyword)
    if (values.length >= 1) {
      const firstVal = this.parseTransformOriginValue(values[0], 'x');
      if (firstVal) {
        // Check if it's a y-axis keyword used as first value (e.g., "top")
        if (this.isYAxisKeyword(values[0])) {
          origin.y = firstVal;
          // If single y-axis keyword, x defaults to center (50%)
          origin.x = { value: 50, unit: '%' };
        } else {
          origin.x = firstVal;
        }
      }
    }

    // Process second value (y-axis)
    if (values.length >= 2) {
      const secondVal = this.parseTransformOriginValue(values[1], 'y');
      if (secondVal) {
        // Check if first was a y-axis keyword; if so, this is x
        if (this.isYAxisKeyword(values[0])) {
          origin.x = secondVal;
        } else {
          origin.y = secondVal;
        }
      }
    } else if (values.length === 1) {
      // Single value - handle special cases
      const firstVal = values[0];
      if (isKeywordValue(firstVal) && firstVal.value === 'center') {
        // "center" alone means center on both axes
        origin.x = { value: 50, unit: '%' };
        origin.y = { value: 50, unit: '%' };
      } else if (!this.isYAxisKeyword(firstVal)) {
        // Single x-axis value defaults y to 50% (center)
        // This matches CSS behavior where "transform-origin: 100px" means "100px 50%"
        origin.y = { value: 50, unit: '%' };
      }
    }

    node.transform.transformOrigin = origin;
  }

  private isYAxisKeyword(value: Value): boolean {
    return isKeywordValue(value) && (value.value === 'top' || value.value === 'bottom');
  }

  private parseTransformOriginValue(value: Value, axis: 'x' | 'y'): TransformOriginValue | null {
    if (isKeywordValue(value)) {
      return this.keywordToOriginValue(value.value, axis);
    } else if (isLengthValue(value)) {
      if (value.unit === '%') {
        return { value: value.value, unit: '%' };
      } else {
        // Convert all other units to px (simplified)
        return { value: value.value, unit: 'px' };
      }
    } else if (isNumberValue(value)) {
      // Plain numbers treated as pixels
      return { value: value.value, unit: 'px' };
    }
    return null;
  }

  private keywordToOriginValue(keyword: string, _axis: 'x' | 'y'): TransformOriginValue {
    switch (keyword) {
      case 'left':
        return { value: 0, unit: '%' };
      case 'right':
        return { value: 100, unit: '%' };
      case 'top':
        return { value: 0, unit: '%' };
      case 'bottom':
        return { value: 100, unit: '%' };
      case 'center':
        return { value: 50, unit: '%' };
      default:
        // Unknown keyword defaults to 0
        return { value: 0, unit: 'px' };
    }
  }

  private applyAnimation(node: SceneNode, value: Value): void {
    // Parse animation shorthand: name duration timing-function iteration-count direction
    let values: Value[] = [];
    if (isListValue(value)) {
      values = value.values;
    } else {
      values = [value];
    }

    let name = '';
    let duration = 1000;
    let timingFunction: TimingFunction = 'ease';
    let iterationCount = 1;
    let direction: AnimationDirection = 'normal';
    let delay = 0;
    // CSS default is 'none', but existing examples rely on animations holding
    // their final frame after finishing, so we deliberately default to
    // 'forwards'. A longhand `animation-fill-mode` (below) still overrides it.
    let fillMode: AnimationFillMode = this.pendingFillMode ?? 'forwards';

    for (const v of values) {
      if (isKeywordValue(v)) {
        const kw = v.value;
        if (this.keyframesMap.has(kw)) {
          name = kw;
        } else if (kw === 'linear' || kw === 'ease' || kw === 'ease-in' || kw === 'ease-out' || kw === 'ease-in-out') {
          timingFunction = kw;
        } else if (kw === 'infinite') {
          iterationCount = Infinity;
        } else if (kw === 'normal' || kw === 'reverse' || kw === 'alternate' || kw === 'alternate-reverse') {
          direction = kw;
        } else if (kw === 'none' || kw === 'forwards' || kw === 'backwards' || kw === 'both') {
          // A longhand animation-fill-mode still wins over the shorthand value.
          fillMode = this.pendingFillMode ?? kw;
        }
      } else if (isFunctionValue(v) && v.name === 'cubic-bezier') {
        // Handle cubic-bezier(x1, y1, x2, y2)
        timingFunction = this.parseCubicBezierFunction(v);
      } else if (isLengthValue(v)) {
        // Duration or delay (e.g., 2s, 500ms)
        if (v.unit === 's') {
          if (duration === 1000) {
            duration = v.value * 1000;
          } else {
            delay = v.value * 1000;
          }
        } else if (v.unit === 'ms') {
          if (duration === 1000) {
            duration = v.value;
          } else {
            delay = v.value;
          }
        }
      } else if (isNumberValue(v)) {
        // Could be iteration count or duration
        if (v.value === Math.floor(v.value) && v.value > 0 && v.value < 100) {
          iterationCount = v.value;
        }
      } else if (isStringValue(v)) {
        // Animation name as string
        name = v.value;
      }
    }

    if (name && this.keyframesMap.has(name)) {
      const keyframeRule = this.keyframesMap.get(name)!;
      const keyframes = this.buildKeyframes(keyframeRule);

      node.animations.push({
        name,
        duration,
        timingFunction,
        iterationCount,
        direction,
        delay,
        fillMode,
        keyframes,
      });
    }
  }

  private buildKeyframes(rule: KeyframeRule): KeyframeData[] {
    return rule.blocks.map(block => {
      const keyframeData: KeyframeData = {
        offset: block.selectors[0] / 100, // Convert percentage to 0-1
        properties: this.buildKeyframeProperties(block),
      };

      // Add per-keyframe easing if specified
      if (block.easing) {
        keyframeData.easing = this.parseTimingFunction(block.easing);
      }

      return keyframeData;
    });
  }

  private buildKeyframeProperties(block: KeyframeBlock): Record<string, number | string | Transform> {
    const props: Record<string, number | string | Transform> = {};

    for (const decl of block.declarations) {
      const { property, value } = decl;

      switch (property) {
        case 'transform':
          // Store individual transform properties instead of full Transform
          // This allows merging with base transform during interpolation
          this.extractTransformProperties(value, props);
          break;
        case 'opacity':
          props.opacity = getNumericValue(value);
          break;
        case 'fill':
          if (isColorValue(value)) {
            props.fill = value.value;
          } else if (isFunctionValue(value)) {
            props.fill = this.buildColorString(value);
          }
          break;
        default:
          // Store raw numeric/string value
          if (isNumberValue(value) || isLengthValue(value)) {
            props[property] = getNumericValue(value);
          } else if (isColorValue(value) || isKeywordValue(value) || isStringValue(value)) {
            props[property] = getStringValue(value);
          }
      }
    }

    return props;
  }

  private extractTransformProperties(value: Value, props: Record<string, number | string | Transform>): void {
    // Extract individual transform functions into separate properties
    // This allows proper merging with base transform during animation
    const extractSingle = (funcValue: { name: string; args: Value[] }) => {
      switch (funcValue.name) {
        case 'translate':
          props.translateX = getNumericValue(funcValue.args[0]);
          props.translateY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : 0;
          break;
        case 'translateX':
          props.translateX = getNumericValue(funcValue.args[0]);
          break;
        case 'translateY':
          props.translateY = getNumericValue(funcValue.args[0]);
          break;
        case 'rotate':
          props.rotate = getNumericValue(funcValue.args[0]);
          break;
        case 'scale':
          props.scaleX = getNumericValue(funcValue.args[0]);
          props.scaleY = funcValue.args.length > 1 ? getNumericValue(funcValue.args[1]) : props.scaleX as number;
          break;
        case 'scaleX':
          props.scaleX = getNumericValue(funcValue.args[0]);
          break;
        case 'scaleY':
          props.scaleY = getNumericValue(funcValue.args[0]);
          break;
      }
    };

    if (isFunctionValue(value)) {
      extractSingle(value);
    } else if (isListValue(value)) {
      for (const v of value.values) {
        if (isFunctionValue(v)) {
          extractSingle(v);
        }
      }
    }
  }

  private buildColorString(func: { name: string; args: Value[] }): string {
    if (func.name === 'rgb') {
      const r = getNumericValue(func.args[0]);
      const g = getNumericValue(func.args[1]);
      const b = getNumericValue(func.args[2]);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (func.name === 'rgba') {
      const r = getNumericValue(func.args[0]);
      const g = getNumericValue(func.args[1]);
      const b = getNumericValue(func.args[2]);
      const a = getNumericValue(func.args[3]);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return '#000000';
  }

  private hasVariableReference(value: Value): boolean {
    // Check if the value is a variable reference (var())
    if (isVariableRefValue(value)) {
      return true;
    }

    // Check if it's an input() function
    if (isFunctionValue(value) && value.name === 'input') {
      return true;
    }

    // Check list values recursively
    if (isListValue(value)) {
      return value.values.some(v => this.hasVariableReference(v));
    }

    return false;
  }

  /**
   * Parse a timing function string into a TimingFunction type
   * Handles both named keywords and cubic-bezier() strings
   */
  private parseTimingFunction(easingStr: string): TimingFunction {
    // Check for named timing functions
    if (easingStr === 'linear' || easingStr === 'ease' ||
        easingStr === 'ease-in' || easingStr === 'ease-out' ||
        easingStr === 'ease-in-out') {
      return easingStr;
    }

    // Check for cubic-bezier()
    const cubicBezierMatch = easingStr.match(/^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/);
    if (cubicBezierMatch) {
      return {
        type: 'cubic-bezier',
        x1: parseFloat(cubicBezierMatch[1]),
        y1: parseFloat(cubicBezierMatch[2]),
        x2: parseFloat(cubicBezierMatch[3]),
        y2: parseFloat(cubicBezierMatch[4]),
      };
    }

    // Default to ease
    return 'ease';
  }

  /**
   * Parse a cubic-bezier FunctionValue into a CubicBezier timing function
   */
  private parseCubicBezierFunction(func: { name: string; args: Value[] }): TimingFunction {
    if (func.args.length >= 4) {
      return {
        type: 'cubic-bezier',
        x1: getNumericValue(func.args[0]),
        y1: getNumericValue(func.args[1]),
        x2: getNumericValue(func.args[2]),
        y2: getNumericValue(func.args[3]),
      };
    }
    return 'ease';
  }
}

export function buildSceneGraph(stylesheet: StyleSheet): SceneNode {
  const builder = new SceneBuilder();
  return builder.build(stylesheet);
}
