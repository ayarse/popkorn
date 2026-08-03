// Browser-safe conversion cores. The CLI lives in ./cli.ts (bin: popkorn-convert)
// and is the only file here that touches the filesystem.

export {
  Converter as FigmaConverter,
  convertFigma,
  type FigmaCaptureBundle,
  type FigmaCaptureEasing,
  type FigmaCaptureKeyframe,
  type FigmaCaptureNode,
  type FigmaCaptureTrack,
  type FigmaKeyframeValue,
  type FigmaPaint,
  type RGBA,
} from "./figma2popkorn.js";
export {
  Converter as LottieConverter,
  convertLottie,
  validate,
} from "./lottie2popkorn.js";
export { parseXml, type SvgNode } from "./svg-xml.js";
export { Converter as SvgConverter, convertSvg } from "./svg2popkorn.js";
