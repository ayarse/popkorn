// Curated example gallery for the Popcorn demo.
// Ordered simple -> advanced; each scene shows one clear capability cluster.

export interface Example {
  key: string;
  label: string;
  source: string;
}

export const examples: Example[] = [
  {
    key: 'shapes',
    label: 'Shapes',
    source: `/* Shapes — gradients, polystar, rounded rects, text, clip-path */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Gradient backdrop card with a gradient hairline border */
#card {
  type: rect;
  x: 90px;
  y: 120px;
  width: 620px;
  height: 380px;
  rx: 28px;
  ry: 28px;
  fill: linear-gradient(135deg, #1b1b3a 0%, #2d1b4e 100%);
  stroke: linear-gradient(90deg, #4ecdc4 0%, #f472b6 100%);
  stroke-width: 2px;
}

/* Radial-gradient orb */
#orb {
  type: circle;
  cx: 230px;
  cy: 310px;
  r: 82px;
  fill: radial-gradient(#ffe66d 0%, #ff6b6b 100%);
}

/* A five-point star (polystar geometry) with a gradient fill */
#star {
  type: star;
  points: 5;
  outer-radius: 84px;
  inner-radius: 36px;
  cx: 410px;
  cy: 300px;
  fill: linear-gradient(180deg, #4ecdc4 0%, #60a5fa 100%);
  stroke: #ffffff;
  stroke-width: 2px;
}

/* Colour bands revealed through a circular clip-path */
#medallion {
  type: group;
  clip-path: circle(60 at 590 300);

  > #b1 { type: rect; x: 528px; y: 240px; width: 124px; height: 30px; fill: #4ecdc4; }
  > #b2 { type: rect; x: 528px; y: 270px; width: 124px; height: 30px; fill: #ffe66d; }
  > #b3 { type: rect; x: 528px; y: 300px; width: 124px; height: 30px; fill: #f472b6; }
  > #b4 { type: rect; x: 528px; y: 330px; width: 124px; height: 30px; fill: #60a5fa; }
}

/* Text takes a gradient fill just like a shape */
#title {
  type: text;
  content: "Popcorn";
  x: 400px;
  y: 195px;
  font-size: 52px;
  font-weight: bold;
  text-anchor: middle;
  fill: linear-gradient(90deg, #ffe66d 0%, #f472b6 100%);
}

#subtitle {
  type: text;
  content: "shapes · gradients · text · clip";
  x: 400px;
  y: 470px;
  font-size: 19px;
  text-anchor: middle;
  fill: #8b8ba7;
}`,
  },

  {
    key: 'motion',
    label: 'Motion',
    source: `/* Motion — a domino run. A ball rolls in at constant speed and topples a colour
   cascade; each tile falls under gravity (accelerating ease-in), rebounds, holds
   flat for a beat, then rises to reset. One composed phrase, staggered by delay
   so the wave reads as choreography — not a chart. */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Stand and wait, then fall fast (gravity), snap-rebound on impact, lie still (the
   held beat), and stand back up. The fall sits at 45% of the timeline so each tile
   waits upright until the ball reaches it. Every keyframe restates the transform so
   the rotate track never drops to base. */
@keyframes topple {
  0%   { transform: rotate(0deg);  animation-timing-function: linear; }
  45%  { transform: rotate(0deg);  animation-timing-function: cubic-bezier(0.5, 0, 0.85, 0.35); }
  58%  { transform: rotate(84deg); animation-timing-function: ease-out; }
  62%  { transform: rotate(79deg); animation-timing-function: ease-in-out; }
  82%  { transform: rotate(79deg); animation-timing-function: ease-in-out; }
  94%  { transform: rotate(0deg);  animation-timing-function: linear; }
  100% { transform: rotate(0deg); }
}

/* The ball crosses at a steady linear pace, spinning as it goes; it fades in at the
   left and out past the right so the loop seam is invisible. */
@keyframes roll {
  0%   { transform: translateX(161px)  rotate(0deg);    opacity: 0; }
  3%   { transform: translateX(190px)  rotate(76deg);   opacity: 1; }
  68%  { transform: translateX(825px)  rotate(1731deg); opacity: 1; }
  72%  { transform: translateX(864px)  rotate(1833deg); opacity: 0; }
  100% { transform: translateX(1137px) rotate(2546deg); opacity: 0; }
}

#shelf { type: rect; x: 140px; y: 440px; width: 540px; height: 8px; rx: 4px; fill: #23233f; }

/* A standing tile, pivoting about its base so it topples like a domino */
@define domino {
  type: rect; y: 344px; width: 20px; height: 96px; rx: 3px;
  transform-origin: center bottom;
}

/* The stagger is expressed as negative (phase-shifted) delays so it never extends
   the scene duration past 3.2s — every animation shares that period and the loop
   is seam-free. Each delay is its cascade time minus one full period. */
#d1 { use: domino; x: 200px; fill: linear-gradient(180deg, #4ecdc4 0%, #2f8f88 100%); animation: topple 3.2s linear infinite -1.28s; }
#d2 { use: domino; x: 255px; fill: linear-gradient(180deg, #60a5fa 0%, #3567b0 100%); animation: topple 3.2s linear infinite -1.10s; }
#d3 { use: domino; x: 310px; fill: linear-gradient(180deg, #818cf8 0%, #4c53b0 100%); animation: topple 3.2s linear infinite -0.92s; }
#d4 { use: domino; x: 365px; fill: linear-gradient(180deg, #a855f7 0%, #6b2fa8 100%); animation: topple 3.2s linear infinite -0.74s; }
#d5 { use: domino; x: 420px; fill: linear-gradient(180deg, #f472b6 0%, #a83f7c 100%); animation: topple 3.2s linear infinite -0.56s; }
#d6 { use: domino; x: 475px; fill: linear-gradient(180deg, #fb7185 0%, #b03f52 100%); animation: topple 3.2s linear infinite -0.38s; }
#d7 { use: domino; x: 530px; fill: linear-gradient(180deg, #ffa94d 0%, #c06e26 100%); animation: topple 3.2s linear infinite -0.20s; }
#d8 { use: domino; x: 585px; fill: linear-gradient(180deg, #ffe66d 0%, #bfa32f 100%); animation: topple 3.2s linear infinite -0.02s; }

/* Base translate carries the vertical rest position; roll's translateX overrides x each frame */
#ball {
  type: group;
  transform: translate(0px, 418px);
  animation: roll 3.2s linear infinite;

  > #ballBody { type: circle; cx: 0; cy: 0; r: 22px; fill: radial-gradient(#ffffff 0%, #ff8f5e 100%); }
  > #ballMark { type: circle; cx: 11px; cy: 0; r: 5px; fill: #c94f2a; }
}`,
  },

  {
    key: 'hierarchy',
    label: 'Hierarchy',
    source: `/* Hierarchy — nested orbits, trim trails, a moon on its own clock */
:canvas {
  width: 800px;
  height: 600px;
  background: #05060f;
}

@keyframes orbit {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* A trim window marching around a ring reads as an orbital trail */
@keyframes trail {
  0%   { trim-offset: 0%; }
  100% { trim-offset: 100%; }
}

@keyframes sunPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}

#space {
  type: group;
  transform: translate(400px, 300px);

  /* Faint orbit rings */
  > #ring1 { type: circle; cx: 0; cy: 0; r: 150px; fill: none; stroke: #17203f; stroke-width: 2px; }
  > #ring2 { type: circle; cx: 0; cy: 0; r: 250px; fill: none; stroke: #17203f; stroke-width: 2px; }

  /* Bright trailing arcs, each matched to its planet's period */
  > #trail1 {
    type: circle; cx: 0; cy: 0; r: 150px;
    fill: none; stroke: #4ecdc4; stroke-width: 3px; stroke-linecap: round;
    trim-start: 0%; trim-end: 20%;
    animation: trail 8s linear infinite;
  }
  > #trail2 {
    type: circle; cx: 0; cy: 0; r: 250px;
    fill: none; stroke: #e94560; stroke-width: 3px; stroke-linecap: round;
    trim-start: 0%; trim-end: 13%;
    animation: trail 14s linear infinite;
  }

  /* The sun, gently breathing */
  > #sun {
    type: circle; cx: 0; cy: 0; r: 46px;
    fill: radial-gradient(#fff6d5 0%, #ffb02e 100%);
    transform-origin: center;
    animation: sunPulse 3s ease-in-out infinite;
  }

  /* Earth orbits the sun; the moon subtree runs at double speed via time-scale */
  > #earthOrbit {
    type: group;
    animation: orbit 8s linear infinite;

    > #earth {
      type: circle; cx: 150px; cy: 0; r: 18px;
      fill: radial-gradient(#8fd6ff 0%, #2f6fb0 100%);
    }

    > #moonSystem {
      type: group;
      transform: translate(150px, 0);
      time-scale: 2;
      animation: orbit 2s linear infinite;

      > #moon { type: circle; cx: 34px; cy: 0; r: 7px; fill: #cbd5e1; }
    }
  }

  /* Mars, slower and further out */
  > #marsOrbit {
    type: group;
    animation: orbit 14s linear infinite;

    > #mars {
      type: circle; cx: 250px; cy: 0; r: 14px;
      fill: radial-gradient(#ff9e7d 0%, #c0392b 100%);
    }
  }
}`,
  },

  {
    key: 'interactive',
    label: 'Interactive',
    source: `/* Interactive — a giant eye that watches your cursor. One idea: the iris tracks
   the pointer through input()/var() bindings; the same iris dilates on hover and
   constricts when you press it (:hover / :active). Move around, then poke it. */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

:root {
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

/* A slow idle breath so the eye feels alive even before you touch it */
@keyframes breathe {
  0%, 100% { transform: scale(1);    }
  50%      { transform: scale(1.05); }
}

/* Full-bleed sclera; the two dark lids carve it into an almond eye */
#sclera    { type: ellipse; cx: 400px; cy: 300px; rx: 400px; ry: 260px;
             fill: radial-gradient(#fdf6e9 0%, #e9d4b0 100%); }
#lidTop    { type: ellipse; cx: 400px; cy: -80px; rx: 520px; ry: 210px; fill: #0f0f23; }
#lidBottom { type: ellipse; cx: 400px; cy: 680px; rx: 520px; ry: 210px; fill: #0f0f23; }

/* The iris follows the cursor; hover dilates it, pressing constricts it */
#iris {
  type: circle; cx: var(--cursor-x); cy: var(--cursor-y); r: 72px;
  fill: radial-gradient(#5eead4 0%, #0f766e 100%);
  stroke: #134e4a; stroke-width: 4px;
  transform-origin: center;
  animation: breathe 3.4s ease-in-out infinite;
  &:hover  { transform: scale(1.14); }
  &:active { fill: radial-gradient(#2dd4bf 0%, #063f39 100%); transform: scale(0.6); }
}

/* Pupil + glint carry no pseudo-state, so they never intercept the iris's hits */
#pupil { type: circle; cx: var(--cursor-x); cy: var(--cursor-y); r: 30px; fill: #0a0a12; }
#glint { type: circle; cx: var(--cursor-x); cy: var(--cursor-y); r: 9px;  fill: #ffffff; opacity: 0.9; }`,
  },

  {
    key: 'motionPath',
    label: 'Motion path',
    source: `/* Motion path — travel a route by arc length; offset-rotate faces the tangent.
   The stadium circuit is centred on the 800×600 stage with generous margins. */
:canvas {
  width: 800px;
  height: 600px;
  background: #0b1021;
}

@keyframes fly {
  0%   { offset-distance: 0%;   }
  100% { offset-distance: 100%; }
}

/* The route itself, drawn once as a dashed guide (x 90..710, y 170..430) */
#route {
  type: path;
  d: "M 220 170 L 580 170 A 130 130 0 0 1 580 430 L 220 430 A 130 130 0 0 1 220 170 Z";
  fill: none;
  stroke: #2a3350;
  stroke-width: 3px;
  stroke-dasharray: 10px 12px;
  stroke-linecap: round;
}

/* A little paper plane, drawn nose-first along +x so the tangent aims it */
@define plane {
  type: path;
  d: "M -14 -9 L 16 0 L -14 9 L -6 0 Z";
  stroke: #0b1021;
  stroke-width: 1px;
  offset-path: path("M 220 170 L 580 170 A 130 130 0 0 1 580 430 L 220 430 A 130 130 0 0 1 220 170 Z");
  offset-rotate: auto;
}

/* Three planes on one loop, staggered by negative delay (already in flight) */
#plane1 { use: plane; fill: #ffe66d; animation: fly 6s linear infinite;      }
#plane2 { use: plane; fill: #4ecdc4; animation: fly 6s linear infinite -2s;  }
#plane3 { use: plane; fill: #f472b6; animation: fly 6s linear infinite -4s;  }`,
  },

  {
    key: 'bouncyBall',
    label: 'Bounce',
    source: `/* Bounce — per-keyframe easing with squash & stretch */
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

/*
 * Per-keyframe easing drives the physics:
 *  - ease-in while falling (gravity accelerates the ball)
 *  - ease-out while rising (it decelerates against gravity)
 *  - squash on impact, stretch on the way up
 */
@keyframes ballBounce {
  0%   { transform: translateY(0);                          animation-timing-function: ease-in;  }
  45%  { transform: translateY(280px) scaleX(1.3) scaleY(0.7); animation-timing-function: ease-out; }
  50%  { transform: translateY(260px) scaleX(0.9) scaleY(1.1); animation-timing-function: ease-out; }
  75%  { transform: translateY(100px) scaleX(1) scaleY(1);  animation-timing-function: ease-in;  }
  100% { transform: translateY(0); }
}

@keyframes shadowPulse {
  0%   { transform: scaleX(0.5) scaleY(1); opacity: 0.2;  animation-timing-function: ease-in;  }
  45%  { transform: scaleX(1.4) scaleY(1); opacity: 0.5;  animation-timing-function: ease-out; }
  75%  { transform: scaleX(0.7) scaleY(1); opacity: 0.25; animation-timing-function: ease-in;  }
  100% { transform: scaleX(0.5) scaleY(1); opacity: 0.2;  }
}

#ground { type: rect; x: 100px; y: 480px; width: 600px; height: 4px; rx: 2px; fill: #4a4a6a; }

#ballShadow {
  type: ellipse; cx: 400px; cy: 475px; rx: 50px; ry: 8px; fill: #000000;
  transform-origin: center;
  animation: shadowPulse 1.2s linear infinite;
}

#ball {
  type: circle; cx: 400px; cy: 150px; r: 40px; fill: #ff6b6b;
  transform-origin: center bottom;
  animation: ballBounce 1.2s linear infinite;
}

#ballHighlight {
  type: circle; cx: 385px; cy: 135px; r: 12px; fill: #ffaaaa;
  transform-origin: 400px 190px;
  animation: ballBounce 1.2s linear infinite;
}`,
  },

  {
    key: 'trimPaths',
    label: 'Trim',
    source: `/* Trim paths — progressive stroke reveal and a marching dash window */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Reveal the stroke from 0% to 100% of its length */
@keyframes draw {
  0%   { trim-end: 0%;   }
  100% { trim-end: 100%; }
}

/* Slide a fixed trim window around a closed outline */
@keyframes march {
  0%   { trim-offset: 0%;   }
  100% { trim-offset: 100%; }
}

/* A wave that draws itself over and over — stroke-only, round caps keep the tip clean */
#wave {
  type: path;
  d: 'M100 280 C200 100 300 460 400 280 C500 100 600 460 700 280';
  fill: none;
  stroke: #4ecdc4;
  stroke-width: 8px;
  stroke-linecap: round;
  animation: draw 2.5s ease-in-out infinite;
}

/* A marching dash: a 25% window slides around via animated trim-offset */
#marchingCircle {
  type: circle;
  cx: 400px;
  cy: 470px;
  r: 70px;
  fill: none;
  stroke: #e94560;
  stroke-width: 6px;
  stroke-linecap: round;
  trim-start: 0%;
  trim-end: 25%;
  animation: march 3s linear infinite;
}`,
  },

  {
    key: 'morph',
    label: 'Morph',
    source: `/* Morph — path 'd' interpolation with animated gradient stops.
   Both keyframes share the same command sequence (M C C C C Z) and stop count,
   so 'd' and 'fill' interpolate. Break either and it holds instead. */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f1e;
}

@keyframes blob {
  0% {
    d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 C 317 450 250 383 250 300 C 250 217 317 150 400 150 Z';
    fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%);
  }
  100% {
    d: 'M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 C 300 450 230 380 250 290 C 270 200 300 90 400 130 Z';
    fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%);
  }
}

#blob {
  type: path;
  d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 C 317 450 250 383 250 300 C 250 217 317 150 400 150 Z';
  fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%);
  animation: blob 3s ease-in-out infinite alternate;
}`,
  },

  {
    key: 'symbols',
    label: 'Symbols',
    source: `/* Symbols — one @define reused as many instances, plus a text node */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

@keyframes twinkle {
  0%, 100% { transform: scale(1);   opacity: 1;   }
  50%      { transform: scale(1.6); opacity: 0.5; }
}

/* A pulsing star symbol; each instance animates on its own independent clone */
@define star {
  type: circle;
  r: 12px;
  fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#title {
  type: text;
  content: "Symbols + Text";
  x: 400px;
  y: 120px;
  font-size: 44px;
  font-family: sans-serif;
  font-weight: bold;
  text-anchor: middle;
  fill: #e2e8f0;
}

/* Three instances: repositioned and recoloured at the use-site */
#star1 { use: star; cx: 260px; cy: 340px; }
#star2 { use: star; cx: 400px; cy: 340px; fill: #60a5fa; }
#star3 { use: star; cx: 540px; cy: 340px; fill: #f472b6; }`,
  },

  {
    key: 'matte',
    label: 'Matte',
    source: `/* Matte — big text revealed through a sweeping bar (luma track matte) */
:canvas {
  width: 800px;
  height: 600px;
  background: #0b1021;
}

/* The matte source is a white bar that sweeps across. Driving a luma matte, it
   is never drawn itself — only its brightness shows the content through. */
@keyframes sweep {
  0%   { transform: translateX(-700px); }
  100% { transform: translateX(700px);  }
}

#reveal {
  type: text;
  content: "POPCORN";
  x: 400px;
  y: 360px;
  font-size: 150px;
  font-weight: 700;
  text-anchor: middle;
  fill: #ffe66d;
  matte: #wipe luma;
}

#wipe {
  type: rect;
  x: 100px;
  y: 180px;
  width: 240px;
  height: 260px;
  fill: #ffffff;
  animation: sweep 3s ease-in-out infinite alternate;
}`,
  },
];
