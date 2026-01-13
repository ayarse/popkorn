# Motion Scene Graph PoC

## Design Document

**Version:** 0.1  
**Date:** January 2025  
**Status:** Draft

---

## 1. Overview

### 1.1 What We're Building

A CSS-like declarative language for defining interactive, real-time motion graphics that render directly to screen.

Think of it as: **"CSS Animations, but for a proper scene graph with real-time interactivity"**

For the PoC, we render via Canvas 2D. The architecture supports swapping to ThorVG later for cross-platform deployment (iOS, Android, embedded systems).

### 1.2 The Problem

Current options for interactive motion graphics fall into two camps:

| Approach | Pros | Cons |
|----------|------|------|
| **Lottie** | Designer-friendly, wide ecosystem | Playback only, no real-time interaction |
| **Game engines** | Full interactivity, physics, constraints | Heavy, complex, overkill for UI motion |
| **CSS Animations** | Familiar syntax, declarative | Tied to DOM, limited to web, no scene graph |
| **Rive** | Interactive, cross-platform | Proprietary editor, closed format |

**Gap:** No lightweight, declarative, cross-platform solution with:
- Familiar CSS-like syntax
- True scene graph with parent-child transforms
- Real-time input binding (cursor, touch, scroll)
- Direct rendering (no DOM dependency)

### 1.3 Goal of This PoC

Prove the concept works by building a minimal pipeline:

```
CSS-like source → Parser → AST → Scene Graph → Renderer → Canvas
```

We use **Canvas 2D** for the PoC to iterate quickly, but design the renderer interface to be **ThorVG-compatible** so we can swap to ThorVG later for cross-platform support (iOS, Android, embedded).

Success criteria:
- Parse a subset of CSS
- Render shapes to canvas via abstracted renderer
- Animate using @keyframes
- (Stretch) Respond to cursor position
- Renderer interface can swap Canvas2D ↔ ThorVG with no scene graph changes

---

## 2. Technical Approach

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                TypeScript Runtime                 │   │
│  │                                                   │   │
│  │  ┌─────────┐   ┌─────────┐   ┌────────────────┐  │   │
│  │  │ Parser  │ → │   AST   │ → │  Scene Graph   │  │   │
│  │  │ (CSS)   │   │         │   │   Manager      │  │   │
│  │  └─────────┘   └─────────┘   └───────┬────────┘  │   │
│  │                                      │           │   │
│  │  ┌─────────────────┐    ┌────────────▼────────┐  │   │
│  │  │  Input System   │ →  │   Animation Loop    │  │   │
│  │  │ (cursor, time)  │    │ (requestAnimFrame)  │  │   │
│  │  └─────────────────┘    └────────────┬────────┘  │   │
│  │                                      │           │   │
│  │                         ┌────────────▼────────┐  │   │
│  │                         │ Renderer Interface  │  │   │
│  │                         │  (ThorVG-style)     │  │   │
│  │                         └────────────┬────────┘  │   │
│  │                                      │           │   │
│  └──────────────────────────────────────┼───────────┘   │
│                                         │               │
│  ┌──────────────────────────────────────▼───────────┐   │
│  │         Canvas2DRenderer (PoC)                    │   │
│  │    [Future: ThorVGRenderer via WASM]              │   │
│  └──────────────────────────────────────┬───────────┘   │
│                                         │               │
│  ┌──────────────────────────────────────▼───────────┐   │
│  │              <canvas> element                     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Why This Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Parser | TypeScript (postcss or custom) | Fast iteration, good tooling |
| Scene Graph | TypeScript | Tight integration with animation/input |
| Renderer | **Canvas 2D** (PoC) → ThorVG (later) | Zero deps for PoC, swap later for cross-platform |
| Abstraction | ThorVG-style API | Future-proof, familiar pattern |

### 2.3 Why Canvas 2D for PoC?

- **Zero dependencies**: Works in any browser immediately
- **Fast iteration**: No WASM compilation step
- **Sufficient for validation**: Proves the DSL → render pipeline works
- **Easy to swap**: Renderer interface isolates implementation details

### 2.4 Future ThorVG Migration Path

When cross-platform is needed:
1. Build ThorVG WASM with Emscripten
2. Implement `ThorVGRenderer` class with same interface
3. Swap `new Canvas2DRenderer()` → `new ThorVGRenderer()`
4. Everything else stays the same

---

## 3. DSL Design (CSS Subset for PoC)

### 3.1 Supported Syntax

