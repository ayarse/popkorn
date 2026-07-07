import { test, expect } from 'bun:test';
import type { Renderer } from '../renderer/interface';
import type { Color, PathCommand, GradientData, ResolvedClip, TrimDescriptor, Matrix3x3 } from '../renderer/types';
import { IDENTITY_MATRIX } from '../renderer/types';
import type { StrokeLineCap, TextAnchor, FillRule, MatteMode } from '../scene/types';
import { createSceneNode, snapshotNode } from '../scene/types';
import { RenderLoop } from './loop';

// Minimal no-op renderer that only records setOpacity calls, in draw order.
function createRecordingRenderer(): Renderer & { opacities: number[] } {
  return {
    opacities: [],
    clear() {},
    beginFrame() {},
    endFrame() {},
    drawRect() {},
    drawCircle() {},
    drawEllipse() {},
    drawPath(_c: PathCommand[]) {},
    drawText() {},
    drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMatte(_m: MatteMode, drawContent: () => void, drawMatte: () => void) {
      drawContent();
      drawMatte();
    },
    setFill(_c: Color | null) {},
    setFillGradient(_g: GradientData | null) {},
    setStroke(_c: Color | null, _w: number) {},
    setStrokeGradient(_g: GradientData | null) {},
    setStrokeLineCap(_c: StrokeLineCap) {},
    setStrokeLineJoin() {},
    setStrokeMiterLimit() {},
    setTrim(_t: TrimDescriptor | null) {},
    setDash() {},
    setFillRule(_r: FillRule) {},
    setPaintOrder() {},
    setOpacity(opacity: number) {
      this.opacities.push(opacity);
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform(_m: Matrix3x3) {},
    getWidth() { return 100; },
    getHeight() { return 100; },
  };
}

test('render walk: group opacity cascades multiplicatively to children', () => {
  const parent = createSceneNode('parent', 'group');
  parent.opacity = 0.5;
  parent.base = snapshotNode(parent);

  const child = createSceneNode('child', 'circle');
  child.shapeData = { type: 'circle', cx: 0, cy: 0, r: 10 };
  child.opacity = 0.6;
  child.base = snapshotNode(child);
  child.parent = parent;
  parent.children.push(child);

  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(parent);
  loop.seek(0); // resolves + draws one frame while stopped

  // Parent draws at its own opacity (0.5); child's effective opacity is the
  // product of the inherited parent alpha and its own opacity (0.5 * 0.6).
  expect(renderer.opacities[0]).toBeCloseTo(0.5, 6);
  expect(renderer.opacities[1]).toBeCloseTo(0.3, 6);
});
