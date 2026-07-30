// ponytail: regex over the `:root` canvas box instead of a full parse() — the
// gallery only needs a width/height ratio to reserve the right card height, and
// parsing every scene on each render (server included) buys nothing else here.
// If a scene ever declares its canvas some other way, upgrade this to
// `parse(css).canvas`.
const ROOT_BOX =
  /:root\s*\{[^}]*?\bwidth:\s*([\d.]+)px[^}]*?\bheight:\s*([\d.]+)px/;

/** Scene aspect ratio (width / height), or 1 when the canvas box isn't declared. */
export function sceneAspect(css: string): number {
  const m = ROOT_BOX.exec(css);
  if (!m) return 1;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : 1;
}