For the PoC, we support a strict subset of CSS plus minimal extensions.

#### Selectors

```css
/* ID selector */
#myShape { }

/* Class selector */
.circle { }

/* No combinators, pseudo-classes, or attribute selectors in PoC */
```

#### Type Definition (Extension)

Since CSS doesn't define shape types, we add a `type` property:

```css
#background {
  type: rect;
  width: 800px;
  height: 600px;
  fill: #1a1a2e;
}

.dot {
  type: circle;
  cx: 100px;
  cy: 100px;
  r: 20px;
  fill: #e94560;
}

.path {
  type: path;
  d: "M 10 10 L 50 50 L 10 50 Z";
  fill: none;
  stroke: #ffffff;
  stroke-width: 2px;
}
```

#### Supported Shape Types

| Shape | Properties |
|-------|------------|
| `rect` | `x`, `y`, `width`, `height`, `rx`, `ry` (for rounded corners) |
| `circle` | `cx`, `cy`, `r` |
| `ellipse` | `cx`, `cy`, `rx`, `ry` |
| `path` | `d` (SVG path syntax) |

#### Transform

```css
.element {
  transform: translate(100px, 50px) rotate(45deg) scale(1.5);
}
```

#### Fill & Stroke

```css
.element {
  fill: #ff0000;
  fill: rgb(255, 0, 0);
  fill: rgba(255, 0, 0, 0.5);
  stroke: #000000;
  stroke-width: 2px;
  opacity: 0.8;
}
```

#### Animation

```css
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.spinner {
  animation: spin 2s linear infinite;
}
```

Animation properties:
- `animation-name`
- `animation-duration`
- `animation-timing-function` (linear, ease, ease-in, ease-out, ease-in-out)
- `animation-iteration-count` (number or `infinite`)
- `animation-direction` (normal, reverse, alternate)
- Shorthand: `animation: name duration timing-function iteration-count direction`

### 3.2 Not Supported in PoC

- Nested selectors
- Media queries
- CSS variables (`var(--x)`) — Phase 2
- `calc()`
- Gradients
- Filters/effects
- Text
- Images
- Custom input bindings — Phase 3

### 3.3 Scene Hierarchy

Hierarchy is defined by nesting in a special block syntax (extension):

```css
#container {
  type: group;
  transform: translate(100px, 100px);
  
  > #child1 {
    type: circle;
    cx: 0;
    cy: 0;
    r: 50px;
  }
  
  > #child2 {
    type: rect;
    x: 60px;
    y: -25px;
    width: 100px;
    height: 50px;
  }
}
```

**Alternative approach:** Use a separate structure definition (JSON or dedicated syntax) and CSS purely for styling. This is cleaner but more complex. For PoC, the nested syntax keeps everything in one file.

---

## 4. AST Design

### 4.1 Node Types

```typescript
interface StyleSheet {
  type: 'stylesheet';
  rules: Rule[];
  keyframes: KeyframeRule[];
}

interface Rule {
  type: 'rule';
  selector: Selector;
  declarations: Declaration[];
  children?: Rule[];  // For nested rules (hierarchy)
}

interface Selector {
  type: 'id' | 'class';
  name: string;
}

interface Declaration {
  type: 'declaration';
  property: string;
  value: Value;
}

type Value = 
  | { type: 'length'; value: number; unit: 'px' | 'deg' | '%' }
  | { type: 'color'; value: string }  // Normalized to hex or rgba
  | { type: 'keyword'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'function'; name: string; args: Value[] };

interface KeyframeRule {
  type: 'keyframes';
  name: string;
  blocks: KeyframeBlock[];
}

interface KeyframeBlock {
  type: 'keyframe-block';
  selectors: number[];  // Percentages: [0, 100] or [50]
  declarations: Declaration[];
}
```

### 4.2 Example

Input:
```css
@keyframes fade {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

#box {
  type: rect;
  width: 100px;
  height: 100px;
  fill: #ff0000;
  animation: fade 1s ease-in-out infinite;
}
```

