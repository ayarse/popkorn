# Prompting with AI

Popkorn is built on CSS for a plain reason: a scene should be a portable,
readable artifact, not an opaque blob. Choosing a syntax people already know
brought a surprise we did not set out to get. Language models already know it
too. Because a scene is ordinary CSS underneath (`@keyframes`, `transform`,
`offset-path`, `z-index`), a model can read and write one straight from its
existing training, with no fine-tuning and no special format to teach it.

That surprise turned out to be genuinely useful, so the playground ships a
**Popkorn Copilot**: a chat panel that builds a scene from a description or edits
the live one on request. It's **bring-your-own-key**, so you point it at your own
model and play with it as much as you like. Since a scene is just CSS text, the
Copilot isn't the only door either: you can paste a scene into any assistant you
already use and ask for changes there too.

## Creating a scene from scratch

<div style="position:relative;padding-bottom:56.25%;height:0;max-width:720px;margin:1rem 0;">
  <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px;" src="https://www.youtube-nocookie.com/embed/12PuMy19l1s" title="Building a Popkorn scene from a prompt" allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</div>

<p style="margin:0.5rem 0 0;padding:0.6rem 0.9rem;border-left:3px solid #7c5cff;background:rgba(124,92,255,0.09);border-radius:0 6px 6px 0;font-size:0.92rem;">
  <strong>Prompt</strong> · "Create a solar system animation from scratch"
</p>

Describe what you want and the Copilot writes the whole scene. Ask it to
"create a solar system animation from scratch" and it stages the canvas, sets a
palette, places and paints every shape, then layers on the motion. What comes
back isn't a black box: it's a `.css` file you can read line by line and keep
editing, by hand or by asking for more.

This is the strongest evidence we have that it works: the playground's entire
example gallery was made this way, prompt by prompt, and it's what you see when
you open the demo. Nothing in it was authored by hand.

## Editing art you already have

<div style="position:relative;padding-bottom:56.25%;height:0;max-width:720px;margin:1rem 0;">
  <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px;" src="https://www.youtube-nocookie.com/embed/XcvsOkNNqtw" title="Prompting edits on an imported animation" allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</div>

<p style="margin:0.5rem 0 0;padding:0.6rem 0.9rem;border-left:3px solid #7c5cff;background:rgba(124,92,255,0.09);border-radius:0 6px 6px 0;font-size:0.92rem;">
  <strong>Imported Lottie</strong>, then two prompts · "Remove the airpods" → "Make him white and his hat red"
</p>

The other half is where it gets interesting. Bring in an existing animation, a
Lottie file or an SVG, and prompt edits on it directly. Normally that art is a
dead end: a Lottie is machine-generated JSON, an SVG a wall of coordinates, and
short of reopening the original tool there's no real way to change it. Import it
into the playground and it becomes a readable Popkorn scene, at which point you
can just ask. "Change the palette to warm colors," "slow the intro and hold on
the logo," "make this loop instead of playing once," all in plain language,
against art you didn't author and couldn't otherwise touch.

Because the imported scene is ordinary CSS, every edit lands as a small, legible
change you can see and refine, by asking again or by hand. That's the shift: a
Lottie you were stuck with becomes one you can restyle, retime, and rework
conversationally, without ever going back to the tool that made it.

## Try it, and what's next

Open the [playground](https://ayarse.github.io/popkorn), reveal the **Copilot**
panel, drop in a key for your model, and prompt away. Any capable model works,
and in our own use `openai/gpt-5.5` has given the best results so far, though open
models hold their own too: `z-ai/glm-5.2` has been a strong performer. Turning
reasoning down to low or off keeps things fast, and the format is familiar enough
that most edits don't need it. It's very
early and the surface is still growing, but the core idea, that a CSS animation
can be a portable artifact a model reads and writes as fluently as a person, is
already holding up better than we expected.
