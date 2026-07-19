# State Machines

A Popkorn scene plays on one timeline, and `:hover` / `:active` handle reactions
that last only while a pointer is on the shape. Some interactions need more: a
switch that stays on after you click it, an intro that plays once and then
settles into an idle loop, a press that becomes a long-press after half a second.
Those need **memory**, a sense of which state the scene is in.

That is what a state machine is: a set of named states and the rules for moving
between them, declared right in the scene. No scripting, and for pointer-driven
cases, no host code at all.

## When you need one

Reach for `:hover` and `:active` first. A button that lights up under the cursor
or dents when pressed is a one-liner and doesn't need a machine. Reach for
`@machine` when a state has to **outlive the pointer**: toggles, sequences,
timeouts, or anything driven by your app.

## A machine, start to finish

Here is a light switch. Click the bulb and it flips on; click again and it flips
off.

```css
@machine lamp {
  initial: off;
  state off { to: on  on click(#bulb); }
  state on  { to: off on click(#bulb); }
}
```

Reading it:

- `@machine lamp` declares a machine named `lamp`. You can have several, and each
  runs independently.
- `initial: off` is the starting state (required).
- Each `state` block lists its **transitions**. `to: on on click(#bulb)` reads as
  "when `#bulb` is clicked, go to the `on` state."

The player owns pointer handling on every platform, so `click(#bulb)` just works.
No listeners, no `fire()` calls, nothing in your page.

## Making states look different: `:state()`

A machine only tracks _which_ state you are in. To make states _look_ different,
you style them. While machine `lamp` is in state `on`, the pseudo-class
`:state(lamp.on)` matches, and its rules apply:

```css
#bulb:state(lamp.on) { fill: #ffd873; }
#room:state(lamp.on) { animation: roomOn 800ms ease-out; }
```

The important part: a state rule can start an **animation**, something a `:hover`
can never do. Entering a state (re)starts its animations from that moment. A
one-shot animation holds its final frame while the state stays active; a looping
one keeps looping.

Use the bare name, `:state(on)`, when it is unambiguous, and namespace it as
`:state(lamp.on)` when two machines share a state name. State rules can restyle a
direct child with `> #child { ... }`, and `:hover` / `:active` keep working on
top.

## What moves a machine: triggers

The `on ...` part of a transition is its trigger.

| Trigger                                                                            | Fires when                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| `click(#id)`, `pointerdown(#id)`, `pointerup(#id)`, `hoverstart(#id)`, `hoverend(#id)` | that pointer event happens on a named node          |
| `click(:root)` (and the others)                                                    | the same, anywhere in the scene (tap anywhere)      |
| `complete`                                                                         | the current state's animations have finished        |
| `event(name)`                                                                      | your app fires a named event (see below)            |

Pointer and `complete` triggers need zero host code. `event()` is the escape
hatch for signals the player cannot sense on its own.

`complete` makes sequences trivial: play once, then settle.

```css
@machine hero {
  initial: intro;
  state intro { to: idle on complete; }   /* when the intro animation ends */
  state idle  { }
}
```

## Reacting to your app: inputs and guards

Sometimes the thing that should move the machine is not a pointer, it is your
app: a score crossed a threshold, a connection dropped, a setting flipped. For
that, declare an **input** and **guard** transitions on it.

An input is a custom property on `:root`. Its type is the type of its initial
value:

```css
:root {
  --energy: 0; /* number  */
  --online: true; /* boolean */
  --tap: trigger; /* momentary; fires once, then clears */
}
```

Your app writes them through the player:

```js
player.setVariable("--energy", 90);
player.fire("--tap"); // pulse a trigger input
```

Then guard transitions with `when`:

```css
@machine cat {
  initial: calm;
  state calm  { to: hyper when style(--energy > 80); }
  state hyper { to: calm  when style(--energy <= 80); }
}
```

Guards use the `style()` form with comparisons (`>`, `<`, `>=`, `<=`) or equality
(`style(--mood: happy)`), and can read `input()` paths too
(`style(input(cursor.x) < 400)`). Chain conditions with `and`. When a state lists
several `to:`, **declaration order is priority**: the first transition whose
trigger and guards all pass wins.

### Timeouts

`state-time` is a built-in that measures how long the machine has been in the
current state, so a timeout is just a guard:

```css
state pressing {
  to: held when style(state-time > 500ms);   /* becomes a long-press */
  to: idle on pointerup(#thing);
}
```

## Driving it from your app

Two directions.

**In.** Pointer and `complete` triggers are automatic. For everything else, your
app fires a named event and the machine reacts with `on event(name)`:

```css
state playing { to: gameover on event(player-died); }
```

```js
player.fire("player-died");
```

Named events are opaque strings, so the same call works on the web and on native.

**Out.** A state can announce itself with `emit:`, and every transition dispatches
an event you can listen for:

```css
state hyper { emit: overheat; }   /* fires on entry */
```

```js
player.addEventListener("popkorn:statechange", (e) =>
  console.log(e.detail.from, "->", e.detail.to),
);
player.addEventListener("popkorn:machine-event", (e) =>
  console.log(e.detail.name),
); // 'overheat'
```

Clicks are also reported on their own, machine or not: `popkorn:click` carries
the node that was hit, so a host can react without routing through a machine.
A node with `cursor: pointer` shows the pointer cursor on the player surface.
The rest of the component's event surface (`popkorn:ready`, `popkorn:timeupdate`,
`popkorn:complete`, `popkorn:error`) is in the
[player API](player-api.md).

## A few more things

- **Any-state transitions.** A `state *` block is checked before the current
  state, for global escapes like a reset: `state * { to: idle on event(reset); }`.
- **Concurrent machines.** Multiple `@machine` blocks run independently, so a
  blink loop and your button logic never tangle.
- **No duration.** A scene with a machine never ends or loops as a clip; the clock
  runs forward and the state lives off the timeline. `player.duration` reports
  `Infinity` and the `loop` attribute is inert. The same is true of any scene
  with `:state()` rules (a machine isn't required) and of a scene whose
  animations are all `infinite` — neither has an honest end either.
- **Scrubbing a segment with `time-remap`.** `time-remap` pins a subtree to an
  instant of its local timeline, and it's animatable — so a state can drive a
  segment of a converted Lottie by animating it, instead of starting and
  stopping separate tracks. See `examples/popkorn/17-lottie--interactive-volume.css`.

## Smooth state transitions: `mix`

By default a transition is an instant cut. Add `mix <duration> [easing]` to a
`to:` and the change cross-fades instead: each animatable property blends from
its old value to its new one over the duration.

```css
state off { to: on  on click(#bulb) mix 300ms ease-in-out; }
state on  { to: off on click(#bulb) mix 300ms ease-in-out; }
```

Numbers, lengths, and colors tween channel by channel. Channels that can't be
interpolated (mismatched gradients or path shapes) step at the midpoint of the
mix rather than blending. If a new transition fires mid-mix, the in-progress
mix is dropped and the machine cross-fades from where it is to the new state.

## Not here yet

- Hierarchical states, history states, string inputs, and event payloads are
  deliberately left out, matching what shipping interactive-animation runtimes
  settle on.

## See also

- [Format reference](reference.md#state-machines) for the exact syntax, tersely.
- [Getting Started](getting-started.md) for the basics of shapes and animation.
