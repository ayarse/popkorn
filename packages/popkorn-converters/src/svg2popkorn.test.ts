import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Converter, convertSvg, validate } from "./svg2popkorn";

/** Convert and assert the emitted CSS parses + builds a scene graph clean. */
function conv(svg: string) {
  const r = convertSvg(svg);
  expect(validate(r.css)).toEqual([]);
  return r;
}

/** The decl block for `#id { ... }` — the lines between its braces, trimmed. */
function block(css: string, id: string): string {
  const re = new RegExp(`#${id}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "m");
  const m = css.match(re);
  return m ? m[1] : "";
}

// --- stage / viewBox --------------------------------------------------------

test("viewBox sets stage size; zero min emits no root translate", () => {
  const { css } = conv(
    `<svg viewBox="0 0 320 240"><rect width="10" height="10"/></svg>`,
  );
  expect(css).toContain("width: 320px");
  expect(css).toContain("height: 240px");
  expect(css).not.toContain("#root");
});

test("non-zero viewBox min bakes a root translate group", () => {
  const { css } = conv(
    `<svg viewBox="10 20 100 80"><rect width="10" height="10"/></svg>`,
  );
  expect(css).toContain("width: 100px");
  expect(css).toContain("height: 80px");
  expect(block(css, "root")).toContain("transform: translate(-10px, -20px)");
});

test("falls back to width/height attrs when no viewBox", () => {
  const { css } = conv(
    `<svg width="64" height="48"><rect width="10" height="10"/></svg>`,
  );
  expect(css).toContain("width: 64px");
  expect(css).toContain("height: 48px");
});

// --- shape mappings ---------------------------------------------------------

test("rect maps x/y/width/height and mirrors rx-only to ry", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><rect x="5" y="6" width="30" height="20" rx="4" fill="#123456"/></svg>`,
  );
  const b = block(css, "rect1");
  expect(b).toContain("type: rect");
  expect(b).toContain("x: 5px");
  expect(b).toContain("width: 30px");
  expect(b).toContain("rx: 4px");
  expect(b).toContain("ry: 4px");
  expect(b).toContain("fill: #123456");
});

test("circle and ellipse map to native geometry props", () => {
  const c = conv(
    `<svg viewBox="0 0 100 100"><circle cx="10" cy="20" r="5"/></svg>`,
  ).css;
  expect(block(c, "circle1")).toContain("type: circle");
  expect(block(c, "circle1")).toMatch(/cx: 10px[\s\S]*cy: 20px[\s\S]*r: 5px/);
  const e = conv(
    `<svg viewBox="0 0 100 100"><ellipse cx="10" cy="20" rx="8" ry="4"/></svg>`,
  ).css;
  expect(block(e, "ellipse1")).toContain("type: ellipse");
  expect(block(e, "ellipse1")).toMatch(/rx: 8px[\s\S]*ry: 4px/);
});

test("path d is copied byte-for-byte (whitespace normalized)", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><path d="M10 10 L50 50 Z"/></svg>`,
  );
  expect(block(css, "path1")).toContain(`d: 'M10 10 L50 50 Z'`);
});

test("line/polyline/polygon synthesize a path d (polygon closes with Z)", () => {
  const c = conv(
    `<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/><polyline points="0,0 1,1 2,0"/><polygon points="0,0 5,0 5,5"/></svg>`,
  ).css;
  expect(block(c, "line1")).toMatch(/type: path;[\s\S]*d: 'M 0 0 L 10 10'/);
  expect(block(c, "polyline2")).toContain(`d: 'M 0 0 L 1 1 L 2 0'`);
  expect(block(c, "polygon3")).toContain(`d: 'M 0 0 L 5 0 L 5 5 Z'`);
});

test("fill-rule evenodd is emitted", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><path d="M0 0 H10 V10 H0 Z" fill-rule="evenodd"/></svg>`,
  );
  expect(block(css, "path1")).toContain("fill-rule: evenodd");
});

