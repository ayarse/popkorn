# State Machines

**Status: implemented** — `@machine` graphs, transitions (pointer/`event()`/
`when` guards/`on complete`/`state-time`), `:state()` styling with entry-anchored
`animation:`, trigger variables, the `setVariable`/`getVariable`/`fire` host API,
`statechange`/`machine-event` events, and `animation-timeline` scrubbing
(`var()`/`input(scroll.progress)`) and `media.*` inputs in guards all ship.
**Not yet wired:** `mix` tweening (parses, but a transition is currently a
hard cut). This document is kept as design rationale; see [DSL.md](DSL.md)
for the shipping syntax.

## Motivation

A Popcorn scene today is one linear timeline. Interactivity is
`:hover`/`:active` static overrides — they cannot start an animation — plus
read-only `input()` bindings. That rules out the most common interactive
patterns: a toggle, "play the intro once then loop idle", a character that
reacts to a tap, anything driven by app state.

What those patterns need, in requirement form:

- **Named states**, each a playback configuration: which animations run and
  how, not a slice of one master timeline.
- **Typed inputs** (boolean, number, momentary trigger) as the contract
  between the scene and its host.
- **Guarded transitions**: flat comparisons against inputs, ANDed, evaluated
  in declaration order. Not an expression language.
- **Tweened transitions** — cross-fade with duration and easing; a hard cut
  is what makes interactivity feel bolted-on.
- **Pointer triggers scoped to a named node**, working with zero host code.
- **Concurrent machines** (a blink loop shouldn't share a graph with button
  logic) and **events out to the host**.
- Deliberately *not* needed: state hierarchy, history states, scripted
  guards.

This scope isn't speculative — it's where shipping interactive-animation
runtimes (Rive's state machines, dotLottie 2.0's) have converged, including
the skips. What none of them offer is a hand-writable text format; that part
is ours, and the syntax comes from CSS.

## Design principles

Reuse CSS wholesale; invent only the machine graph itself.

| Concept | CSS idiom | Precedent |
|---|---|---|
| Inputs | custom properties (`--energy: 0`) | already ours |
| Guards | media-query range syntax over `style()` | `@container style()`, MQ4 ranges |
| Trigger microsyntax | `on click(#hitbox)`, `on complete` | SMIL `begin="btn.click"`, `begin="intro.end"` |
| State styling | `:state(name)` pseudo-class | CSS custom states (`ElementInternals`) |
| Tweened mix | `transition` property semantics | already ours |
| Scrubbing | `animation-timeline` | CSS scroll-driven animations |
| Environment | media features as built-in inputs | `@media` |

## Inputs

Inputs are custom properties on `:root` — the store already exists. The type
is the initial value's type: number, boolean, or (new) `trigger`.

```css
:root {
  --energy: 0;         /* number  */
  --pressed: false;    /* boolean */
  --tap: trigger;      /* momentary event; auto-resets after one evaluation */
}
```

New host API on `<popcorn-player>`:

```js
player.setVariable('--energy', 80);   // number/boolean variables
player.fire('--tap');                 // trigger variables
player.getVariable('--energy');
```

### `var()` vs `input()`

Two namespaces, one rule: **if the player can sense it itself, it's
`input()`; if the app must tell the scene, it's a `--variable`.**

- `input(…)` — built-in, read-only environment signals: `cursor.x/y/isDown`,
  `scroll.x/y`, `time`, plus (new here) `media.*` and `state-time`. Authors
  can't declare these; hosts can't write them.
- `var(--x)` — author-declared, host-writable. `setVariable()`/`fire()`
  operate only on these, never on `input()` paths.

Both work everywhere a value is read: property bindings, `when style(…)`
guards, `animation-timeline`.

### Built-in environment inputs (media queries as inputs)

Media features are read-only built-in inputs under `media.*`, usable anywhere
`input()` works and in guards:

```css
to: idle when style(input(media.prefers-reduced-motion): reduce);
```

Initial set: `prefers-reduced-motion`, `hover` (`hover`/`none` — the
touch-device signal), `width`, `height`. `prefers-reduced-motion` is the
flagship: an animation format ought to make respecting it declarative.

## The `@machine` at-rule

One machine = one at-rule. **Multiple `@machine` blocks run concurrently and
independently** — concurrency without a dedicated layer concept, so a blink
loop and button logic never share a graph.

```css
@machine cat {
  initial: idle;

  state idle {
    to: excited on click(#hitbox);
    to: hyper when style(--energy > 80) mix 300ms ease-in-out;
  }
  state excited {
    to: idle on complete;              /* this state's animations finished */
  }
  state hyper {
    to: idle when style(--energy <= 80) mix 300ms;
    emit: overheat;                    /* event out to host, fired on entry */
  }
  state * {                            /* any-state: checked before current */
    to: idle on event(reset);
  }
}
```

