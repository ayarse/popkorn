import type { Renderer } from '../renderer/interface';
import type { SceneNode, RectData, CircleData, EllipseData, PathData } from '../scene/types';
import { AnimationScheduler } from '../animation/scheduler';
import { InputTracker, createInputTracker } from './inputs';
import { VariableResolver, createVariableResolver } from './variables';

/**
 * Main render loop
 * Coordinates animation updates and scene rendering
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

  constructor(
    renderer: Renderer,
    scheduler?: AnimationScheduler,
    inputTracker?: InputTracker,
    variableResolver?: VariableResolver
  ) {
    this.renderer = renderer;
    this.scheduler = scheduler || new AnimationScheduler();
    this.inputTracker = inputTracker || createInputTracker();
    this.variableResolver = variableResolver || createVariableResolver();
  }

  getInputTracker(): InputTracker {
    return this.inputTracker;
  }

  getVariableResolver(): VariableResolver {
    return this.variableResolver;
  }

  setScene(root: SceneNode): void {
    this.sceneRoot = root;
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
    if (this.sceneRoot) {
      this.scheduler.reset(this.sceneRoot);
    }
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    // Update input state
    this.inputTracker.update(timestamp);
    this.variableResolver.updateInputState(this.inputTracker.getState());

    // Update animations
    if (this.sceneRoot) {
      this.scheduler.update(this.sceneRoot, timestamp);
    }

    // Resolve variable bindings before rendering
    if (this.sceneRoot) {
      this.resolveBindings(this.sceneRoot);
    }

    // Render frame
    this.render();

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private resolveBindings(node: SceneNode): void {
    // Resolve any variable bindings on this node
    for (const binding of node.bindings) {
      const value = this.variableResolver.resolveNumeric(binding.value);
      this.applyResolvedBinding(node, binding.property, value);
    }

    // Recursively process children
    for (const child of node.children) {
      this.resolveBindings(child);
    }
  }

  private applyResolvedBinding(node: SceneNode, property: string, value: number): void {
    switch (property) {
      case 'opacity':
        node.opacity = value;
        break;
      case 'x':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).x = value;
        }
        break;
      case 'y':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).y = value;
        }
        break;
      case 'width':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).width = value;
        }
        break;
      case 'height':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).height = value;
        }
        break;
      case 'cx':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cx = value;
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cx = value;
        }
        break;
      case 'cy':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).cy = value;
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).cy = value;
        }
        break;
      case 'r':
        if (node.shapeData.type === 'circle') {
          (node.shapeData as CircleData).r = value;
        }
        break;
      case 'rx':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).rx = value;
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).rx = value;
        }
        break;
      case 'ry':
        if (node.shapeData.type === 'rect') {
          (node.shapeData as RectData).ry = value;
        } else if (node.shapeData.type === 'ellipse') {
          (node.shapeData as EllipseData).ry = value;
        }
        break;
      // Transform properties
      case 'translateX':
        node.transform.translateX = value;
        break;
      case 'translateY':
        node.transform.translateY = value;
        break;
      case 'rotate':
        node.transform.rotate = value;
        break;
      case 'scaleX':
        node.transform.scaleX = value;
        break;
      case 'scaleY':
        node.transform.scaleY = value;
        break;
    }
  }

  private render(): void {
    this.renderer.beginFrame();

    // Draw background
    if (this.backgroundColor) {
      this.renderer.setFill(this.backgroundColor);
      this.renderer.setStroke(null, 0);
      this.renderer.drawRect(0, 0, this.renderer.getWidth(), this.renderer.getHeight());
    }

    // Render scene graph
    if (this.sceneRoot) {
      this.renderNode(this.sceneRoot);
    }

    this.renderer.endFrame();
  }

  private renderNode(node: SceneNode): void {
    this.renderer.save();

    // Calculate the resolved transform origin in pixels
    const { originX, originY } = this.resolveTransformOrigin(node);

    // Apply transform-origin: translate to origin, apply transforms, translate back
    // CSS transform order: translate -> (move to origin -> rotate/scale -> move back from origin)
    this.renderer.translate(node.transform.translateX, node.transform.translateY);

    // Move to origin point, apply rotation/scale, move back
    if (originX !== 0 || originY !== 0) {
      this.renderer.translate(originX, originY);
    }
    this.renderer.rotate(node.transform.rotate * Math.PI / 180);
    this.renderer.scale(node.transform.scaleX, node.transform.scaleY);
    if (originX !== 0 || originY !== 0) {
      this.renderer.translate(-originX, -originY);
    }

    // Set style
    this.renderer.setFill(node.fill);
    this.renderer.setStroke(node.stroke, node.strokeWidth);
    this.renderer.setOpacity(node.opacity);

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
      case 'group':
        // Groups don't render themselves, just their children
        break;
    }

    // Render children
    for (const child of node.children) {
      this.renderNode(child);
    }

    this.renderer.restore();
  }

  /**
   * Resolve transform-origin to pixel values based on the shape's bounding box
   * For percentage values, calculate relative to the shape's dimensions
   */
  private resolveTransformOrigin(node: SceneNode): { originX: number; originY: number } {
    const origin = node.transform.transformOrigin;
    const bounds = this.getShapeBounds(node);

    const originX = this.resolveOriginValue(origin.x, bounds.x, bounds.width);
    const originY = this.resolveOriginValue(origin.y, bounds.y, bounds.height);

    return { originX, originY };
  }

  private resolveOriginValue(
    value: { value: number; unit: 'px' | '%' },
    offset: number,
    dimension: number
  ): number {
    if (value.unit === '%') {
      // Percentage is relative to the shape's bounding box
      return offset + (value.value / 100) * dimension;
    } else {
      // Pixel values are absolute (relative to shape's local coordinate space)
      return value.value;
    }
  }

  /**
   * Get the bounding box of a shape in local coordinates
   */
  private getShapeBounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
    switch (node.shapeData.type) {
      case 'rect': {
        const r = node.shapeData as RectData;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      case 'circle': {
        const c = node.shapeData as CircleData;
        return {
          x: c.cx - c.r,
          y: c.cy - c.r,
          width: c.r * 2,
          height: c.r * 2,
        };
      }
      case 'ellipse': {
        const e = node.shapeData as EllipseData;
        return {
          x: e.cx - e.rx,
          y: e.cy - e.ry,
          width: e.rx * 2,
          height: e.ry * 2,
        };
      }
      case 'path': {
        // For paths, we would need to compute the bounding box from commands
        // For now, return a default (0,0) origin with zero dimensions
        // This means percentages will evaluate to 0 for paths
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      case 'group':
      default:
        // Groups have no intrinsic size, so percentages evaluate to 0
        return { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}

export function createRenderLoop(renderer: Renderer, scheduler?: AnimationScheduler): RenderLoop {
  return new RenderLoop(renderer, scheduler);
}