test('fill="none" emits fill: none; absent fill defaults to black', () => {
  const none = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="none"/></svg>`,
  ).css;
  expect(block(none, "rect1")).toContain("fill: none");
  const def = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`,
  ).css;
  expect(block(def, "rect1")).toContain("fill: #000000");
});

// --- stroke -----------------------------------------------------------------

test("stroke props map with matching Popkorn names", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="#f0f" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="3"/></svg>`,
  );
  const b = block(css, "path1");
  expect(b).toContain("stroke: #ff00ff");
  expect(b).toContain("stroke-width: 2px");
  expect(b).toContain("stroke-linecap: round");
  expect(b).toContain("stroke-linejoin: bevel");
  expect(b).toContain("stroke-miterlimit: 3");
});

test("stroke-dasharray / dashoffset map to px lengths", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="black" stroke-dasharray="4 2" stroke-dashoffset="1"/></svg>`,
  );
  expect(block(css, "path1")).toContain("stroke-dasharray: 4px 2px");
  expect(block(css, "path1")).toContain("stroke-dashoffset: 1px");
});

test("fill-opacity / stroke-opacity fold into rgba alpha", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#ff0000" fill-opacity="0.5" stroke="#00ff00" stroke-opacity="0.25"/></svg>`,
  );
  expect(block(css, "rect1")).toContain("fill: rgba(255, 0, 0, 0.5)");
  expect(block(css, "rect1")).toContain("stroke: rgba(0, 255, 0, 0.25)");
});

// --- colors -----------------------------------------------------------------

test("named colors, rgb(), hsl() and currentColor all normalize", () => {
  const named = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="rebeccapurple"/></svg>`,
  );
  // rebeccapurple isn't in the pragmatic table -> warns + black fallback.
  expect(named.warnings.some((w) => w.includes("rebeccapurple"))).toBe(true);
  const rgb = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="rgb(10,20,30)"/></svg>`,
  ).css;
  expect(block(rgb, "rect1")).toContain("fill: #0a141e");
  const hsl = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="hsl(0,100%,50%)"/></svg>`,
  ).css;
  expect(block(hsl, "rect1")).toContain("fill: #ff0000");
});

test("currentColor resolves to the inherited color", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><g color="#ff0000"><rect width="5" height="5" fill="currentColor"/></g></svg>`,
  );
  expect(block(css, "rect1")).toContain("fill: #ff0000");
});

// --- cascade / inheritance --------------------------------------------------

test("cascade precedence: presentation < <style> < inline", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>.a{fill:green}</style><rect class="a" fill="red" style="fill:blue" width="5" height="5"/></svg>`,
  );
  expect(block(css, "rect1")).toContain("fill: #0000ff"); // inline blue wins
});

test("specificity: #id rule beats .class rule", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>.a{fill:green} #r{fill:red}</style><rect id="r" class="a" width="5" height="5"/></svg>`,
  );
  expect(block(css, "r")).toContain("fill: #ff0000");
});

test("descendant selector matches through ancestors", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>g rect{fill:teal}</style><g><rect width="5" height="5"/></g></svg>`,
  );
  expect(css).toContain("fill: #008080");
});

test("exotic combinator selectors warn and are ignored", () => {
  const { warnings } = conv(
    `<svg viewBox="0 0 10 10"><style>g > rect{fill:teal}</style><g><rect width="5" height="5"/></g></svg>`,
  );
  expect(warnings.some((w) => w.includes("exotic"))).toBe(true);
});

test("fill inherits down a group; opacity does not", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><g fill="#abcdef" opacity="0.5"><rect width="5" height="5"/></g></svg>`,
  );
  expect(block(css, "rect1")).toContain("fill: #abcdef");
  // Group carries opacity; child does not inherit it.
  expect(block(css, "g2")).toContain("opacity: 0.5");
  expect(block(css, "rect1")).not.toContain("opacity");
});

