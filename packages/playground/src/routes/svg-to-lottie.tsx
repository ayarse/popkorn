import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Landing, landingHead } from "@/routes/-landing";

/** sessionStorage handoff: this page writes the file, the editor imports it on load. */
export const PENDING_SVG_KEY = "popkorn:pending-svg";

export const Route = createFileRoute("/svg-to-lottie")({
  head: () =>
    landingHead(
      "/svg-to-lottie",
      "SVG to Lottie Converter, Free and Online | Popkorn",
      "Convert SVG files to Lottie JSON in your browser, including CSS @keyframes and SMIL animations. Edit the animation as CSS or with AI, then export Lottie.",
    ),
  component: SvgToLottie,
});

function SvgToLottie() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // The editor picks the file up on load and runs its normal SVG import.
  async function open(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      sessionStorage.setItem(
        PENDING_SVG_KEY,
        JSON.stringify({ name: file.name, text }),
      );
      navigate({ to: "/" });
    } catch (e: any) {
      setError(`Couldn't open that file: ${e.message}`);
    }
  }

  return (
    <Landing
      heading="SVG to Lottie converter"
      lede="Turn an SVG into a Lottie animation in your browser. Static artwork and animated SVGs both work: CSS @keyframes and SMIL <animate> come along. Nothing is uploaded."
    >
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground hover:bg-muted/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void open(e.dataTransfer.files[0]);
        }}
      >
        <span>Drop an .svg here, or click to choose one</span>
        <input
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          onChange={(e) => open(e.target.files?.[0])}
        />
      </label>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <section className="mt-10 space-y-3 text-sm text-muted-foreground">
        <h2 className="text-lg font-semibold text-foreground">How it works</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Your SVG opens in the Popkorn editor as a scene: shapes, gradients,
            masks, clip paths and filters become CSS rules, and its animations
            become <code>@keyframes</code>.
          </li>
          <li>
            Check it plays the way you want. Adjust the motion by hand, or ask
            the AI Copilot to animate a static SVG for you.
          </li>
          <li>
            Choose Export → Lottie to download the JSON. It plays in lottie-web,
            lottie-ios, lottie-android and other Lottie players.
          </li>
        </ol>
      </section>
    </Landing>
  );
}
