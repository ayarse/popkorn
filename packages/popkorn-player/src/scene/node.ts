// SceneNode construction, per-frame clones/base reset, and paint order.

import type { GradientData, GradientPoint } from "../renderer/types.js";
import type {
  ClipPathData,
  FilterOp,
  NodeBase,
  SceneNode,
  ShapeData,
  ShapeType,
  Transform,
  TransformOrigin,
} from "./types.js";

export function createDefaultTransformOrigin(): TransformOrigin {
  return {
    x: { value: 0, unit: "px" },
    y: { value: 0, unit: "px" },
  };
}

export function createDefaultTransform(): Transform {
  return {
    translateX: 0,
    translateY: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    transformOrigin: createDefaultTransformOrigin(),
  };
}

function cloneTransform(t: Transform): Transform {
  return {
    ...t,
    transformOrigin: {
      x: { ...t.transformOrigin.x },
      y: { ...t.transformOrigin.y },
    },
  };
}

// Copy a transform's fields into an existing target (no allocation).
function copyTransform(src: Transform, dst: Transform): void {
  dst.translateX = src.translateX;
  dst.translateY = src.translateY;
  dst.rotate = src.rotate;
  dst.scaleX = src.scaleX;
  dst.scaleY = src.scaleY;
  dst.skewX = src.skewX;
  dst.skewY = src.skewY;
  dst.transformOrigin.x.value = src.transformOrigin.x.value;
  dst.transformOrigin.x.unit = src.transformOrigin.x.unit;
  dst.transformOrigin.y.value = src.transformOrigin.y.value;
  dst.transformOrigin.y.unit = src.transformOrigin.y.unit;
}

// Shallow clone (path commands shared); the image crop is deep-copied.
function cloneShapeData(sd: ShapeData): ShapeData {
  const copy = { ...sd };
  if (copy.type === "image" && copy.viewBox) copy.viewBox = { ...copy.viewBox };
  return copy;
}

// Deep copy so a live interpolated value never aliases the base's stops.
export function cloneGradient(g: GradientData | null): GradientData | null {
  if (!g) return null;
  const stops = g.stops.map((s) => ({ offset: s.offset, color: s.color }));
  const pt = (p?: GradientPoint) => (p ? { x: p.x, y: p.y } : undefined);
  const interpolate = g.interpolate ? { ...g.interpolate } : undefined;
  if (g.type === "linear-gradient")
    return {
      type: "linear-gradient",
      angle: g.angle,
      stops,
      from: pt(g.from),
      to: pt(g.to),
      repeating: g.repeating,
      interpolate,
    };
  if (g.type === "conic-gradient")
    return {
      type: "conic-gradient",
      from: g.from,
      stops,
      at: pt(g.at),
      repeating: g.repeating,
      interpolate,
    };
  return {
    type: "radial-gradient",
    stops,
    radius: g.radius,
    at: pt(g.at),
    focal: pt(g.focal),
    repeating: g.repeating,
    interpolate,
  };
}

// Clip commands are copied so an animated clip can't corrupt the base.
export function cloneClipPath(clip: ClipPathData | null): ClipPathData | null {
  if (!clip) return null;
  if (clip.type === "path")
    return { type: "path", commands: clip.commands.slice() };
  return { ...clip };
}

function cloneFilter(filter: FilterOp[] | null): FilterOp[] | null {
  return filter ? filter.map((f) => ({ ...f })) : null;
}

export function snapshotNode(node: Omit<SceneNode, "base">): NodeBase {
  return {
    transform: cloneTransform(node.transform),
    zIndex: node.zIndex,
    displayNone: node.displayNone,
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    opacity: node.opacity,
    trimStart: node.trimStart,
    trimEnd: node.trimEnd,
    trimOffset: node.trimOffset,
    strokeDashOffset: node.strokeDashOffset,
    offsetDistance: node.offsetDistance,
    timeRemapValue: node.timeRemapValue,
    shapeData: cloneShapeData(node.shapeData),
    fillGradient: cloneGradient(node.fillGradient),
    strokeGradient: cloneGradient(node.strokeGradient),
    clipPath: cloneClipPath(node.clipPath),
    filter: cloneFilter(node.filter),
    boxShadow: cloneFilter(node.boxShadow),
  };
}