// --- transforms -------------------------------------------------------------

test("translate/scale decompose onto the group", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><g transform="translate(10,20) scale(2)"><rect width="5" height="5"/></g></svg>`,
  );
  expect(block(css, "g2")).toContain(
    "transform: translate(10px, 20px) scale(2)",
  );
});

test("rotate(a cx cy) decomposes to translate + rotate", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><g transform="rotate(30 60 60)"><rect x="20" y="20" width="5" height="5"/></g></svg>`,
  );
  const b = block(css, "g2");
  expect(b).toMatch(/transform: translate\([^)]*\) rotate\(30deg\)/);
});

test("shear-free matrix() decomposes; no bake", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><g transform="matrix(1 0 0 1 40 40)"><rect width="5" height="5"/></g></svg>`,
  );
  expect(block(css, "g2")).toContain("transform: translate(40px, 40px)");
  expect(block(css, "rect1")).toContain("type: rect");
});

test("sheared transform bakes geometry into a transformed path + does not emit a transform", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><g transform="skewX(-18)"><rect x="20" y="90" width="80" height="30" fill="#f00"/></g></svg>`,
  );
  // The rect became a path; the group carries no transform.
  expect(css).toContain("type: path");
  expect(block(css, "g1")).not.toContain("transform:");
  expect(css).toContain("fill: #ff0000");
});

// --- use / symbol -----------------------------------------------------------

test("<use> deep-clones the target with an x/y translate", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><defs><circle id="c" cx="0" cy="0" r="5" fill="#f00"/></defs><use href="#c" x="20" y="30"/></svg>`,
  );
  expect(css).toContain("transform: translate(20px, 30px)");
  expect(css).toContain("type: circle");
  expect(css).toContain("fill: #ff0000");
});

test("<symbol> viewBox contributes a viewport scale on <use>", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10" fill="teal"/></symbol><use href="#s" x="10" y="10" width="20" height="20"/></svg>`,
  );
  expect(css).toMatch(/transform: translate\(10px, 10px\) scale\(2\)/);
});

test("<use> cycle is guarded with a warning", () => {
  const { warnings } = conv(
    `<svg viewBox="0 0 10 10"><g id="a"><use href="#a"/></g><use href="#a"/></svg>`,
  );
  expect(warnings.some((w) => w.includes("cycle"))).toBe(true);
});

// --- gradients --------------------------------------------------------------

test("objectBoundingBox linear gradient with gradientTransform + stop-opacity", () => {
  const { css } = conv(`<svg viewBox="0 0 200 120"><defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(20 0.5 0.5)">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="0.6" stop-color="#6366f1" stop-opacity="0.85"/>
    </linearGradient></defs>
    <rect width="200" height="120" fill="url(#g)"/></svg>`);
  const b = block(css, "rect1");
  expect(b).toContain("linear-gradient(from ");
  // gradientTransform rotated the endpoints away from the bbox corners.
  expect(b).not.toContain("from 0px 0px to 200px 120px");
  expect(b).toContain("rgba(99, 102, 241, 0.85) 60%");
});

test("userSpaceOnUse linear gradient uses raw coordinates", () => {
  const { css } = conv(
    `<svg viewBox="0 0 100 100"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`,
  );
  expect(block(css, "rect1")).toContain(
    "linear-gradient(from 0px 0px to 100px 0px, #ff0000 0%, #0000ff 100%)",
  );
});

test("radial gradient maps center/radius/focal; stop-opacity 0 folds to rgba a=0", () => {
  const { css } = conv(
    `<svg viewBox="0 0 200 120"><defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5" fx="0.35" fy="0.35"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></radialGradient></defs><circle cx="150" cy="40" r="34" fill="url(#g)"/></svg>`,
  );
  const b = block(css, "circle1");
  expect(b).toContain(
    "radial-gradient(circle 34px at 150px 40px from 139.8px 29.8px",
  );
  expect(b).toContain("rgba(249, 115, 22, 0) 100%");
});