### Transitions: the `to:` declaration

```
to: <state-name> [on <trigger>] [when <guard> [and <guard>]*] [mix <duration> [<easing>]];
```

- Multiple `to:` declarations per state; **declaration order is priority**
  (first passing transition fires) — no weights or conflict resolution rules
  to learn.
- `on` and `when` may combine (event AND condition). Guards combine with
  `and` only — MQ grammar gives us `or`/`not` for later if real files need
  it.

**Triggers (`on …`):**

| Trigger | Meaning |
|---|---|
| `click(#id)` `pointerdown(#id)` `pointerup(#id)` `hoverstart(#id)` `hoverend(#id)` | pointer event on a named node (existing hit-tester) |
| `click(:root)` etc. | same events on the whole scene (tap anywhere) |
| `complete` | the current state's animations finished (non-infinite) |
| `event(name)` | a named external event — see External events |

**Built-in triggers require zero host code.** The player owns pointer
handling on every platform (the hit-tester already exists), so hover, press,
tap, and tap-anywhere work with nothing but the DSL — no `fire()` calls, no
listeners in the host page or app. `event()` is strictly the escape hatch
for signals the player cannot see itself (app logic, sensors, navigation).
If a pattern keeps showing up as `event()` boilerplate across real scenes,
that's the signal to promote it to a built-in trigger.

Pointer triggers name their target directly — no listener→input→guard
indirection for the common case. Hosts that need indirection can still do
it: fire an event or set an input, guard on it.

**Guards (`when …`):** container-style-query syntax with MQ4 range
comparisons, over custom properties and `input()` paths:

```css
when style(--energy > 80)
when style(--mood: happy)                     /* equality, CSS style() form */
when style(input(cursor.x) < 400)
when style(state-time > 2s)                   /* time in current state → timeouts */
```

`state-time` is a reserved per-machine input measuring time in the current
state — timeouts ride on guards, no new concept.

**Mix (`mix <duration> <easing>`):** on entry, changed properties tween from
their current resolved values to the new state's values using the existing
CSS-transition machinery. Omitted = hard cut. v1 mix covers style-level
cross-fade; blending two *running animations'* sampled outputs is phase 3 if
real scenes demand it.

## State styling: `:state()`

While machine `M` is in state `S`, the pseudo-class `:state(S)` matches
(namespace with the machine name if two machines share a state name:
`:state(cat.idle)`). State rules are full rules — **including `animation:`,
which is the capability jump over `:hover`**:

```css
#cat:state(idle)    { animation: breathe 2s ease-in-out infinite; }
#cat:state(excited) { animation: jump 600ms ease-out; }   /* restarts on entry */
#cat:state(hyper)   { animation: vibrate 100ms infinite; fill: #f44; }
```

Entering a state (re)starts its animations from the state's entry time.
`:hover`/`:active` keep working unchanged and still apply last.

### Common patterns, zero host code

The recipes people build over and over, entirely in the DSL:

```css
/* Toggle on tap */
@machine lamp {
  initial: off;
  state off { to: on  on click(#bulb); }
  state on  { to: off on click(#bulb); }
}

/* Intro once, then loop idle */
@machine hero {
  initial: intro;
  state intro { to: idle on complete; }
  state idle  { }
}

/* Long-press: no dedicated trigger needed — pointerdown + state-time */
@machine grab {
  initial: idle;
  state idle     { to: pressing on pointerdown(#thing); }
  state pressing { to: held when style(state-time > 500ms);
                   to: idle on pointerup(#thing); }
  state held     { to: idle on pointerup(#thing); }
}
```

Plain hover/press buttons don't even need a machine — `:hover`/`:active`
already cover them; reach for `@machine` when a state must outlive the
pointer (toggles, sequences, timeouts).

## External events

The format knows only **named events** — never DOM event types or platform
APIs. `on event(coin-collected)` is the trigger; how an event gets fired is
the host platform's job:

- **Web**: `player.fire('coin-collected')`. Forwarding any DOM/synthetic
  event is a one-liner in the host page:
  `btn.addEventListener('click', () => player.fire('tap'))`. We deliberately
  do **not** put DOM event names in the DSL — that would break portability.
- **Mobile/native**: the same `fire(name)` method on the platform player
  API. A native wrapper forwards gestures, sensors, push events — whatever —
  as named events. A string-in, string-out FFI surface is trivial to bind on
  any platform.
- Only the built-in trigger vocabulary (pointer events, `complete`) must be
  implemented per platform; user event names are opaque strings.

**Events out**: `emit: name;` inside a state fires on entry. The web player
dispatches `CustomEvent('machine-event', {detail:{machine, name}})` plus
`statechange` on every transition. Payloads: skipped for v1 — set inputs
first, then emit.

## Scrubbing

