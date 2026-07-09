// Browser-safe conversion cores. The CLI lives in ./cli.ts (bin: popcorn-convert)
// and is the only file here that touches the filesystem.
export {
  Converter as LottieConverter,
  convertLottie,
  validate,
} from "./lottie2popcorn";
export { parseXml, type SvgNode } from "./svg-xml";
export { Converter as SvgConverter, convertSvg } from "./svg2popcorn";
