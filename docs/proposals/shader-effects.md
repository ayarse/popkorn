# Shader Effects

Status: proposal, not yet implemented.

## The idea

Popkorn's `filter` property already applies the standard CSS filter functions
to a node and its subtree: the subtree is composited offscreen and blitted back
through the filter. Shader effects extend that same seam with one new filter
function, `effect()`, whose behavior is defined by the author in GLSL instead
of picked from the built-in list.

An effect is a pure function: content pixels and uniform values in, pixels out.
No hidden state, no feedback buffers. Given the same frame and the same inputs,
an effect renders identically, which keeps `seek(t)` deterministic. The only
nondeterminism enters where it already does today: uniforms bound to `input()`.

The design goal is direct interop with shaders authored elsewhere. Figma's
shader effects (Config 2026) are GLSL-style source with named uniforms surfaced
as controls; a Popkorn `@effect` block is the same shape, so an exported Figma
shader maps onto one near-losslessly: source in, one declaration per uniform.

## Syntax

```css
@effect ripple {
  src {
    uniform float amplitude;
    uniform float speed;

    vec4 main(vec2 coord) {
      vec2 uv = coord / u_resolution;
      float wave = sin(uv.y * 40.0 + u_time * speed) * amplitude;
      return texture(u_content, uv + vec2(wave / u_resolution.x, 0.0));
    }
  }
  amplitude: 6px;
  speed: 1.5;
}

#stage {
  type: group;
  filter: blur(2px) effect(ripple);
}
```

- `@effect <name> { ... }` declares an effect at top level, like `@define` and
  `@machine`.
- `filter: effect(<name>)` applies it. `effect()` is an ordinary member of the
  filter list and composes left to right with the built-in functions.
- One `@effect` can be referenced from any number of nodes.

### The `src` block

`src { ... }` holds the GLSL source verbatim. The parser captures the raw text
between the braces by brace counting (GLSL ES has no string literals, so braces
are balanced; comments are skipped while counting). For source kept in a
separate file, `src: url(./ripple.glsl)` is accepted instead; inline is the
default and keeps a scene single-file and diffable.

Exactly one `src` per `@effect`. A missing or unparsable `src` drops the effect
with a warning, and `effect(name)` for an unknown name is skipped with a
warning, mirroring how unknown filter functions behave.

### Uniforms

Every declaration in an `@effect` block other than `src` and `fallback` is a
uniform. The declaration name is the GLSL uniform name (kebab-case maps to
camelCase: `wave-height` becomes `waveHeight`). Values follow the existing
value rules:

- `<number>`, `<percent>` (`50%` is `0.5`), and `<length>` (px) resolve to
  `float`. Lengths are authored in the node's local space and scale with the
  node's world transform, matching `blur()`.
