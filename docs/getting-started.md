# Getting Started

The fastest way to get a feel for Popcorn is the playground. When you're ready to
put a scene in your own project, it's one web component.

## Try it live

**▶ [ayarse.github.io/popcorn](https://ayarse.github.io/popcorn)**

No install, it runs in your browser. Edit the example scenes, tweak values and
watch them update, or import a Lottie or SVG to see it convert.

## Your first scene

A Popcorn scene is a set of rules, one per shape, in a syntax that reads like
CSS. Here is a complete scene: a red ball that falls, bounces, and warms in color
when you point at it.

```css
:root {
  width: 400px;
  height: 400px;
  background: #1a1a2e;
}

@keyframes bounce {
  0% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.33, 0, 1, 1);
  }
  50% {
    transform: translateY(180px);
    animation-timing-function: cubic-bezier(0, 0, 0.67, 1);
  }
  100% {
    transform: translateY(0);
  }
}

#ball {
  type: circle;
  cx: 200px;
  cy: 80px;
  r: 36px;
  fill: #ff6b6b;
  animation: bounce 1.2s linear infinite;
  transition: fill 250ms ease;
  &:hover {
    fill: #ffd166;
  }
}
```

Piece by piece:

- **`:root`** sets the canvas size and background. It's also where scene-wide
  variables and inputs live.
- **`@keyframes bounce`** is an animation track, exactly as in CSS. The
  per-keyframe `animation-timing-function` gives the fall and rise the easing an
  animator would reach for.
- **`#ball`** is a shape. `type: circle` picks the shape; `cx`/`cy`/`r` place and
  size it; `fill` paints it. `animation` runs the track, and the `transition` +
  `&:hover` add an interaction.

Point at the ball and its color warms, tweened by the `transition`, while the
bounce never pauses or restarts. Interactions in Popcorn layer on top of running
animations rather than fighting them, because the whole scene plays on one
continuous timeline.

## Put it on a page

The simplest way to render a scene in your own project is the `<popcorn-player>`
web component.

```html
<script type="module">
  import "@popcorn/player";
</script>

<popcorn-player width="400" height="400"></popcorn-player>

<script>
  document.querySelector("popcorn-player").source = `
    #dot { type: circle; cx: 200px; cy: 200px; r: 40px; fill: #e94560; }
  `;
</script>
```

Set the `.source` property to your scene text, or point the `src` attribute at a
file. The full component API (attributes, properties, events) lives in the
[`@popcorn/player` README](../packages/popcorn-player/README.md).

## Bring existing art

You don't have to start from a blank file. Already have a Lottie or an SVG? Drop
it into the [playground](https://ayarse.github.io/popcorn) with the **Import**
button and it becomes a Popcorn scene you can read and tweak on the spot.

## Where to go next

- [Format reference](reference.md): every shape, property, and value.
- [State machines](state-machines.md): interactive, multi-state behavior.
- [Introduction](introduction.md): the bigger picture, if you skipped it.