AST:
```json
{
  "type": "stylesheet",
  "keyframes": [
    {
      "type": "keyframes",
      "name": "fade",
      "blocks": [
        {
          "selectors": [0],
          "declarations": [
            { "property": "opacity", "value": { "type": "number", "value": 0 } }
          ]
        },
        {
          "selectors": [100],
          "declarations": [
            { "property": "opacity", "value": { "type": "number", "value": 1 } }
          ]
        }
      ]
    }
  ],
  "rules": [
    {
      "type": "rule",
      "selector": { "type": "id", "name": "box" },
      "declarations": [
        { "property": "type", "value": { "type": "keyword", "value": "rect" } },
        { "property": "width", "value": { "type": "length", "value": 100, "unit": "px" } },
        { "property": "height", "value": { "type": "length", "value": 100, "unit": "px" } },
        { "property": "fill", "value": { "type": "color", "value": "#ff0000" } },
        { "property": "animation", "value": { "type": "string", "value": "fade 1s ease-in-out infinite" } }
      ]
    }
  ]
}
```

---

## 5. Scene Graph Design

### 5.1 Node Structure

```typescript
interface SceneNode {
  id: string;
  type: 'group' | 'rect' | 'circle' | 'ellipse' | 'path';
  
  // Hierarchy
  parent: SceneNode | null;
  children: SceneNode[];
  
  // Transform (local, relative to parent)
  transform: {
    translateX: number;
    translateY: number;
    rotate: number;       // degrees
    scaleX: number;
    scaleY: number;
    anchorX: number;      // pivot point
    anchorY: number;
  };
  
  // Appearance
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  
  // Shape-specific
  shapeData: RectData | CircleData | EllipseData | PathData;
  
  // Animation state
  animations: AnimationInstance[];
}

interface RectData {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

interface CircleData {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

// ... etc
```

### 5.2 Animation Instance

```typescript
interface AnimationInstance {
  keyframes: KeyframeRule;
  duration: number;         // ms
  timingFunction: TimingFunction;
  iterationCount: number;   // Infinity for infinite
  direction: 'normal' | 'reverse' | 'alternate';
  
  // Runtime state
  startTime: number;
  currentTime: number;
}

type TimingFunction = 
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { type: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number };
```

---

## 6. Renderer Abstraction (ThorVG-Compatible)

### 6.1 Design Decision

For the PoC, we use **Canvas 2D API** for rendering, but wrap it in an abstraction layer that mirrors ThorVG's API style. This allows us to:

1. Get a working prototype quickly (no WASM compilation)
2. Swap to ThorVG later for cross-platform support
3. Keep the scene graph renderer-agnostic

### 6.2 Renderer Interface

```typescript
// Abstract renderer interface (ThorVG-style)
interface Renderer {
  clear(): void;
  beginFrame(): void;
  endFrame(): void;
  
  // Shape rendering
  drawRect(x: number, y: number, w: number, h: number, rx?: number, ry?: number): void;
  drawCircle(cx: number, cy: number, r: number): void;
  drawEllipse(cx: number, cy: number, rx: number, ry: number): void;
  drawPath(commands: PathCommand[]): void;
  
  // Style (called before draw)
  setFill(color: Color): void;
  setStroke(color: Color, width: number): void;
  setOpacity(opacity: number): void;
  
  // Transform stack (like ThorVG's transform())
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;  // radians
  scale(sx: number, sy: number): void;
  setTransform(matrix: Matrix3x3): void;
}
```

### 6.3 Canvas2D Implementation

```typescript
class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private fillColor: string = '#000000';
  private strokeColor: string | null = null;
  private strokeWidth: number = 1;
  private currentOpacity: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  beginFrame(): void {
    this.clear();
  }

  endFrame(): void {
    // No-op for Canvas2D (immediate mode)
  }

  drawRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): void {
    this.ctx.beginPath();
    if (rx > 0 || ry > 0) {
      this.ctx.roundRect(x, y, w, h, [rx, ry]);
    } else {
      this.ctx.rect(x, y, w, h);
    }
    this.applyFillAndStroke();
  }

  drawCircle(cx: number, cy: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.applyFillAndStroke();
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.applyFillAndStroke();
  }

  drawPath(commands: PathCommand[]): void {
    this.ctx.beginPath();
    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M': this.ctx.moveTo(cmd.x, cmd.y); break;
        case 'L': this.ctx.lineTo(cmd.x, cmd.y); break;
        case 'C': this.ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
        case 'Q': this.ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
        case 'Z': this.ctx.closePath(); break;
      }
    }
    this.applyFillAndStroke();
  }

  setFill(color: Color): void {
    this.fillColor = colorToCSS(color);
  }

  setStroke(color: Color, width: number): void {
    this.strokeColor = colorToCSS(color);
    this.strokeWidth = width;
  }

  setOpacity(opacity: number): void {
    this.currentOpacity = opacity;
    this.ctx.globalAlpha = opacity;
  }

  save(): void { this.ctx.save(); }
  restore(): void { this.ctx.restore(); }
  translate(x: number, y: number): void { this.ctx.translate(x, y); }
  rotate(angle: number): void { this.ctx.rotate(angle); }
  scale(sx: number, sy: number): void { this.ctx.scale(sx, sy); }
  
  setTransform(m: Matrix3x3): void {
    this.ctx.setTransform(m[0], m[1], m[3], m[4], m[6], m[7]);
  }

  private applyFillAndStroke(): void {
    if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fill();
    }
    if (this.strokeColor) {
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.stroke();
    }
  }
}
```