test("href-inherited gradient template supplies stops", () => {
  const { css } = conv(`<svg viewBox="0 0 100 100"><defs>
    <linearGradient id="base"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#eee"/></linearGradient>
    <linearGradient id="use" href="#base" x1="0" y1="0" x2="1" y2="0"/></defs>
    <rect width="100" height="100" fill="url(#use)"/></svg>`);
  const b = block(css, "rect1");
  expect(b).toContain("#111111 0%");
  expect(b).toContain("#eeeeee 100%");
});

test("spreadMethod reflect/repeat warns (pad only)", () => {
  const { warnings } = conv(
    `<svg viewBox="0 0 100 100"><defs><linearGradient id="g" spreadMethod="reflect"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`,
  );
  expect(warnings.some((w) => w.includes("spreadMethod"))).toBe(true);
});

// --- clip / mask ------------------------------------------------------------

test("clipPath with a single circle child -> circle()", () => {
  const { css } = conv(
    `<svg viewBox="0 0 200 200"><defs><clipPath id="c"><circle cx="100" cy="100" r="80"/></clipPath></defs><g clip-path="url(#c)"><rect width="200" height="200"/></g></svg>`,
  );
  expect(block(css, "g2")).toContain("clip-path: circle(80px at 100px 100px)");
});

test("clipPath with multiple shapes -> union of path()", () => {
  const { css } = conv(
    `<svg viewBox="0 0 200 200"><defs><clipPath id="c"><rect x="0" y="0" width="60" height="60"/><rect x="80" y="80" width="60" height="60"/></clipPath></defs><g clip-path="url(#c)"><rect width="200" height="200"/></g></svg>`,
  );
  const cp = block(css, "g2");
  expect(cp).toMatch(/clip-path: path\('[^']+'\) path\('[^']+'\)/);
});

test("mask emits a matte reference + a hoisted luminance source node", () => {
  const { css } = conv(
    `<svg viewBox="0 0 200 200"><defs><mask id="m"><rect width="200" height="200" fill="#fff"/></mask></defs><g mask="url(#m)"><rect width="200" height="200" fill="#22d3ee"/></g></svg>`,
  );
  expect(css).toContain("mask: #m luminance");
  // The mask content is emitted once at top level as its own node.
  expect(css).toMatch(/#m\s*\{[\s\S]*type: group/);
});

// --- filters ----------------------------------------------------------------

test("single feGaussianBlur -> filter: blur()", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><defs><filter id="b"><feGaussianBlur stdDeviation="3"/></filter></defs><circle cx="5" cy="5" r="4" filter="url(#b)"/></svg>`,
  );
  expect(block(css, "circle1")).toContain("filter: blur(3px)");
});

test("feDropShadow -> filter: drop-shadow()", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><defs><filter id="d"><feDropShadow dx="2" dy="2" stdDeviation="1" flood-color="#333" flood-opacity="0.5"/></filter></defs><rect width="4" height="4" filter="url(#d)"/></svg>`,
  );
  expect(block(css, "rect1")).toContain(
    "filter: drop-shadow(2px 2px 1px rgba(51, 51, 51, 0.5))",
  );
});

test("unsupported multi-primitive filter warns and is skipped", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 10 10"><defs><filter id="f"><feGaussianBlur stdDeviation="1"/><feColorMatrix/></filter></defs><rect width="4" height="4" filter="url(#f)"/></svg>`,
  );
  expect(warnings.some((w) => w.includes("filter"))).toBe(true);
  expect(css).not.toContain("filter:");
});

// --- text / image -----------------------------------------------------------

