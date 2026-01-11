import type { SceneNode, KeyframeData, Transform, AnimatableValue } from '../scene/types';
import { cloneTransform } from '../scene/types';
import { interpolateTransform, lerp } from '../scene/transform';
import { parseColor } from '../renderer/types';

/**
 * Interpolate between keyframes at a given progress (0-1)
 */
export function interpolateKeyframes(
  keyframes: KeyframeData[],
  progress: number,
  baseNode: SceneNode
): Partial<{
  transform: Transform;
  opacity: number;
  fill: string;
}> {
  if (keyframes.length === 0) {
    return {};
  }

  // Sort keyframes by offset
  const sorted = [...keyframes].sort((a, b) => a.offset - b.offset);

  // Clamp progress
  progress = Math.max(0, Math.min(1, progress));

  // Find surrounding keyframes
  let prevKeyframe = sorted[0];
  let nextKeyframe = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (progress >= sorted[i].offset && progress <= sorted[i + 1].offset) {
      prevKeyframe = sorted[i];
      nextKeyframe = sorted[i + 1];
      break;
    }
  }

  // Handle edge cases
  if (progress <= sorted[0].offset) {
    return applyKeyframeProperties(sorted[0].properties, baseNode);
  }
  if (progress >= sorted[sorted.length - 1].offset) {
    return applyKeyframeProperties(sorted[sorted.length - 1].properties, baseNode);
  }

  // Calculate local progress between keyframes
  const range = nextKeyframe.offset - prevKeyframe.offset;
  const localProgress = range > 0 ? (progress - prevKeyframe.offset) / range : 0;

  // Interpolate properties
  const result: Partial<{ transform: Transform; opacity: number; fill: string }> = {};

  // Interpolate transform
  const prevTransform = getTransformFromProperties(prevKeyframe.properties, baseNode.baseTransform);
  const nextTransform = getTransformFromProperties(nextKeyframe.properties, baseNode.baseTransform);
  result.transform = interpolateTransform(prevTransform, nextTransform, localProgress);

  // Interpolate opacity
  if ('opacity' in prevKeyframe.properties || 'opacity' in nextKeyframe.properties) {
    const prevOpacity = getOpacityFromProperties(prevKeyframe.properties, baseNode.baseOpacity);
    const nextOpacity = getOpacityFromProperties(nextKeyframe.properties, baseNode.baseOpacity);
    result.opacity = lerp(prevOpacity, nextOpacity, localProgress);
  }

  // Interpolate fill color
  if ('fill' in prevKeyframe.properties || 'fill' in nextKeyframe.properties) {
    const prevFill = getFillFromProperties(prevKeyframe.properties, baseNode.baseFill);
    const nextFill = getFillFromProperties(nextKeyframe.properties, baseNode.baseFill);
    if (prevFill && nextFill) {
      result.fill = interpolateColor(prevFill, nextFill, localProgress);
    }
  }

  return result;
}

function applyKeyframeProperties(
  properties: Record<string, AnimatableValue>,
  baseNode: SceneNode
): Partial<{ transform: Transform; opacity: number; fill: string }> {
  const result: Partial<{ transform: Transform; opacity: number; fill: string }> = {};

  if ('transform' in properties) {
    result.transform = properties.transform as Transform;
  } else {
    result.transform = cloneTransform(baseNode.baseTransform);
  }

  if ('opacity' in properties) {
    result.opacity = properties.opacity as number;
  }

  if ('fill' in properties) {
    result.fill = properties.fill as string;
  }

  return result;
}

function getTransformFromProperties(
  properties: Record<string, AnimatableValue>,
  baseTransform: Transform
): Transform {
  if ('transform' in properties) {
    return properties.transform as Transform;
  }

  // Build transform from individual properties
  const transform = cloneTransform(baseTransform);

  if ('translateX' in properties) transform.translateX = properties.translateX as number;
  if ('translateY' in properties) transform.translateY = properties.translateY as number;
  if ('rotate' in properties) transform.rotate = properties.rotate as number;
  if ('scaleX' in properties) transform.scaleX = properties.scaleX as number;
  if ('scaleY' in properties) transform.scaleY = properties.scaleY as number;
  if ('scale' in properties) {
    transform.scaleX = properties.scale as number;
    transform.scaleY = properties.scale as number;
  }

  return transform;
}

function getOpacityFromProperties(
  properties: Record<string, AnimatableValue>,
  baseOpacity: number
): number {
  if ('opacity' in properties) {
    return properties.opacity as number;
  }
  return baseOpacity;
}

function getFillFromProperties(
  properties: Record<string, AnimatableValue>,
  baseFill: string | null
): string | null {
  if ('fill' in properties) {
    return properties.fill as string;
  }
  return baseFill;
}

/**
 * Interpolate between two colors
 */
function interpolateColor(color1: string, color2: string, t: number): string {
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
