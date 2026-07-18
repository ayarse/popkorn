/**
 * Popkorn Export — Figma plugin sandbox (main) thread.
 *
 * Runs in Figma's sandboxed realm: full document access, but no DOM/fetch. It
 * walks the current selection (or the page when nothing is selected), snapshots
 * each node plus its Motion keyframe tracks into a plain-JSON FigmaCaptureBundle,
 * and hands it to the UI iframe. All actual DSL mapping lives in
 * `@popkorn/converters` (figma2popkorn), which the UI runs — this side only reads
 * the document.
 *
 * NOTE: the Motion API (`manualKeyframeTracks`, `timelines`) shipped in Plugin
 * API v1 update 127 (2026-06-23) and is Beta — shapes may change. Every read is
 * defensive so a document without Motion data still exports its static tree.
 */
import type {
  FigmaCaptureBundle,
  FigmaCaptureEasing,
  FigmaCaptureNode,
  FigmaCaptureTrack,
  FigmaKeyframeValue,
  RGBA,
} from "@popkorn/converters";

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

// Skip images whose bytes exceed this; a multi-MB data URI in a postMessage/JSON
// bundle is heavy. NOTE: a chunked/transferable capture would lift this cap.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// --- capture ---------------------------------------------------------------

function rgba(c: { r: number; g: number; b: number; a?: number }): RGBA {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

/** Detect an image mime from magic bytes; default PNG. */
function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return "image/png";
}

/** Resolve a Figma image hash to a base64 data URI (or an oversize marker). */
async function imageDataUri(
  hash: string,
): Promise<{ dataUri?: string; oversize?: boolean }> {
  try {
    const image = figma.getImageByHash(hash);
    if (!image) return {};
    const bytes = await image.getBytesAsync();
    if (bytes.length > MAX_IMAGE_BYTES) return { oversize: true };
    return {
      dataUri: `data:${sniffMime(bytes)};base64,${figma.base64Encode(bytes)}`,
    };
  } catch {
    return {};
  }
}

function captureValue(v: any): FigmaKeyframeValue | undefined {
  if (!v || typeof v !== "object") return undefined;
  switch (v.type) {
    case "FLOAT":
      return { type: "FLOAT", value: v.value };
    case "COLOR":
      return { type: "COLOR", value: rgba(v.value) };
    case "VECTOR":
      return { type: "VECTOR", value: { x: v.value.x, y: v.value.y } };
    case "BOOL":
      return { type: "BOOL", value: v.value };
    case "TEXT_DATA":
      return { type: "TEXT_DATA", value: v.value };
    default:
      return undefined; // CIRCLE/LINE/etc. not mapped by the converter
  }
}

function captureEasing(e: any): FigmaCaptureEasing | undefined {
  // Easing may be a VariableAlias (bound to a variable) — skip those.
  if (!e || typeof e !== "object" || !("type" in e)) return undefined;
  const out: FigmaCaptureEasing = { type: e.type };
  if (e.easingFunctionCubicBezier) {
    const b = e.easingFunctionCubicBezier;
    out.bezier = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
  }
  if (
    e.easingFunctionSpring &&
    typeof e.easingFunctionSpring.bounce === "number"
  )
    out.bounce = e.easingFunctionSpring.bounce;
  return out;
}

/** Flatten one ManualKeyframeBinding into a capture track. */
function captureBinding(
  property: string,
  binding: any,
): FigmaCaptureTrack | null {
  if (!binding || !Array.isArray(binding.keyframes)) return null;
  const keyframes = binding.keyframes
    .map((k: any) => {
      const value = captureValue(k.value);
      if (!value) return null;
      return {
        t: k.timelinePosition,
        value,
        easing: captureEasing(k.easing),
      };
    })
    .filter(Boolean);
  if (keyframes.length === 0) return null;
  return {
    property,
    baseValue: captureValue(binding.baseValue),
    keyframes,
  };
}

/** Read node.manualKeyframeTracks (property map + indexed fills/strokes). */
function captureTracks(node: any): FigmaCaptureTrack[] {
  const tracks: FigmaCaptureTrack[] = [];
  const mk = node.manualKeyframeTracks;
  if (!mk) return tracks;
  for (const key of Object.keys(mk)) {
    if (key === "fills" || key === "strokes" || key === "effects") continue;
    const t = captureBinding(key, mk[key]);
    if (t) tracks.push(t);
  }
  // Indexed paint color tracks -> synthetic FILL_COLOR / STROKE_COLOR.
  for (const [coll, prop] of [
    ["fills", "FILL_COLOR"],
    ["strokes", "STROKE_COLOR"],
  ] as const) {
    const map = mk[coll];
    if (!map) continue;
    for (const idx of Object.keys(map)) {
      const t = captureBinding(prop, map[idx]);
      if (t) tracks.push(t);
    }
  }
  return tracks;
}