test("text maps content/x/y/font/anchor; tspans flatten with a warning", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 100 100"><text x="10" y="20" font-size="14" font-family="Comic Sans" font-weight="bold" text-anchor="middle" fill="#000">Hi <tspan>there</tspan></text></svg>`,
  );
  const b = block(css, "text1");
  expect(b).toContain("type: text");
  expect(b).toContain('content: "Hi there"');
  expect(b).toContain("x: 10px");
  expect(b).toContain("font-size: 14px");
  expect(b).toContain('font-family: "Comic Sans"');
  expect(b).toContain("font-weight: bold");
  expect(b).toContain("text-anchor: middle");
  expect(warnings.some((w) => w.includes("tspan"))).toBe(true);
});

test("image with a data URI maps to content: url()", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAAA" x="0" y="0" width="10" height="10"/></svg>`,
  );
  const b = block(css, "image1");
  expect(b).toContain("type: image");
  expect(b).toContain(`content: url('data:image/png;base64,AAAA')`);
  expect(b).toContain("width: 10px");
});

// --- warnings / blocked -----------------------------------------------------

// --- SMIL <animate> / <animateTransform> import (phase 2 part 2) ------------

test("SMIL <animate> values + keyTimes → keyframe stops", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" values="1;0.2;1" keyTimes="0;0.25;1" dur="2s" repeatCount="indefinite"/></rect></svg>`,
  );
  expect(warnings).toEqual([]);
  expect(css).toContain("0% { opacity: 1;");
  expect(css).toContain("25% { opacity: 0.2;");
  expect(css).toContain("100% { opacity: 1;");
  expect(block(css, "rect1")).toContain(
    "animation: rect1-opacity 2s linear infinite",
  );
});

test("SMIL <animate> from/to → two stops with even spacing", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" from="1" to="0" dur="1s"/></rect></svg>`,
  );
  expect(css).toContain("0% { opacity: 1;");
  expect(css).toContain("100% { opacity: 0;");
});

test("SMIL <animate> from/by computes the endpoint", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="stroke-width" from="2" by="3" dur="1s"/></rect></svg>`,
  );
  expect(css).toContain("stroke-width: 5px");
});

test("SMIL animateTransform rotate without center", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 48 48"><rect width="10" height="10"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite"/></rect></svg>`,
  );
  expect(warnings).toEqual([]);
  expect(css).toContain("transform: rotate(360deg)");
  expect(block(css, "rect1")).not.toContain("transform-origin");
});

test("SMIL animateTransform rotate with center → transform-origin", () => {
  const { css } = conv(
    `<svg viewBox="0 0 48 48"><rect width="10" height="10"><animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="1s"/></rect></svg>`,
  );
  expect(block(css, "rect1")).toContain("transform-origin: 24px 24px");
});

test("SMIL calcMode=spline → per-stop cubic-bezier easing", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" values="0;1" dur="1s" calcMode="spline" keySplines="0.42 0 0.58 1"/></rect></svg>`,
  );
  expect(css).toContain(
    "animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1)",
  );
});

test("SMIL calcMode=discrete → step-end easing", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" values="0;1" dur="1s" calcMode="discrete"/></rect></svg>`,
  );
  expect(css).toContain("animation-timing-function: step-end");
});

test("SMIL fill=freeze → forwards fill mode", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" from="1" to="0" dur="1s" fill="freeze"/></rect></svg>`,
  );
  expect(block(css, "rect1")).toContain("forwards");
});

test("SMIL unmappable attributeName warns and drops", () => {
  const { warnings, css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="width" from="5" to="8" dur="1s"/></rect></svg>`,
  );
  expect(warnings.some((w) => w.includes("not supported"))).toBe(true);
  expect(block(css, "rect1")).not.toContain("animation:");
});

test("SMIL <set> is still skipped with a warning", () => {
  const { warnings, css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><set attributeName="opacity" to="0"/></rect></svg>`,
  );
  expect(warnings.some((w) => w.includes("<set>"))).toBe(true);
  expect(block(css, "rect1")).not.toContain("animation:");
});