- `<color>` resolves to `vec4` (premultiplied, linear ordering matching the
  renderer's color pipeline). Colors resolve once statically, matching the
  existing rule that live bindings drive numeric properties only.
- Numeric uniforms accept `calc()`, `var()`, and `input()` and re-resolve every
  frame through the existing binding machinery. This is the interactivity
  story: `strength: input(cursor.x);` drives a uniform from the pointer with
  no new concepts.

A uniform declared in the block but unused in the source is allowed (warned
once). A uniform read in the source but not declared in the block resolves to
`0.0`, matching how unknown `var()`/`input()` paths resolve.

### Built-in uniforms

Provided by the runtime, no declaration needed:

| Name | Type | Meaning |
| --- | --- | --- |
| `u_content` | `sampler2D` | The node's rasterized subtree, after any filter functions earlier in the list |
| `u_resolution` | `vec2` | Content bounds in local px |
| `u_time` | `float` | The node's local timeline time in seconds (inherits `time-offset`/`time-scale`, pure function of the global clock) |

`u_time` is timeline time, not wall-clock time, so seeking and scrubbing stay
exact. An effect that should track real time instead binds a uniform to
`input(time)` explicitly.

## GLSL contract

- Language: GLSL ES 3.00, fragment stage only.
- Entry point: `vec4 main(vec2 coord)` where `coord` is the fragment position
  in local px (origin at the content box's top left). The runtime wraps the
  source in a backend prelude (version pragma, precision, IO plumbing);
  authors write only uniforms and functions.
- The return value is the premultiplied RGBA for that fragment.
- Sampling outside `u_content` returns transparent black. The runtime pads the
  offscreen raster the same way it already does for `blur()`, so effects that
  displace outward do not clip at the content edge.

## Backends

Realization goes through the existing `supportsFilter()`/`compositeFilter()`
seam; effects change nothing about the shared render walk.

- **Web**: WebGL2. The subtree raster is uploaded as a texture, the wrapped
  shader runs on a fullscreen quad, the result blits back to the 2D canvas.
- **Skia (React Native)**: `RuntimeShader`. SkSL is a GLSL variant with the
  same `main(vec2)` shape; the runtime rewrites the handful of mechanical
  differences (`texture(u_content, uv)` to `u_content.eval(coord)`, sampler
  and precision declarations). Source that survives the rewrite runs natively;
  source that does not falls back as below.
- **SVG**: no shader execution. Uses `fallback` when present, otherwise skips.

### `fallback`

An optional declaration giving a built-in filter list that approximates the
effect for backends that cannot run it:

```css
@effect frost {
  src { /* ... */ }
  radius: 8px;
  fallback: blur(8px) saturate(1.1);
}
```

A backend that cannot realize the shader substitutes the fallback list in
place; with no fallback the effect is skipped and the node draws unfiltered
(warned once), the same degradation path filters have today. Every deliberate
divergence is pinned in the cross-backend conformance table.

## Animation

Uniforms are reactive (per-frame `var()`/`input()`/`calc()`), and `u_time`
gives timeline-driven motion, so most animated effects need no keyframes at
all. The `filter` list itself remains animatable exactly as today: keyframe
endpoints sharing the same function sequence interpolate the built-in
functions' parameters, and an `effect(name)` entry must match by name on both
endpoints (it holds rather than interpolating). Keyframe interpolation of
uniform values is a possible later extension through the same registry path.

## Determinism and safety

- Effects are stateless between frames. No ping-pong buffers, no accumulation:
  the timeline stays a pure function of time.
- Shader compilation happens once at scene build; a compile error drops the
  effect with a warning (the scene still plays, unfiltered).
- A shader can read only its own subtree raster and its uniforms. It cannot
  read the backdrop, other nodes, or arbitrary textures.

## Out of scope, deliberately

- **Shader fills** (generators with no input raster, Figma's other category).
  The natural home is `fill: paint(...)`; deferred until a scene needs a
  procedural fill a gradient cannot express.
- **WGSL / WebGPU.** A fullscreen fragment pass gains nothing from WebGPU, and
  WGSL translation would mean a wasm dependency and a build step.
- **Multi-pass and per-pixel persistent state** (velocity fields, trails).
  Needs feedback buffers, which breaks the purity rule above. Revisit only
  with a real scene that demands it.
- **Vertex shaders / geometry displacement.** Popkorn is a 2D vector format;
  effects operate on rasterized pixels.

## Figma interop

Inspection of real Figma shader source (via the Figma MCP library API) shows a
Figma shader is not bare GLSL: it is a TypeScript program embedding WGSL, with
`setup(device, frame)`/`render(device, frame)` driving raw WebGPU calls and
arbitrary CPU-side parameter massaging, plus a `defineProperties()` block
declaring the controls. Translating that into an `@effect` cannot be lossless
in general.

Perfect fidelity therefore comes from a second, separate mechanism: a **Figma
shader host**, a web-player module that implements the small `figma:shaders`
runtime contract (a `GPUDevice`, a `frame` with `state`/`params`/`output`
texture), runs the shader program unmodified against an offscreen WebGPU
canvas, and composites the resulting texture into the scene through the image
path. Control values map to animatable params (Figma's own animation model is
keyframed params such as `phase`/`cycles`, so determinism is preserved). This
is a player capability with a hosting trust boundary, not a format feature:
the scene stays declarative and references the shader by id/version.

The host targets the standard WebGPU JS API, so it runs wherever a `GPUDevice`
exists: browsers natively, and React Native through the optional
`react-native-wgpu` peer (Dawn-backed, technical preview, RN 0.81+ new
architecture). On RN the remaining seam is handing the output texture to the
Skia canvas (native-texture image import); that path needs a validation spike.
Without a device, the Skia backend degrades via `fallback` or skip; SVG always
degrades.

`@effect` remains the portable, hand-authorable tier; the host is the
run-Figma-shaders-perfectly tier. The export plugin emits the hosted form, and
may additionally emit an `@effect` fallback where a shader is simple enough to
translate.