Adopt the CSS `animation-timeline` property, generalized: it accepts **any
0..1 value source** — the same `var()`/`input()` vocabulary used everywhere
else — and scrubs the animation to that progress instead of playing it on
the clock.

```css
#progress-bar {
  animation: fill-up 1s linear;
  animation-timeline: var(--progress);          /* host-fed 0..1 */
}
#hero {
  animation: reveal 1s ease-out;
  animation-timeline: input(scroll.progress);   /* page scroll, normalized */
}
```

`scroll.progress` is a new built-in input: scroll position normalized to
0..1 by the scrollable range (the raw offset stays available as
`scroll.y`). We deliberately do *not* adopt CSS's `scroll()` function — in
real CSS it names an element's own scroll container, which Popcorn scenes
don't have, so borrowing the spelling would look compliant while meaning
something else. One vocabulary, no special cases: web scenes use
`input(scroll.progress)` with zero host code; native hosts feed
`var(--progress)` from whatever scrolls.

Scroll- and cursor-driven scrubbing is one of the most-used interactive
patterns in the wild. Orthogonal to `@machine` but part of the same
interactivity story.

## Runtime architecture

- A `StateMachineRunner` per `@machine` evaluates once per frame *before*
  the node walk: resolve triggers/guards → first passing transition →
  record `(newState, entryTime)`, consume triggers, fire `emit`s.
- In `RenderLoop.resolveNode`, the fixed per-node order gains one slot:
  reset to base → bindings → **state-selected rules merge in (they determine
  which animations sample, anchored at state entry time)** → animation
  sampling → `:hover`/`:active` overrides last.
- **Seek purity** (invariant 4) holds as: frames are a pure function of
  `(time, machineState)`. Machine state lives off the timeline, exactly like
  the `InteractionManager`'s hover-transition WeakMap already does.
- `sceneHasDynamicContent` learns about machines so the loop doesn't go
  dormant while a machine could still transition.
- A machine scene is **unbounded**: the render loop skips both the loop-wrap
  and the play-once clamp (they're keyed off `sceneDuration`, which counts only
  base animations), so the clock stays monotonic and a state animation's
  entry-anchored sampling never folds negative and replays. A one-shot state
  animation therefore holds its final frame — `:state()` animations default to
  `animation-fill-mode: both` rather than the node-level `forwards`.
- Cost centers are runtime, not parser: `:state()` rule matching (nothing
  keys off selectors at runtime today), entry-time-anchored animation
  restart, and animation-completion detection in the scheduler.

## Alternatives considered

- **Media-query-style grouped state rules** — `@state cat.idle { #cat {…} }`
  wrapping whole rules, like `@media` does, instead of the `:state()`
  pseudo-class. Same expressive power and near-identical implementation
  (both compile to conditional declaration sets). Rejected as the primary
  form because `:state()` composes with our existing nested `&:hover`
  syntax and real CSS custom states; the grouped form can be added later as
  sugar if scenes with many stateful nodes get repetitive.
- **Listener indirection as the only path** (pointer event → set input →
  guard reacts, keeping the graph free of event sources). Rejected: direct
  `on click(#id)` covers the dominant use case in one declaration;
  indirection remains available via events when a scene wants it.
- **Guard expression language.** Rejected — flat single comparisons cover
  what interactive scenes actually express. MQ grammar (`and`/`or`/`not`,
  ranges) is the reserved upgrade path.

## Deliberate skips

Hierarchical/history states, string inputs, event payloads, per-transition
exit-time/interruptibility knobs (polish — revisit with real scenes), true
animation-output blending in v1.

## Phasing

1. **Inputs + graph + static styling**: host `setVariable`/`fire` API, trigger
   input type, `@machine` parsing, transitions (pointer/`event()`/`when`),
   `:state()` with non-animation declarations, `statechange`/`emit` events.
   Enough for toggles, sequenced scenes, and app-state-driven styling.
2. **State-driven animations**: `animation:` in state rules with entry-time
   anchoring, `on complete`, `state-time` timeouts.
3. **Polish**: `mix` tweening, `animation-timeline` scrubbing, `media.*`
   inputs, animation-output blending if demanded.

## Prior art

Syntax lineage (what the DSL is actually built from):

- CSS: [custom states / `:state()`](https://developer.mozilla.org/en-US/docs/Web/CSS/:state) · [container style queries](https://developer.mozilla.org/en-US/docs/Web/CSS/@container#container_style_queries) · [scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline) · media query range syntax
- [SMIL `begin`](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/begin) — the `target.event` trigger microsyntax

Scope validation (runtimes whose shipped feature set informed the
requirements and skips):

- [Rive state machines](https://rive.app/docs/editor/state-machine/states)
- [dotLottie 2.0 state machines](https://dotlottie.io/spec/2.0/)
