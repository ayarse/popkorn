import { createFileRoute, Link } from "@tanstack/react-router";
import { ScenePreview } from "@/components/scene-preview";
import { buttonVariants } from "@/components/ui/button";
import { Landing, landingHead } from "@/routes/-landing";

const SHOWCASE = [
  "morph--jellyfish",
  "procedural--astronomical-watch",
  "trim-path",
];

export const Route = createFileRoute("/ai-lottie-generator")({
  head: () =>
    landingHead(
      "/ai-lottie-generator",
      "AI Lottie Animation Generator | Popkorn",
      "Describe an animation and AI writes it as CSS. Edit the vector animation by hand or by prompt, then export Lottie JSON, GIF or MP4. Free online editor.",
    ),
  component: AiLottieGenerator,
});

function AiLottieGenerator() {
  return (
    <Landing
      heading="Generate Lottie animations with AI"
      lede="Describe the animation you want. Popkorn Copilot writes it as a short CSS file, plays it live, and exports it as Lottie JSON when you're happy with it."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {SHOWCASE.map((key) => (
          <Link key={key} to="/examples/$key" params={{ key }}>
            <ScenePreview exampleKey={key} />
          </Link>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Every scene in the gallery was generated from a prompt.
      </p>
      <Link to="/" className={buttonVariants({ className: "mt-6" })}>
        Start generating
      </Link>
      <section className="mt-10 space-y-3 text-sm text-muted-foreground">
        <h2 className="text-lg font-semibold text-foreground">
          Why the AI writes CSS
        </h2>
        <p>
          Language models are bad at emitting Lottie JSON directly: it's
          thousands of lines of nested keyframe arrays with no names. They are
          good at CSS. Popkorn scenes are written in a close dialect of CSS, so
          a model can build a whole animation, and you can ask for precise
          changes like "slow the bounce" or "make the stroke draw on" without it
          losing track.
        </p>
        <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs text-foreground">{`#ball {
  type: circle;
  r: 20;
  fill: #6875f8;
  animation: bounce 1s ease-in-out infinite alternate;
}
@keyframes bounce {
  to { transform: translateY(-120px); }
}`}</pre>
        <h2 className="pt-4 text-lg font-semibold text-foreground">
          How to use it
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open the playground and the Copilot panel (bring your own API key).
          </li>
          <li>
            Describe the animation, or import an SVG or Lottie to start from.
          </li>
          <li>Refine it by prompt or by editing the CSS directly.</li>
          <li>
            Export as Lottie, GIF or MP4, or ship the CSS with the Popkorn
            player.
          </li>
        </ol>
        <p>
          <Link
            to="/docs/{-$section}"
            params={{ section: "prompting" }}
            className="underline"
          >
            Read the prompting guide
          </Link>
        </p>
      </section>
    </Landing>
  );
}