### 6.4 Future ThorVG Implementation (Placeholder)

When we need cross-platform support, we implement the same interface:

```typescript
class ThorVGRenderer implements Renderer {
  private canvas: ThorVGCanvas;  // WASM binding
  private currentShape: ThorVGShape | null = null;

  drawRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): void {
    const shape = this.canvas.createShape();
    shape.appendRect(x, y, w, h, rx, ry);
    shape.fill(this.fillColor.r, this.fillColor.g, this.fillColor.b);
    this.canvas.push(shape);
  }
  
  // ... etc
}
```

### 6.5 Mapping to ThorVG API Style

| Our Renderer | ThorVG Equivalent | Canvas2D Equivalent |
|--------------|-------------------|---------------------|
| `drawRect()` | `Shape::appendRect()` | `ctx.rect()` + `fill()`/`stroke()` |
| `drawCircle()` | `Shape::appendCircle()` | `ctx.arc()` + `fill()`/`stroke()` |
| `drawPath()` | `Shape::appendPath()` | `ctx.beginPath()` + commands |
| `setFill()` | `Shape::fill(r,g,b)` | `ctx.fillStyle` |
| `setStroke()` | `Shape::stroke(r,g,b)` | `ctx.strokeStyle` |
| `setOpacity()` | `Paint::opacity()` | `ctx.globalAlpha` |
| `save()`/`restore()` | `Paint::transform()` | `ctx.save()`/`restore()` |

### 6.6 Render Loop

```typescript
function renderLoop(timestamp: number) {
  // 1. Update animations
  animationScheduler.update(timestamp);
  
  // 2. Compute world transforms (parent → child propagation)
  sceneGraph.computeWorldTransforms();
  
  // 3. Render scene graph
  renderer.beginFrame();
  renderNode(sceneGraph.root, renderer);
  renderer.endFrame();
  
  requestAnimationFrame(renderLoop);
}

function renderNode(node: SceneNode, renderer: Renderer): void {
  renderer.save();
  
  // Apply local transform
  renderer.translate(node.transform.translateX, node.transform.translateY);
  renderer.rotate(node.transform.rotate * Math.PI / 180);
  renderer.scale(node.transform.scaleX, node.transform.scaleY);
  
  // Set style
  if (node.fill) renderer.setFill(node.fill);
  if (node.stroke) renderer.setStroke(node.stroke, node.strokeWidth);
  renderer.setOpacity(node.opacity);
  
  // Draw shape
  switch (node.shapeData.type) {
    case 'rect':
      const r = node.shapeData as RectData;
      renderer.drawRect(r.x, r.y, r.width, r.height, r.rx, r.ry);
      break;
    case 'circle':
      const c = node.shapeData as CircleData;
      renderer.drawCircle(c.cx, c.cy, c.r);
      break;
    // ... etc
  }
  
  // Render children
  for (const child of node.children) {
    renderNode(child, renderer);
  }
  
  renderer.restore();
}

---

## 7. Implementation Phases

### Phase 1: Static Rendering

**Goal:** Parse CSS, render static shapes to canvas.

**Tasks:**
1. Set up project (TypeScript, Vite)
2. Define renderer interface (ThorVG-style)
3. Implement Canvas2DRenderer
4. Write/integrate CSS parser
5. Build AST types
6. Build AST → Scene Graph transformer
7. Implement render loop (scene graph traversal)
8. Render a static scene

**Demo:**
```css
#bg { type: rect; width: 400px; height: 300px; fill: #1a1a2e; }
#dot { type: circle; cx: 200px; cy: 150px; r: 30px; fill: #e94560; }
```
→ Red circle on dark background

**Estimated effort:** 2-3 days

---

### Phase 2: Animation

**Goal:** Support `@keyframes` and animation playback.

**Tasks:**
1. Parse `@keyframes` rules
2. Parse `animation` shorthand property
3. Implement keyframe interpolation
4. Implement easing functions
5. Build animation scheduler
6. Integrate with render loop

**Demo:**
```css
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

