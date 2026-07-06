import type { SceneNode, NodeBase } from '../scene/types';
import { parseColor } from '../renderer/types';
import { lerp } from '../scene/transform';

/**
 * Property registry.
 *
 * One table mapping an animatable property name to how it is read from a node's
 * authored base, interpolated, and written to the live node. The keyframe
 * interpolator and the binding resolver both dispatch through this table, so
 * geometry (x/y/width/height/rx/ry/cx/cy/r), stroke, stroke-width, opacity,
 * fill and the individual transform components are all animatable and bindable
 * without any hardcoded per-property branching.
 */
export type PropKind = 'number' | 'color';

export interface PropHandler {
  kind: PropKind;
  // Base value used as the endpoint when a keyframe omits this property.
  readBase(base: NodeBase): number | string | null;
  // Write a resolved value into the node's live render fields.
  apply(node: SceneNode, value: number | string): void;
}

// --- transform components (all plain-number lerp; rotate is direct, matching
// the existing full-turn animation behaviour) --------------------------------
function transformNumber(key: 'translateX' | 'translateY' | 'rotate' | 'scaleX' | 'scaleY'): PropHandler {
  return {
    kind: 'number',
    readBase: (base) => base.transform[key],
    apply: (node, value) => {
      node.transform[key] = value as number;
    },
  };
}

// --- geometry (numeric fields living on shapeData) ---------------------------
function geometryNumber(key: string): PropHandler {
  return {
    kind: 'number',
    readBase: (base) => ((base.shapeData as unknown as Record<string, unknown>)[key] as number) ?? 0,
    apply: (node, value) => {
      // Geometry keys only exist on the shapes that declare them; the renderer
      // reads type-specific fields, so a stray assignment is inert.
      const sd = node.shapeData as unknown as Record<string, unknown>;
      if (key in sd) {
        sd[key] = value;
        // Geometry changed -> the cached outline length is stale (trim paths).
        node.outlineLengthDirty = true;
      }
    },
  };
}

// --- trim paths (fractions 0..1 of the outline; render clamps to range) ------
function trimNumber(key: 'trimStart' | 'trimEnd' | 'trimOffset'): PropHandler {
  return {
    kind: 'number',
    readBase: (base) => base[key],
    apply: (node, value) => {
      node[key] = value as number;
    },
  };
}

export const PROPERTY_REGISTRY: Record<string, PropHandler> = {
  // transform components
  translateX: transformNumber('translateX'),
  translateY: transformNumber('translateY'),
  rotate: transformNumber('rotate'),
  scaleX: transformNumber('scaleX'),
  scaleY: transformNumber('scaleY'),

  // opacity
  opacity: {
    kind: 'number',
    readBase: (base) => base.opacity,
    apply: (node, value) => {
      node.opacity = value as number;
    },
  },

  // colors
  fill: {
    kind: 'color',
    readBase: (base) => base.fill,
    apply: (node, value) => {
      // A gradient fill isn't animatable yet; keep it (last-write wins).
      if (node.fillGradient) return;
      node.fill = value as string;
    },
  },
  stroke: {
    kind: 'color',
    readBase: (base) => base.stroke,
    apply: (node, value) => {
      if (node.strokeGradient) return;
      node.stroke = value as string;
    },
  },
  'stroke-width': {
    kind: 'number',
    readBase: (base) => base.strokeWidth,
    apply: (node, value) => {
      node.strokeWidth = value as number;
    },
  },

  // geometry
  x: geometryNumber('x'),
  y: geometryNumber('y'),
  width: geometryNumber('width'),
  height: geometryNumber('height'),
  rx: geometryNumber('rx'),
  ry: geometryNumber('ry'),
  cx: geometryNumber('cx'),
  cy: geometryNumber('cy'),
  r: geometryNumber('r'),

  // trim paths
  'trim-start': trimNumber('trimStart'),
  'trim-end': trimNumber('trimEnd'),
  'trim-offset': trimNumber('trimOffset'),
};

export function getPropHandler(property: string): PropHandler | undefined {
  return PROPERTY_REGISTRY[property];
}

/**
 * Interpolate two endpoint values for a property according to its kind.
 */
export function interpolateProp(
  handler: PropHandler,
  from: number | string | null,
  to: number | string | null,
  t: number
): number | string | null {
  if (handler.kind === 'color') {
    if (typeof from !== 'string' || typeof to !== 'string') return to ?? from;
    return interpolateColor(from, to, t);
  }
  return lerp((from as number) ?? 0, (to as number) ?? 0, t);
}

/**
 * Interpolate between two colors.
 */
export function interpolateColor(color1: string, color2: string, t: number): string {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);

  const r = Math.round(lerp(c1.r, c2.r, t));
  const g = Math.round(lerp(c1.g, c2.g, t));
  const b = Math.round(lerp(c1.b, c2.b, t));
  const a = lerp(c1.a, c2.a, t);

  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
