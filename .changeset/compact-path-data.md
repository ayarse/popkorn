---
"@popkorn/player": patch
---

Parse compact path data written by svgo and Illustrator.

Runs of numbers packed without separators (`1.5.5`, `10-20`) now tokenize
correctly, and arc flags packed against their following number (`a5 5 0 015 5`)
are read as flags rather than swallowed into it. Both shapes are what real
optimized SVG exports contain; they previously produced wrong geometry.
