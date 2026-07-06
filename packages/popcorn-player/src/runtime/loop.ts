import type { Renderer } from '../renderer/interface';
import type { SceneNode, RectData, CircleData, EllipseData, PathData, TextData, ImageData } from '../scene/types';
import type { TrimDescriptor, Matrix3x3 } from '../renderer/types';
import { IDENTITY_MATRIX, multiplyMatrices } from '../renderer/types';
import { resetNodeToBase } from '../scene/types';
import { computeLocalMatrix } from '../scene/transform';
import { outlineLength } from '../scene/path-parser';
import { polystarCommands } from '../scene/polystar';
import { resolveClip } from '../scene/clip';
import { AnimationScheduler } from '../animation/scheduler';
import { getPropHandler } from '../animation/registry';
import { InputTracker, createInputTracker } from './inputs';
import { VariableResolver, createVariableResolver } from './variables';
import { InteractionManager, createInteractionManager, applyInteractionOverrides } from './interaction';

/**
 * Main render loop.
 *
 * Drives requestAnimationFrame and, each frame, runs the value-resolution
 * pipeline per node: reset live fields to the authored base, then layer
 * bindings (var()/input()), animation (keyframe sampling at timeline time),
 * and interaction overrides (:hover/:active) — in that fixed order. The
 * renderer and hit-test read the resulting live fields unchanged.
 */
export class RenderLoop {
  private renderer: Renderer;
  private sceneRoot: SceneNode | null = null;
  private scheduler: AnimationScheduler;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private backgroundColor: string | null = null;
  private inputTracker: InputTracker;
  private variableResolver: VariableResolver;
  private interactionManager: InteractionManager;

  constructor(
    renderer: Renderer,
    scheduler?: AnimationScheduler,
    inputTracker?: InputTracker,
    variableResolver?: VariableResolver,
    interactionManager?: InteractionManager
  ) {
    this.renderer = renderer;
    this.scheduler = scheduler || new AnimationScheduler();
    this.inputTracker = inputTracker || createInputTracker();
    this.variableResolver = variableResolver || createVariableResolver();
    this.interactionManager = interactionManager || createInteractionManager();
  }

  getInputTracker(): InputTracker {
    return this.inputTracker;
  }

  getVariableResolver(): VariableResolver {
    return this.variableResolver;
  }

