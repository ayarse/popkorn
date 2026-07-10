# Importing Lottie and SVG

You don't have to start from a blank file. Popcorn can read existing Lottie
animations and SVG artwork and turn them into scenes you can read and edit.

## The fastest way: the playground

Drop a `.json` (Lottie) or `.svg` file into the
[playground](https://ayarse.github.io/popcorn) with the **Import** button. It
detects which kind of file it is, converts it, and drops the result straight into
the editor, where you can read and tweak it on the spot.

## From the command line

For batch work or a build step, the converter ships as a command in
`@popcorn/converters`:

```sh
popcorn-convert animation.json -o animation.css   # Lottie -> Popcorn
popcorn-convert logo.svg -o logo.css              # SVG -> Popcorn
popcorn-convert --validate animation.json         # report only: list what won't convert, write no CSS
popcorn-convert --batch ./animations              # convert a whole folder
```

It picks the converter by file extension, so the same command handles both
formats.

## What comes across

**From Lottie:** vector shapes, fills and gradients, strokes and dashes, masks
and track mattes, transforms (including baked anchor points and layer parenting),
and keyframe animation with easing, trim paths, and precomp time remapping.
Basic static text layers come across too — font, size, fill, stroke, and
justification. Real-world files, including minified bodymovin output, are normalized on the way
in, so the quirks of exported JSON mostly sort themselves out. The importer is
checked continuously against a corpus of real Lottie files.

**From SVG:** all the standard shapes and paths, fills, gradients, and strokes,
plus animation. CSS `@keyframes` from `<style>` blocks and basic SMIL
(`<animate>` / `<animateTransform>`) map into Popcorn keyframes and `animation-*`
properties.

## What doesn't, and what happens then

Some things have no equivalent in Popcorn and are skipped. When that happens the
converter emits a **warning naming exactly what it dropped**, so an import is
never silently wrong, and everything that does map still produces a working
scene.

- **Lottie:** JavaScript expressions and a few rare shape modifiers. Text is
  partly supported: static layers convert, but animated text documents, text
  animators, tracking, line-height, and multi-line text are dropped with a
  warning (the first line/document is kept).
- **SVG:** `<pattern>`, `<marker>`, `<foreignObject>`, `<textPath>`, and
  animation channels that don't map (such as gradient keyframes, `<set>`, and
  `<animateMotion>`).

These match what shipping players skip too. Run `--validate` first if you want to
see the warnings for a file before converting it — it writes no CSS and exits
with a nonzero status when the output has validation errors (a `--batch` run
likewise exits nonzero if any file fails).

## After importing

The output is ordinary Popcorn: a readable scene you can open, diff, and edit by
hand or hand to Copilot. Import is a starting point, not a black box.

## See also

- [Getting Started](getting-started.md) for the basics of a scene.
- [Format reference](reference.md) for every property the output can use.
