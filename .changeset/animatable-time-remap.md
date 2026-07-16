---
"@popkorn/player": minor
---

Make `time-remap` animatable, and report unbounded scenes honestly.

`time-remap` can now be driven by keyframes, so a state machine can play a
segment of a subtree's timeline. Alongside it, a scene with no honest end — a
state machine, or one whose animations all loop `infinite` — now free-runs its
clock instead of wrapping at a nominal duration, and `RenderLoop.duration`
reports `Infinity` for it rather than a finite total that playback ignores.

Breaking: `duration` can now be `Infinity`. A host reading it (to size a
scrubber, say) must handle that; the bundled controls hide the seeker.