// Per-frame hot path.
export function resetNodeToBase(node: SceneNode): void {
  const b = node.base;
  copyTransform(b.transform, node.transform);
  node.zIndex = b.zIndex;
  node.displayNone = b.displayNone;
  node.fill = b.fill;
  node.stroke = b.stroke;
  node.strokeWidth = b.strokeWidth;
  node.opacity = b.opacity;
  node.trimStart = b.trimStart;
  node.trimEnd = b.trimEnd;
  node.trimOffset = b.trimOffset;
  node.strokeDashOffset = b.strokeDashOffset;
  node.offsetDistance = b.offsetDistance;
  node.timeRemapValue = b.timeRemapValue;
  Object.assign(node.shapeData, b.shapeData);
  // Fresh copies so per-frame morphs never touch the base.
  node.fillGradient = cloneGradient(b.fillGradient);
  node.strokeGradient = cloneGradient(b.strokeGradient);
  node.clipPath = cloneClipPath(b.clipPath);
  node.filter = cloneFilter(b.filter);
  node.boxShadow = cloneFilter(b.boxShadow);
}

export function createSceneNode(id: string, type: ShapeType): SceneNode {
  const node: Omit<SceneNode, "base"> = {
    id,
    type,
    parent: null,
    children: [],
    transform: createDefaultTransform(),
    fill: null,
    stroke: null,
    strokeWidth: 1,
    opacity: 1,
    trimStart: 0,
    trimEnd: 1,
    trimOffset: 0,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    strokeMiterLimit: 4,
    strokeDashArray: [],
    strokeDashOffset: 0,
    fillRule: "nonzero",
    paintOrder: "normal",
    mixBlendMode: "normal",
    pointerEvents: "auto",
    cachedOutlineLength: null,
    outlineLengthDirty: true,
    cachedTextBounds: null,
    textBoundsDirty: true,
    cachedPolystarCommands: null,
    polystarDirty: true,
    fillGradient: null,
    strokeGradient: null,
    clipPath: null,
    mask: null,
    isMaskSource: false,
    filter: null,
    boxShadow: null,
    offsetPath: null,
    offsetDistance: 0,
    offsetRotate: { auto: true, angle: 0 },
    timeOffset: 0,
    timeScale: 1,
    timeRemap: null,
    timeRemapValue: null,
    zIndex: 0,
    sortedChildren: null,
    displayNone: false,
    visibleFrom: -Infinity,
    visibleUntil: Infinity,
    hidden: false,
    shapeData: { type: "group" },
    animations: [],
    bindings: [],
    interactionState: "normal",
    hoverStyles: null,
    activeStyles: null,
    interactive: false,
    cursorPointer: false,
    transitions: [],
    stateChildren: [],
    stateStyles: [],
    animationTimeline: null,
    machines: [],
  };
  return { ...node, base: snapshotNode(node) };
}

// Ascending z-index, stable for ties; returns the same array when all are 0.
function sortByZIndex(children: SceneNode[]): SceneNode[] {
  for (let i = 0; i < children.length; i++) {
    if (children[i].zIndex !== 0) {
      return [...children].sort((a, b) => a.zIndex - b.zIndex);
    }
  }
  return children;
}

// Cache this frame's (possibly animated) sibling order.
export function refreshSortedChildren(node: SceneNode): void {
  node.sortedChildren = sortByZIndex(node.children);
}

// Cached paint order shared by render and hit-test; computes it before the first frame.
export function childrenInPaintOrder(node: SceneNode): SceneNode[] {
  return node.sortedChildren ?? sortByZIndex(node.children);
}