test("SMIL same-channel conflict warns and keeps the first", () => {
  const { warnings, css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"><animate attributeName="opacity" from="1" to="0" dur="1s"/><animate attributeName="opacity" from="0" to="1" dur="2s"/></rect></svg>`,
  );
  expect(warnings.some((w) => w.includes("only the first kept"))).toBe(true);
  const b = block(css, "rect1");
  expect(b).toContain("animation: rect1-opacity 1s linear");
  expect(b).not.toContain("2s");
});

// --- CSS @keyframes animation import (phase 2) ------------------------------

test("imports a transform @keyframes + animation shorthand (spinner)", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 48 48"><style>@keyframes spin { to { transform: rotate(360deg); } } .s{transform-origin:24px 24px;animation: spin 1s linear infinite}</style><path class="s" d="M24 4 a20 20 0 0 1 20 20"/></svg>`,
  );
  expect(warnings).toEqual([]);
  expect(css).toContain("@keyframes spin {");
  expect(css).toContain("100% { transform: rotate(360deg); }");
  const b = block(css, "path1");
  expect(b).toContain("animation: spin 1s linear infinite");
  expect(b).toContain("transform-origin: 24px 24px");
});

test("imports opacity + fill keyframes with percentage stops", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>@keyframes blink { 0%{opacity:1;fill:#f00} 50%{opacity:0.2;fill:#00ff00} 100%{opacity:1;fill:red} }</style><rect class="b" width="5" height="5" style="animation:blink 2s ease-in-out infinite"/></svg>`,
  );
  expect(css).toContain("@keyframes blink {");
  expect(css).toContain("0% { opacity: 1; fill: #ff0000; }");
  expect(css).toContain("50% { opacity: 0.2; fill: #00ff00; }");
  expect(block(css, "rect1")).toContain(
    "animation: blink 2s ease-in-out infinite",
  );
});

test("animation shorthand: duration/iteration/direction/fill-mode round-trip", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>@keyframes m { to{opacity:0} }</style><rect class="x" width="5" height="5" style="animation:m 500ms 1s 3 alternate forwards"/></svg>`,
  );
  const b = block(css, "rect1");
  expect(b).toContain("animation: m 500ms 1s 3 alternate forwards");
});

test("infinite iteration is preserved", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>@keyframes p { to{opacity:0} }</style><rect class="x" width="5" height="5" style="animation:p 1s infinite"/></svg>`,
  );
  expect(block(css, "rect1")).toContain("animation: p 1s infinite");
});

test("per-keyframe cubic-bezier and steps easing map through", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><style>@keyframes e { 0%{opacity:1;animation-timing-function:cubic-bezier(0.3,0,1,1)} 50%{opacity:0.5;animation-timing-function:steps(4, jump-end)} 100%{opacity:1} }</style><rect class="x" width="5" height="5" style="animation:e 1s linear infinite"/></svg>`,
  );
  expect(css).toContain(
    "0% { opacity: 1; animation-timing-function: cubic-bezier(0.3,0,1,1); }",
  );
  expect(css).toContain("animation-timing-function: steps(4, jump-end);");
});

test("unmappable animated property warns and is dropped, mappable kept", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 10 10"><style>@keyframes w { 0%{opacity:1;width:5} 100%{opacity:0;width:10} }</style><rect class="x" width="5" height="5" style="animation:w 1s linear"/></svg>`,
  );
  expect(warnings.some((m) => m.includes("'width' not supported"))).toBe(true);
  expect(css).toContain("0% { opacity: 1; }");
  expect(css).not.toContain("width: 10;");
});

test("referencing an undefined @keyframes warns and drops the animation", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 10 10"><style>.x{animation:ghost 1s linear}</style><rect class="x" width="5" height="5"/></svg>`,
  );
  expect(warnings.some((m) => m.includes("no matching @keyframes"))).toBe(true);
  expect(css).not.toContain("animation:");
});