  getInteractionManager(): InteractionManager {
    return this.interactionManager;
  }

  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.interactionManager.setScene(root);
  }

  setBackgroundColor(color: string | null): void {
    this.backgroundColor = color;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduler.start();
    this.loop(performance.now());
  }

  stop(): void {
    this.isRunning = false;
    this.scheduler.stop();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  reset(): void {
    this.scheduler.reset();
    if (!this.isRunning) this.drawFrame(performance.now());
  }

  /** Freeze the timeline; the loop keeps running so interaction stays live. */
  pause(): void {
    this.scheduler.pause();
  }

  /** Resume the timeline from where it was paused. */
  resume(): void {
    this.scheduler.resume();
  }

  /** Jump to `ms` and render that instant — works while paused or stopped. */
  seek(ms: number): void {
    const now = performance.now();
    this.scheduler.seek(ms, now);
    if (!this.isRunning) this.drawFrame(now);
  }

  /** Current timeline time in milliseconds. */
  get currentTime(): number {
    return this.scheduler.time();
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    // Update input state
    this.inputTracker.update(timestamp);
    this.variableResolver.updateInputState(this.inputTracker.getState());

    // Update interaction state (hover, active)
    this.interactionManager.update(this.inputTracker.getState());

    // Resolve the whole scene at the current timeline time, then paint.
    this.drawFrame(timestamp);

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  /** Resolve every node's live values at the current timeline time and render. */
  private drawFrame(now: number): void {
    if (this.sceneRoot) {
      const t = this.scheduler.time(now);
      this.resolveNode(this.sceneRoot, t);
    }
    this.render();
  }

  /**
   * Value-resolution pipeline for one node:
   * base -> bindings -> animation -> interaction overrides.
   */
  private resolveNode(node: SceneNode, t: number): void {
    // Per-subtree time scoping: shift then scale the inherited time into this
    // node's local timeline, which applies to the node and all descendants.
    // Nested scopes compose because the scoped time is what recurses down.
    // Defaults (0, 1) leave `t` unchanged.
    const local = (t - node.timeOffset) * node.timeScale;

    resetNodeToBase(node);
    this.applyBindings(node);
    this.scheduler.sampleNode(node, local);
    applyInteractionOverrides(node);

    for (const child of node.children) {
      this.resolveNode(child, local);
    }
  }

  private applyBindings(node: SceneNode): void {
    for (const binding of node.bindings) {
      const handler = getPropHandler(binding.property);
      // Bindings resolve to numbers; skip anything without a numeric handler.
      if (!handler || handler.kind !== 'number') continue;
      handler.apply(node, this.variableResolver.resolveNumeric(binding.value));
    }
  }

  private render(): void {
    this.renderer.beginFrame();

    // Draw background
    if (this.backgroundColor) {
      this.renderer.setFill(this.backgroundColor);
      this.renderer.setFillGradient(null);
      this.renderer.setStroke(null, 0);
      this.renderer.setStrokeGradient(null);
      this.renderer.setTrim(null);
      this.renderer.drawRect(0, 0, this.renderer.getWidth(), this.renderer.getHeight());
    }

    // Render scene graph
    if (this.sceneRoot) {
      this.renderNode(this.sceneRoot);
    }

    this.renderer.endFrame();
  }

  private renderNode(node: SceneNode, isolated: boolean = false, inheritedAlpha: number = 1): void {
    // In the normal walk, a matte source is painted only via its dependent's
    // composite (below), and a node with a matte is composited offscreen. The
    // isolated passes that feed those composites bypass both (isolated = true).
    if (!isolated) {
      if (node.isMatteSource) return;
      if (node.matte) { this.renderMatte(node); return; }
    }

    this.renderer.save();

    // Cascade opacity: a group's opacity should dim its children too, so we
    // carry the accumulated product down the walk rather than setting each
    // node's opacity in isolation.
    // ponytail: this multiplies alpha per-node rather than compositing the
    // group offscreen and fading it as one, so overlapping children in a
    // translucent group show through each other (wrong per CSS/Lottie
    // semantics) — upgrade path is an offscreen group composite.
    const alpha = inheritedAlpha * node.opacity;

    // Apply the node's local transform (translate/rotate/scale around transform-origin).
    // Multiplying onto the current (parent) transform yields the world transform.
    this.renderer.transform(computeLocalMatrix(node));

    // Fill rule is set before the clip so a multi-path (union) mask clips with
    // the intended winding, then reused by the shape fill below.
    this.renderer.setFillRule(node.fillRule);

    // Clip this node and its descendants (applied in local space, after the
    // transform, before drawing — the save/restore below brackets it).
    const clip = resolveClip(node);
    if (clip) this.renderer.clip(clip);

    // Set style
    this.renderer.setFill(node.fill);
    this.renderer.setFillGradient(node.fillGradient);
    this.renderer.setStroke(node.stroke, node.strokeWidth);
    this.renderer.setStrokeGradient(node.strokeGradient);
    this.renderer.setStrokeLineCap(node.strokeLineCap);
    this.renderer.setTrim(computeTrim(node));
    this.renderer.setDash(node.strokeDashArray, node.strokeDashOffset);
    this.renderer.setOpacity(alpha);

    // Draw shape
    switch (node.shapeData.type) {
      case 'rect': {
        const r = node.shapeData as RectData;
        this.renderer.drawRect(r.x, r.y, r.width, r.height, r.rx, r.ry);
        break;
      }
      case 'circle': {
        const c = node.shapeData as CircleData;
        this.renderer.drawCircle(c.cx, c.cy, c.r);
        break;
      }
      case 'ellipse': {
        const e = node.shapeData as EllipseData;
        this.renderer.drawEllipse(e.cx, e.cy, e.rx, e.ry);
        break;
      }
      case 'path': {
        const p = node.shapeData as PathData;
        this.renderer.drawPath(p.commands);
        break;
      }
      case 'star':
      case 'polygon':
        this.renderer.drawPath(polystarCommands(node));
        break;
      case 'text': {
        const t = node.shapeData as TextData;
        this.renderer.drawText(t.content, t.x, t.y, t.fontSize, t.fontFamily, t.fontWeight, t.anchor);
        break;
      }
      case 'image': {
        const im = node.shapeData as ImageData;
        this.renderer.drawImage(im.src, im.x, im.y, im.width, im.height);
        break;
      }
      case 'group':
        // Groups don't render themselves, just their children
        break;
    }

    // Render children
    for (const child of node.children) {
      this.renderNode(child, false, alpha);
    }

    this.renderer.restore();
  }

  /**
   * Composite a node against its track-matte source. Both subtrees are rendered
   * in the canvas-root frame (each closure re-establishes its own world
   * transform), so alignment is exact regardless of where the source lives.
   */
  private renderMatte(node: SceneNode): void {
    const source = node.matte!.source;
    const contentParent = worldMatrix(node.parent);
    const matteParent = worldMatrix(source.parent);
    const contentAlpha = worldAlpha(node.parent);
    const matteAlpha = worldAlpha(source.parent);
    this.renderer.compositeMatte(
      node.matte!.mode,
      () => { this.renderer.setTransform(contentParent); this.renderNode(node, true, contentAlpha); },
      () => { this.renderer.setTransform(matteParent); this.renderNode(source, true, matteAlpha); }
    );
  }
}

/** World matrix of a node by folding local matrices down from the root. */
function worldMatrix(node: SceneNode | null): Matrix3x3 {
  if (!node) return IDENTITY_MATRIX;
  const chain: SceneNode[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) chain.push(n);
  let m = IDENTITY_MATRIX;
  for (let i = chain.length - 1; i >= 0; i--) m = multiplyMatrices(m, computeLocalMatrix(chain[i]));
  return m;
}

/** Accumulated (multiplied) opacity of a node's ancestor chain, root down to `node` inclusive. */
function worldAlpha(node: SceneNode | null): number {
  let alpha = 1;
  for (let n: SceneNode | null = node; n; n = n.parent) alpha *= n.opacity;
  return alpha;
}

export function createRenderLoop(renderer: Renderer, scheduler?: AnimationScheduler): RenderLoop {
  return new RenderLoop(renderer, scheduler);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Resolve a node's trim-* fractions into a stroke dash descriptor, or null when
 * the whole outline is stroked (the common, untrimmed case). Inputs are clamped
 * to [0,1]; start >= end yields an empty (invisible) stroke. The dash pattern
 * [visible, hidden] plus a negative dashOffset naturally handles wrap-around for
 * closed shapes (marching via trim-offset).
 */
export function computeTrim(node: SceneNode): TrimDescriptor | null {
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);

  // Untrimmed: stroke the whole outline, no dashing needed.
  if (start <= 0 && end >= 1 && offset === 0) return null;

  const total = outlineLength(node);
  if (total <= 0) return null;

  // Empty window -> nothing to stroke.
  if (end <= start) return { visible: false, dashArray: [], dashOffset: 0 };

  // Full window (offset has no visible effect when everything is drawn).
  if (start <= 0 && end >= 1) return { visible: true, dashArray: [], dashOffset: 0 };

  const visible = (end - start) * total;
  return {
    visible: true,
    dashArray: [visible, total - visible],
    dashOffset: -(start + offset) * total,
  };
}