async function captureNode(node: any): Promise<FigmaCaptureNode | null> {
  if (node.visible === false) return null;
  const out: FigmaCaptureNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    isMask: node.isMask,
    width: node.width,
    height: node.height,
  };
  if (node.isMask && node.maskType) out.maskType = node.maskType;
  if (node.relativeTransform) out.relativeTransform = node.relativeTransform;
  else {
    out.x = node.x;
    out.y = node.y;
    out.rotation = node.rotation;
  }

  if (typeof node.cornerRadius === "number")
    out.cornerRadius = node.cornerRadius;
  if (
    Array.isArray(node.rectangleCornerRadii) ||
    node.topLeftRadius !== undefined
  ) {
    out.rectangleCornerRadii = [
      node.topLeftRadius ?? node.cornerRadius ?? 0,
      node.topRightRadius ?? node.cornerRadius ?? 0,
      node.bottomRightRadius ?? node.cornerRadius ?? 0,
      node.bottomLeftRadius ?? node.cornerRadius ?? 0,
    ];
  }

  // Paints. Gradient handles are baked from normalized (0..1) node space to
  // local px so the converter can emit exact gradient geometry; IMAGE paints
  // resolve their bytes to a data URI (async).
  const bakePaints = (paints: any): Promise<any> => {
    if (!Array.isArray(paints)) return Promise.resolve(undefined);
    return Promise.all(
      paints.map(async (p) => {
        const o: any = { type: p.type, visible: p.visible, opacity: p.opacity };
        if (p.color) o.color = rgba(p.color);
        if (Array.isArray(p.gradientStops))
          o.gradientStops = p.gradientStops.map((s: any) => ({
            position: s.position,
            color: rgba(s.color),
          }));
        if (Array.isArray(p.gradientHandlePositions))
          o.gradientHandlePositions = p.gradientHandlePositions.map(
            (h: any) => ({
              x: h.x * (node.width ?? 0),
              y: h.y * (node.height ?? 0),
            }),
          );
        if (p.type === "IMAGE" && p.imageHash) {
          o.imageHash = p.imageHash;
          if (p.scaleMode) o.scaleMode = p.scaleMode;
          const r = await imageDataUri(p.imageHash);
          if (r.dataUri) o.dataUri = r.dataUri;
          else if (r.oversize) o.oversize = true;
        }
        return o;
      }),
    );
  };
  if (node.fills && node.fills !== figma.mixed)
    out.fills = await bakePaints(node.fills);
  if (node.strokes) out.strokes = await bakePaints(node.strokes);
  if (typeof node.strokeWeight === "number")
    out.strokeWeight = node.strokeWeight;
  if (typeof node.clipsContent === "boolean")
    out.clipsContent = node.clipsContent;

  // vectorPaths is flaky on POLYGON/STAR — fall back to fillGeometry when empty.
  const geom =
    Array.isArray(node.vectorPaths) && node.vectorPaths.length
      ? node.vectorPaths
      : node.fillGeometry;
  if (Array.isArray(geom) && geom.length)
    out.vectorPaths = geom.map((v: any) => ({
      windingRule: v.windingRule,
      data: v.data,
    }));
  // Polystar params for the converter's native polygon/star fallback.
  if (typeof node.pointCount === "number") out.pointCount = node.pointCount;
  if (typeof node.innerRadius === "number") out.innerRadius = node.innerRadius;

  if (node.type === "TEXT") {
    out.characters = node.characters;
    out.hasMixedStyle =
      node.fontSize === figma.mixed || node.fontName === figma.mixed;
    if (node.fontSize !== figma.mixed) out.fontSize = node.fontSize;
    if (node.fontName !== figma.mixed) out.fontName = node.fontName;
    out.textAlignHorizontal = node.textAlignHorizontal;
  }

  // Motion.
  const tracks = captureTracks(node);
  if (tracks.length) {
    out.tracks = tracks;
    const tl = node.timelines;
    if (Array.isArray(tl) && tl[0] && typeof tl[0].duration === "number")
      out.timelineDuration = tl[0].duration;
  }

  if (Array.isArray(node.children)) {
    const kids = (await Promise.all(node.children.map(captureNode))).filter(
      Boolean,
    ) as FigmaCaptureNode[];
    if (kids.length) out.children = kids;
  }
  return out;
}

async function build(): Promise<FigmaCaptureBundle> {
  const sel = figma.currentPage.selection;
  const roots = sel.length ? sel : figma.currentPage.children;
  const nodes = (await Promise.all(roots.map(captureNode))).filter(
    Boolean,
  ) as FigmaCaptureNode[];

  // Stage: the page background + the bounding box of the captured roots.
  let w = 800,
    h = 600;
  const box = roots
    .map((n: any) => (typeof n.width === "number" ? n : null))
    .filter(Boolean) as any[];
  if (box.length) {
    w = Math.max(...box.map((n) => (n.x ?? 0) + n.width));
    h = Math.max(...box.map((n) => (n.y ?? 0) + n.height));
  }
  const bg = (figma.currentPage as any).backgrounds?.[0];
  return {
    version: 1,
    name: figma.currentPage.name,
    document: {
      width: Math.ceil(w),
      height: Math.ceil(h),
      background: bg && bg.type === "SOLID" ? rgba(bg.color) : null,
    },
    nodes,
  };
}

figma.ui.onmessage = async (msg) => {
  if (msg?.type === "export") {
    try {
      const bundle = await build();
      figma.ui.postMessage({ type: "bundle", bundle });
    } catch (e: any) {
      figma.ui.postMessage({ type: "error", message: String(e?.message ?? e) });
    }
  } else if (msg?.type === "close") {
    figma.closePlugin();
  }
};