test("animated transform on a sheared/baked element is NOT baked live — dropped with warning", () => {
  // The outer skew forces geometry baking; the inner element's animated
  // transform can't ride the baked path, so it must degrade with a warning
  // (never silently apply in the wrong space).
  const { css, warnings } = conv(
    `<svg viewBox="0 0 100 100"><style>@keyframes r { to{transform:rotate(90deg)} }</style><g transform="skewX(20)"><rect class="s" width="10" height="10" style="animation:r 1s linear infinite"/></g></svg>`,
  );
  expect(warnings.some((m) => m.includes("baked/sheared"))).toBe(true);
  // Geometry stayed baked to a path; no transform channel emitted.
  expect(css).toContain("type: path");
  expect(css).not.toContain("transform: rotate(90deg)");
});

test("animated transform on an un-sheared element stays live (native shape kept)", () => {
  const { css, warnings } = conv(
    `<svg viewBox="0 0 100 100"><style>@keyframes r { to{transform:rotate(90deg)} }</style><rect class="s" width="10" height="10" transform-origin="5px 5px" style="animation:r 1s linear infinite"/></svg>`,
  );
  expect(warnings).toEqual([]);
  const b = block(css, "rect1");
  expect(b).toContain("type: rect"); // NOT baked to a path
  expect(b).toContain("animation: r 1s linear infinite");
  expect(css).toContain("100% { transform: rotate(90deg); }");
});

test("@media-wrapped @keyframes degrades to a warning", () => {
  const { warnings } = conv(
    `<svg viewBox="0 0 10 10"><style>@media (min-width:1px){@keyframes q{to{opacity:0}}}</style><rect width="5" height="5"/></svg>`,
  );
  expect(warnings.some((m) => m.includes("@media"))).toBe(true);
});

test("pattern / marker / foreignObject / textPath land in the blocked set", () => {
  const pat = conv(
    `<svg viewBox="0 0 10 10"><pattern id="p"/><rect width="5" height="5"/></svg>`,
  );
  expect(pat.blocked).toContain("pattern");
  const mk = conv(
    `<svg viewBox="0 0 10 10"><marker id="m"/><rect width="5" height="5"/></svg>`,
  );
  expect(mk.blocked).toContain("marker");
  const fo = conv(
    `<svg viewBox="0 0 10 10"><foreignObject/><rect width="5" height="5"/></svg>`,
  );
  expect(fo.blocked).toContain("foreignObject");
});

test("display:none / visibility:hidden drop the node", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5" display="none"/><rect width="4" height="4" fill="#0f0"/></svg>`,
  );
  expect(css).not.toContain("display");
  expect(css).toContain("fill: #00ff00");
});

// --- id handling ------------------------------------------------------------

test("SVG ids are preserved (sanitized); missing names get stable generated ids", () => {
  const { css } = conv(
    `<svg viewBox="0 0 10 10"><rect id="my-box" width="5" height="5"/><circle cx="1" cy="1" r="1"/></svg>`,
  );
  expect(css).toContain("#my-box");
  expect(css).toContain("#circle1");
});

// --- exported API contract --------------------------------------------------

test("exported API matches the frozen contract", () => {
  const c = new Converter();
  expect(typeof c.convert).toBe("function");
  expect(Array.isArray(c.warnings)).toBe(true);
  expect(c.blocked instanceof Set).toBe(true);
  const out = convertSvg(
    `<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`,
  );
  expect(typeof out.css).toBe("string");
  expect(Array.isArray(out.warnings)).toBe(true);
  expect(Array.isArray(out.blocked)).toBe(true);
  expect(validate(out.css)).toEqual([]);
});

// --- reference corpus -------------------------------------------------------

test("every examples/svg fixture converts to valid Popkorn CSS", () => {
  const dir = join(import.meta.dir, "..", "examples", "svg");
  if (!existsSync(dir)) return; // Agent 3 owns these; tolerate absence.
  const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));
  for (const f of files) {
    const svg = readFileSync(join(dir, f), "utf8");
    const { css } = convertSvg(svg);
    expect(validate(css)).toEqual([]);
  }
});
