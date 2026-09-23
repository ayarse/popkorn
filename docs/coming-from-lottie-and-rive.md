# Coming from Lottie or Rive

Lottie, Rive and Popkorn all solve the same problem: an animation made once
that plays the same way everywhere. The main difference is the file. A Lottie
file is JSON that After Effects exports. A Rive file is a binary made in the
Rive editor. A Popkorn file is text in a close dialect of CSS, and it's meant
to be read and edited directly, by you or by a language model.

This page describes the practical differences for someone who ships one of the
other formats today.

## At a glance

|                   | Lottie                        | Rive                          | Popkorn                                        |
| ----------------- | ----------------------------- | ----------------------------- | ---------------------------------------------- |
| File              | JSON exported from AE         | Binary from the Rive editor   | CSS-dialect text                               |
| Made in           | After Effects + Bodymovin     | Rive editor                   | Playground, an LLM, import, or by hand         |
| Edit after export | Back to the source project    | Back to the editor            | Edit the file                                  |
| Interactivity     | Player API, some expressions  | State machines, listeners     | `:hover`/`:active`, `@machine`, input bindings |
| Runtimes          | Web, iOS, Android, many more  | Web, iOS, Android, many more  | Web (Canvas2D, SVG), React Native (Skia)       |
| Maturity          | Industry standard             | Production                    | Early proof of concept                         |

Popkorn is the youngest of the three by far, and its runtime list is shorter.
What it adds is a source file you can open, diff, and change without going
back to a design tool. For Lottie users it's also a round trip: import a file,
edit it as text, and export it back to Lottie.

## If you use Lottie

### Bring your files

You don't need to rebuild anything. Drop a `.json` into the
[playground](https://usepopkorn.dev) with **Import**, or convert from the
command line:

```sh
popkorn-convert animation.json -o animation.css
popkorn-convert --validate animation.json   # list what won't convert, write nothing
```

The converter handles shapes, fills, gradients, strokes and dashes, masks and
track mattes, trim paths, layer parenting, precomps with time remapping, and
static text. It also cleans up minified and older Bodymovin output on the way
in. It's regression-tested against the
[LottieFiles test corpus](https://github.com/LottieFiles/test-files).

When something can't be converted, the converter doesn't drop it silently. It
prints a warning that names what was skipped, and the rest of the scene still
plays. The main things skipped are JavaScript expressions, text animators, 3D
layers, and the rare shape modifiers (offset, zig-zag, pucker, round corners).
Most shipping Lottie players skip these too. The full list is in
[Importing Lottie and SVG](importing.md).

### How the concepts map

| Lottie                       | Popkorn                                        |
| ---------------------------- | ---------------------------------------------- |
| Composition `w`, `h`, `fr`   | `:root { width; height; }` (time is in seconds, not frames) |
| Shape layer, group           | `type: group` with nested child rules          |
| Keyframed property           | `@keyframes` + `animation`                     |
| Keyframe in/out tangents     | `animation-timing-function: cubic-bezier()` per keyframe |
| Hold keyframe                | `step-end`                                     |
| Anchor point + position      | `transform-origin` + `translate` (anchor is folded in) |
| Layer parenting              | Nesting (transform only; paint order kept with `z-index`) |
| Layer in/out points          | `visible-from` / `visible-until`               |
| Precomp                      | Nested group, or a `@define` symbol when reused |
| Time remap                   | `time-remap`                                   |
| Trim paths                   | `trim-start`, `trim-end`, `trim-offset`        |
| Track matte, mask            | Masks: alpha or luminance, plain or inverted   |

Once a file is converted, it's no longer a black box. You can recolor it, retime a
single animation, or add a `:hover`. None of that needs a trip back to After Effects.

### Size

Converted scenes are usually smaller than the Lottie JSON before compression.
Gzipped, they're about the same: across the 17 files in `examples/lottie/`,
8 came out smaller and 9 larger, with a median of about 1.0x. Files with lots
of repeated geometry tend to shrink the most, and files with lots of keyframes
shrink less. The web player, with the parser and all renderers, is 63 KB
gzipped and has no dependencies.

### Exporting back to Lottie

You don't have to replace your player to use Popkorn. Any scene exports to a
Lottie file, either from the playground's export dialog (with a length and
scale setting) or from code:

```ts
import { convertPopkorn } from "@popkorn/converters";
```

That makes Popkorn usable as an editing layer in front of the Lottie pipeline
you already have. Import a file, change colors or timing as text, have an LLM
make a variation, and ship the result to `lottie-web`, `lottie-ios` or
`lottie-android` unchanged.

The exporter samples the scene frame by frame. The animation comes across
exactly as it plays, but interactivity (`:hover`, state machines, input
bindings) doesn't, because Lottie has no equivalent for it.

The same Export menu also writes GIF and MP4, for places that take only video
or images, such as a README, a slide deck, or a social post. Because the
timeline depends only on time, every export renders exactly the same frames
the player shows.

Treat the exports as a bridge, not the destination. Each one captures the
animation and nothing else. `:hover`, `@machine` state machines,
`setVariable`, and events coming back to your app all need the Popkorn player.
So a good path is to export Lottie where you can't change the runtime yet, and
move each surface to the player (`<popkorn-player>` on the web, `PopkornView`
in React Native) as you go.

## If you use Rive

There's no Rive importer, since Rive files are a binary format made in the
editor. What transfers is the way you think about interactivity, because
Popkorn's model is close to Rive's:

| Rive                          | Popkorn                                               |
| ----------------------------- | ----------------------------------------------------- |
| State machine                 | `@machine` with named states                          |
| Timeline per state            | `:state(machine.state)` rules that start animations   |
| Listener (pointer down, etc.) | `click(#id)`, `pointerdown(#id)`, `hoverstart(#id)` triggers |
| Exit-time transition          | `on complete`                                         |
| Number / boolean input        | `--variable` set from the host with `setVariable`     |
| Trigger input                 | `event(name)`, fired from the host with `fire(name)`  |
| Events reported to the app    | `popkorn:statechange` DOM event / `onStateChange` prop |

A light switch, start to finish:

```css
@machine lamp {
  initial: off;
  state off { to: on  on click(#bulb); }
  state on  { to: off on click(#bulb); }
}

#bulb:state(lamp.on) { fill: #ffd873; }
```

The player handles pointer input on every platform, so a click-driven machine
needs no host code. [State machines](state-machines.md) covers guards,
timeouts, and several machines running at once.

Rive also has features Popkorn doesn't: bones and skinning, meshes,
constraints, layout, and a visual editor. If a scene depends on those, Rive is
the better fit today.

## Where to next

- Import one of your own files in the [playground](https://usepopkorn.dev).
- [Introduction](introduction.md) explains the format itself.
- [Format limitations](limitations.md) lists what the CSS dialect leaves out.
