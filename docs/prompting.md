# Prompting with AI

Popkorn scenes are written in a close dialect of CSS (`@keyframes`,
`transform`, `offset-path`, `z-index`), and language models have read a great
deal of CSS. So a model can write and edit Popkorn from a short guide, with no
fine-tuning. Most of the playground gallery was written this way, prompt by
prompt; the rest are converted Lottie files.

The playground includes **Popkorn Copilot**, a chat panel that writes a scene
from a description or edits the one that's open. You bring your own API key.
A scene is plain text, so any other assistant works too: paste it in and ask
for changes.

## Creating a scene from scratch

<div style="position:relative;padding-bottom:56.25%;height:0;max-width:720px;margin:1rem 0;">
  <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px;" src="https://www.youtube-nocookie.com/embed/12PuMy19l1s" title="Building a Popkorn scene from a prompt" allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</div>

<p style="margin:0.5rem 0 0;padding:0.6rem 0.9rem;border-left:3px solid #7c5cff;background:rgba(124,92,255,0.09);border-radius:0 6px 6px 0;font-size:0.92rem;">
  <strong>Prompt</strong> · "Create a solar system animation from scratch"
</p>

Describe what you want and the Copilot writes the whole scene. Ask it to
"create a solar system animation from scratch" and it stages the canvas, sets a
palette, places and paints every shape, then adds the motion. The result is a
`.css` file you can read line by line and keep editing, by hand or by asking for
more.

## Editing art you already have

<div style="position:relative;padding-bottom:56.25%;height:0;max-width:720px;margin:1rem 0;">
  <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px;" src="https://www.youtube-nocookie.com/embed/XcvsOkNNqtw" title="Prompting edits on an imported animation" allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</div>

<p style="margin:0.5rem 0 0;padding:0.6rem 0.9rem;border-left:3px solid #7c5cff;background:rgba(124,92,255,0.09);border-radius:0 6px 6px 0;font-size:0.92rem;">
  <strong>Imported Lottie</strong>, then two prompts · "Remove the airpods" → "Make him white and his hat red"
</p>

You can also bring in an existing animation, a Lottie file or an SVG, and
prompt edits on it. A Lottie is machine-generated JSON and an SVG is mostly
coordinates, so changing either usually means going back to the tool that made
it. Import one into the playground and it becomes a readable Popkorn scene you
can ask about directly: "change the palette to warm colors," "slow the intro and
hold on the logo," "make this loop instead of playing once."

Because the imported scene is plain Popkorn text, each edit lands as a small
change you can read and refine, by asking again or by hand. The file you
imported stays editable from then on, without the original authoring tool.

## Try it, and what's next

Open the [playground](https://usepopkorn.dev), reveal the **Copilot**
panel, and add a key for your model. Any capable model works. At the time of
writing, `openai/gpt-5.5` has given the best results in our use, and among open
models `z-ai/glm-5.2` has performed well. Setting reasoning to low or off keeps
responses fast, and most edits don't need more.

Popkorn is in very early proof-of-concept stages and the surface is still
growing. The idea it's testing, that a CSS-shaped animation file can be read and
written by a model as readily as by a person, already holds up in the gallery
and the edits above.