#dot {
  type: circle;
  cx: 200px; cy: 150px; r: 30px;
  fill: #e94560;
  animation: pulse 1.5s ease-in-out infinite;
}
```
→ Pulsing circle

**Estimated effort:** 2-3 days

---

### Phase 3: Input Bindings (Stretch)

**Goal:** Bind element properties to cursor position.

**Tasks:**
1. Track cursor position
2. Implement CSS variables (`var(--cursor-x)`)
3. Implement `input()` function
4. Update variables each frame

**Demo:**
```css
:root {
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

#follower {
  type: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 20px;
  fill: #e94560;
}
```
→ Circle follows cursor

**Estimated effort:** 2-3 days

---

## 8. Project Structure

```
motion-graph-poc/
├── src/
│   ├── index.ts              # Entry point
│   ├── parser/
│   │   ├── lexer.ts          # Tokenizer
│   │   ├── parser.ts         # CSS parser
│   │   └── ast.ts            # AST type definitions
│   ├── scene/
│   │   ├── types.ts          # Scene graph types
│   │   ├── builder.ts        # AST → Scene Graph
│   │   └── transform.ts      # Transform math
│   ├── animation/
│   │   ├── keyframes.ts      # Keyframe interpolation
│   │   ├── easing.ts         # Easing functions
│   │   └── scheduler.ts      # Animation timing
│   ├── runtime/
│   │   ├── loop.ts           # Main render loop
│   │   └── inputs.ts         # Input tracking
│   └── renderer/
│       ├── interface.ts      # Renderer interface (ThorVG-style)
│       ├── canvas2d.ts       # Canvas 2D implementation
│       ├── types.ts          # Color, PathCommand, Matrix types
│       └── thorvg.ts         # Future ThorVG implementation (placeholder)
├── public/
│   └── index.html
├── examples/
│   ├── static.css
│   ├── animation.css
│   └── interactive.css
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 9. Open Questions

1. **Parser choice:** Write custom lexer/parser or use `postcss` with extensions?
   - Custom: Full control, educational, more work
   - PostCSS: Battle-tested, plugin system, might fight against extensions
   - **Leaning:** Start with custom minimal parser for shape/transform subset

2. **Hierarchy syntax:** Nested CSS (shown above) or separate structure file?
   - Nested: Single file, compact
   - Separate: Cleaner separation, more verbose
   - **Leaning:** Nested for PoC simplicity

3. **Hot reload:** Important for PoC demo. Vite's HMR should handle this well.

4. ~~**ThorVG bindings:**~~ **Resolved:** Using Canvas 2D for PoC with ThorVG-style abstraction layer.

5. ~~**Canvas vs WebGL:**~~ **Resolved:** Canvas 2D for PoC, can add WebGL/ThorVG backends later.

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Parse time | < 10ms for 100-line file |
| Frame rate | 60fps with 50 animated shapes |
| Bundle size | < 50KB (minified, no deps) |
| API surface | < 10 public functions |
| Demo complexity | At least: 5 shapes, 2 animations, hierarchy |
| Renderer swap | ThorVG can replace Canvas2D with no scene graph changes |

---

## 11. References

- [ThorVG GitHub](https://github.com/thorvg/thorvg) - Target renderer for cross-platform
- [ThorVG API Docs](https://www.thorvg.org/apis) - API style reference
- [Canvas 2D API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
- [CSS Animations Spec](https://www.w3.org/TR/css-animations-1/)
- [Lottie Format](https://lottiefiles.github.io/lottie-docs/)
- [Rive](https://rive.app/) - Comparable interactive motion tool

---

## Appendix A: Example Full Scene

```css
/* Canvas setup */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Keyframes */
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-20px); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Scene */
#center-group {
  type: group;
  transform: translate(400px, 300px);
  
  > #orbit {
    type: group;
    animation: spin 8s linear infinite;
    
    > #planet {
      type: circle;
      cx: 150px;
      cy: 0;
      r: 20px;
      fill: #4ecdc4;
      animation: float 2s ease-in-out infinite;
    }
  }
  
  > #sun {
    type: circle;
    cx: 0;
    cy: 0;
    r: 50px;
    fill: #ffe66d;
  }
}
```

This would render an orbiting planet around a sun, with the planet also bobbing up and down.
