// Thanksgiving turkey — converted from examples/lottie/thanksgiving-turkey.json
// via tools/lottie2popcorn-cli.ts. Pure shapes/paths (no text or images), so it
// renders fully on the Skia PoC. Inlined as a TS string because Metro cannot
// import raw .css text without extra config.
export const TURKEY_SCENE = `/* Generated from Lottie by tools/lottie2popcorn.ts */
/* comp 512x512 @ 60fps, duration 1s */

:root {
  width: 512px;
  height: 512px;
}

@keyframes Left_foot-Forma-1-Trazado-1-k {
  0% { d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38'; }
  33.33% { d: 'M -34.75 179.88 C -34.75 179.88 -25.86 185.72 -30 197 C -35.5 212 -54.37 217.38 -54.37 217.38'; }
  66.67% { d: 'M -34.75 179.88 C -34.75 179.88 -25.86 185.72 -30 197 C -35.5 212 -54.37 217.38 -54.37 217.38'; }
  100% { d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38'; }
}

@keyframes Right_foot-Forma-1-Trazado-1-k {
  0% { d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38'; }
  33.33% { d: 'M -92.25 161.38 C -92.25 161.38 -92.87 179.25 -87.5 190 C -79.69 205.61 -54.37 217.38 -54.37 217.38'; }
  66.67% { d: 'M -92.25 161.38 C -92.25 161.38 -92.87 179.25 -87.5 190 C -79.69 205.61 -54.37 217.38 -54.37 217.38'; }
  100% { d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38'; }
}

@keyframes Wing_Right_Position-k {
  0% { transform: translate(30px, 151px); }
  33.33% { transform: translate(30px, 172px); }
  66.67% { transform: translate(30px, 172px); }
  100% { transform: translate(30px, 151px); }
}

@keyframes wing-contornos-k {
  0% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.682); }
  1.67% { transform: rotate(0.5deg); }
  3.33% { transform: rotate(1.9deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  5% { transform: rotate(4.06deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  6.67% { transform: rotate(6.84deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  8.33% { transform: rotate(10.11deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(13.73deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(17.55deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(21.45deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(25.27deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(28.89deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(32.16deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(34.94deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(37.1deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(38.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(39deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(38.5deg); }
  28.33% { transform: rotate(37.1deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(34.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(32.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(28.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(25.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(21.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(17.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(13.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(10.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  43.33% { transform: rotate(6.84deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  45% { transform: rotate(4.06deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  46.67% { transform: rotate(1.9deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  48.33% { transform: rotate(0.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1.138); }
  50% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.052, 0.833, 0.751); }
  51.67% { transform: rotate(1.32deg); animation-timing-function: cubic-bezier(0.167, 0.125, 0.833, 0.816); }
  53.33% { transform: rotate(3.94deg); animation-timing-function: cubic-bezier(0.167, 0.153, 0.833, 0.827); }
  55% { transform: rotate(7.09deg); animation-timing-function: cubic-bezier(0.167, 0.16, 0.833, 0.831); }
  56.67% { transform: rotate(10.5deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(14.01deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(17.54deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(21.01deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(24.36deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(27.54deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(30.5deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(33.16deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(35.46deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(37.29deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(38.53deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(39deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(38.5deg); }
  78.33% { transform: rotate(37.1deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(34.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(32.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(28.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(25.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(21.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(17.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(13.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(10.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  93.33% { transform: rotate(6.84deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  95% { transform: rotate(4.06deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  96.67% { transform: rotate(1.9deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  98.33% { transform: rotate(0.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 0.917); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-2-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.912); }
  3.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.697); }
  5% { transform: rotate(1.06deg); animation-timing-function: cubic-bezier(0.167, 0.115, 0.833, 0.819); }
  6.67% { transform: rotate(3.84deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  8.33% { transform: rotate(7.11deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(10.73deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(14.55deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(18.45deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(22.27deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(25.89deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(29.16deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(31.94deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(34.1deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(35.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(36deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(35.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  28.33% { transform: rotate(34.1deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(31.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(29.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(25.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(22.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(18.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(14.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(10.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(7.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  43.33% { transform: rotate(3.84deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.885); }
  45% { transform: rotate(1.06deg); animation-timing-function: cubic-bezier(0.167, 0.303, 0.833, 0.917); }
  46.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.088, 0.833, 1); }
  48.33% { transform: rotate(0deg); }
  50% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.922); }
  51.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.636); }
  53.33% { transform: rotate(0.94deg); animation-timing-function: cubic-bezier(0.167, 0.108, 0.833, 0.827); }
  55% { transform: rotate(4.09deg); animation-timing-function: cubic-bezier(0.167, 0.16, 0.833, 0.831); }
  56.67% { transform: rotate(7.5deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(11.01deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(14.54deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(18.01deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(21.36deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(24.54deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(27.5deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(30.16deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(32.46deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(34.29deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(35.53deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(36deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(35.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  78.33% { transform: rotate(34.1deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(31.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(29.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(25.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(22.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(18.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(14.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(10.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(7.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  93.33% { transform: rotate(3.84deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.885); }
  95% { transform: rotate(1.06deg); animation-timing-function: cubic-bezier(0.167, 0.303, 0.833, 0.917); }
  96.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.088, 0.833, 1); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-3-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.93); }
  5% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.593); }
  6.67% { transform: rotate(0.84deg); animation-timing-function: cubic-bezier(0.167, 0.105, 0.833, 0.824); }
  8.33% { transform: rotate(4.11deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(7.73deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(11.55deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(15.45deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(19.27deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(22.89deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(26.16deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(28.94deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(31.11deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(32.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(33deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(32.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  28.33% { transform: rotate(31.11deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(28.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(26.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(22.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(19.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(15.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(11.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(7.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(4.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.895); }
  43.33% { transform: rotate(0.84deg); animation-timing-function: cubic-bezier(0.167, 0.407, 0.833, 0.917); }
  45% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.07, 0.833, 1); }
  46.67% { transform: rotate(0deg); }
  48.33% { transform: rotate(0deg); }
  50% { transform: rotate(0deg); }
  51.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.909); }
  53.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.656); }
  55% { transform: rotate(1.09deg); animation-timing-function: cubic-bezier(0.167, 0.11, 0.833, 0.831); }
  56.67% { transform: rotate(4.5deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(8.01deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(11.54deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(15.01deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(18.36deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(21.54deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(24.5deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(27.16deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(29.46deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(31.29deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(32.53deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(33deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(32.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  78.33% { transform: rotate(31.11deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(28.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(26.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(22.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(19.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(15.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(11.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(7.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(4.11deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.895); }
  93.33% { transform: rotate(0.84deg); animation-timing-function: cubic-bezier(0.167, 0.407, 0.833, 0.917); }
  95% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.07, 0.833, 1); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-4-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.907); }
  6.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.645); }
  8.33% { transform: rotate(1.11deg); animation-timing-function: cubic-bezier(0.167, 0.109, 0.833, 0.829); }
  10% { transform: rotate(4.73deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(8.55deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(12.45deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(16.27deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(19.89deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(23.16deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(25.94deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(28.11deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(29.5deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(30deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(29.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  28.33% { transform: rotate(28.11deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(25.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(23.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(19.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(16.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(12.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(8.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(4.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.891); }
  41.67% { transform: rotate(1.11deg); animation-timing-function: cubic-bezier(0.167, 0.355, 0.833, 0.917); }
  43.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.093, 0.833, 1); }
  45% { transform: rotate(0deg); }
  46.67% { transform: rotate(0deg); }
  48.33% { transform: rotate(0deg); }
  50% { transform: rotate(0deg); }
  51.67% { transform: rotate(0deg); }
  53.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.875); }
  55% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.721); }
  56.67% { transform: rotate(1.5deg); animation-timing-function: cubic-bezier(0.167, 0.119, 0.833, 0.833); }
  58.33% { transform: rotate(5.01deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(8.54deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(12.01deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(15.36deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(18.54deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(21.5deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(24.16deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(26.46deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(28.29deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(29.53deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(30deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(29.5deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  78.33% { transform: rotate(28.11deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(25.94deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(23.16deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(19.89deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(16.27deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(12.45deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(8.55deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(4.73deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.891); }
  91.67% { transform: rotate(1.11deg); animation-timing-function: cubic-bezier(0.167, 0.355, 0.833, 0.917); }
  93.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, -0.093, 0.833, 1); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes Left_thigh-contornos-k {
  0% { transform: translate(236.43px, 356.98px); }
  33.33% { transform: translate(236.43px, 375.98px); animation-timing-function: cubic-bezier(0.333, 0.333, 0.667, 0.667); }
  66.67% { transform: translate(236.43px, 375.98px); }
  100% { transform: translate(236.43px, 356.98px); }
}

@keyframes Left_thigh-contornos-k-2 {
  0% { transform: rotate(0deg); }
  27.91% { transform: rotate(-27deg); }
  62.79% { transform: rotate(-27deg); }
  100% { transform: rotate(0deg); }
}

@keyframes Right_thigh-contornos-k {
  0% { transform: translate(170.02px, 361.8px); }
  33.33% { transform: translate(170.02px, 386.8px); animation-timing-function: cubic-bezier(0.333, 0.333, 0.667, 0.667); }
  66.67% { transform: translate(170.02px, 386.8px); }
  100% { transform: translate(170.02px, 361.8px); }
}

@keyframes Right_thigh-contornos-k-2 {
  0% { transform: rotate(0deg); }
  27.91% { transform: rotate(40deg); }
  62.79% { transform: rotate(40deg); }
  100% { transform: rotate(0deg); }
}

@keyframes body-k {
  0% { offset-distance: 0%; }
  5% { offset-distance: 3.7%; }
  38.33% { offset-distance: 47.92%; animation-timing-function: cubic-bezier(0.333, 0, 0.833, 0.833); }
  75% { offset-distance: 88.43%; animation-timing-function: cubic-bezier(0.167, 0.167, 0.667, 1); }
  83.33% { offset-distance: 94.21%; }
  100% { offset-distance: 100%; }
}

@keyframes feather-contornos-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); }
  11.67% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); }
  15% { transform: rotate(0deg); }
  16.67% { transform: rotate(0deg); }
  18.33% { transform: rotate(0deg); }
  20% { transform: rotate(0deg); }
  21.67% { transform: rotate(0deg); }
  23.33% { transform: rotate(0deg); }
  25% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.034); }
  26.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.687); }
  28.33% { transform: rotate(-0.41deg); animation-timing-function: cubic-bezier(0.167, 0.114, 0.833, 0.864); }
  30% { transform: rotate(-1.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-2.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-2.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-2.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-3.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-3.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-3.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-3.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-3.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-2.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-2.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-2.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-1.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.839); }
  51.67% { transform: rotate(-0.79deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.917); }
  53.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.066, 0.833, 1); }
  55% { transform: rotate(0deg); }
  56.67% { transform: rotate(0deg); }
  58.33% { transform: rotate(0deg); }
  60% { transform: rotate(0deg); }
  61.67% { transform: rotate(0deg); }
  63.33% { transform: rotate(0deg); }
  65% { transform: rotate(0deg); }
  66.67% { transform: rotate(0deg); }
  68.33% { transform: rotate(0deg); }
  70% { transform: rotate(0deg); }
  71.67% { transform: rotate(0deg); }
  73.33% { transform: rotate(0deg); }
  75% { transform: rotate(0deg); }
  76.67% { transform: rotate(0deg); }
  78.33% { transform: rotate(0deg); }
  80% { transform: rotate(0deg); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-2-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.019); }
  6.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.686); }
  8.33% { transform: rotate(-0.23deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.789); }
  10% { transform: rotate(-0.87deg); animation-timing-function: cubic-bezier(0.167, 0.138, 0.833, 0.81); }
  11.67% { transform: rotate(-1.84deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  13.33% { transform: rotate(-3.09deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  15% { transform: rotate(-4.56deg); animation-timing-function: cubic-bezier(0.167, 0.158, 0.833, 0.827); }
  16.67% { transform: rotate(-6.2deg); animation-timing-function: cubic-bezier(0.167, 0.161, 0.833, 0.83); }
  18.33% { transform: rotate(-7.97deg); animation-timing-function: cubic-bezier(0.167, 0.163, 0.833, 0.832); }
  20% { transform: rotate(-9.81deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.834); }
  21.67% { transform: rotate(-11.69deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.837); }
  23.33% { transform: rotate(-13.54deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.84); }
  25% { transform: rotate(-15.32deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.844); }
  26.67% { transform: rotate(-16.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-18.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-19.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-20.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-20.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-20.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-21.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-21.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-21.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-21.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-21.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-20.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-20.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-20.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-19.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-18.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-17.83deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-16.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.832); }
  56.67% { transform: rotate(-15.77deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.833); }
  58.33% { transform: rotate(-14.7deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.833); }
  60% { transform: rotate(-13.62deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  61.67% { transform: rotate(-12.54deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  63.33% { transform: rotate(-11.46deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  65% { transform: rotate(-10.4deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  66.67% { transform: rotate(-9.36deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  68.33% { transform: rotate(-8.35deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  70% { transform: rotate(-7.36deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.837); }
  71.67% { transform: rotate(-6.4deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.837); }
  73.33% { transform: rotate(-5.49deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.838); }
  75% { transform: rotate(-4.61deg); animation-timing-function: cubic-bezier(0.167, 0.172, 0.833, 0.839); }
  76.67% { transform: rotate(-3.79deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.84); }
  78.33% { transform: rotate(-3.02deg); animation-timing-function: cubic-bezier(0.167, 0.174, 0.833, 0.842); }
  80% { transform: rotate(-2.31deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.844); }
  81.67% { transform: rotate(-1.68deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.847); }
  83.33% { transform: rotate(-1.13deg); animation-timing-function: cubic-bezier(0.167, 0.183, 0.833, 0.853); }
  85% { transform: rotate(-0.67deg); animation-timing-function: cubic-bezier(0.167, 0.192, 0.833, 0.863); }
  86.67% { transform: rotate(-0.31deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  88.33% { transform: rotate(-0.08deg); animation-timing-function: cubic-bezier(0.167, 0.315, 0.833, 0.917); }
  90% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.007, 0.833, 1); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-3-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.008); }
  11.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, -0.443); }
  13.33% { transform: rotate(-0.09deg); animation-timing-function: cubic-bezier(0.167, 0.088, 0.833, 0.824); }
  15% { transform: rotate(-1.56deg); animation-timing-function: cubic-bezier(0.167, 0.158, 0.833, 0.827); }
  16.67% { transform: rotate(-3.2deg); animation-timing-function: cubic-bezier(0.167, 0.161, 0.833, 0.83); }
  18.33% { transform: rotate(-4.97deg); animation-timing-function: cubic-bezier(0.167, 0.163, 0.833, 0.832); }
  20% { transform: rotate(-6.81deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.834); }
  21.67% { transform: rotate(-8.69deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.837); }
  23.33% { transform: rotate(-10.54deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.84); }
  25% { transform: rotate(-12.32deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.844); }
  26.67% { transform: rotate(-13.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-15.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-16.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-17.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-17.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-17.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-18.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-18.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-18.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-18.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-18.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-17.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-17.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-17.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-16.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-15.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-14.83deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-13.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.832); }
  56.67% { transform: rotate(-12.77deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.833); }
  58.33% { transform: rotate(-11.7deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.833); }
  60% { transform: rotate(-10.62deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  61.67% { transform: rotate(-9.54deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  63.33% { transform: rotate(-8.46deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  65% { transform: rotate(-7.4deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  66.67% { transform: rotate(-6.36deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  68.33% { transform: rotate(-5.35deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  70% { transform: rotate(-4.36deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.837); }
  71.67% { transform: rotate(-3.4deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.837); }
  73.33% { transform: rotate(-2.49deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.838); }
  75% { transform: rotate(-1.61deg); animation-timing-function: cubic-bezier(0.167, 0.172, 0.833, 0.839); }
  76.67% { transform: rotate(-0.79deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.914); }
  78.33% { transform: rotate(-0.02deg); animation-timing-function: cubic-bezier(0.167, 3.2, 0.833, 0.917); }
  80% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.002, 0.833, 1); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-4-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); }
  11.67% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.017); }
  15% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.187); }
  16.67% { transform: rotate(-0.2deg); animation-timing-function: cubic-bezier(0.167, 0.093, 0.833, 0.83); }
  18.33% { transform: rotate(-1.97deg); animation-timing-function: cubic-bezier(0.167, 0.163, 0.833, 0.832); }
  20% { transform: rotate(-3.81deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.834); }
  21.67% { transform: rotate(-5.69deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.837); }
  23.33% { transform: rotate(-7.54deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.84); }
  25% { transform: rotate(-9.32deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.844); }
  26.67% { transform: rotate(-10.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-12.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-13.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-14.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-14.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-14.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-15.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-15.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-15.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-15.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-15.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-14.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-14.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-14.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-13.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-12.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-11.83deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-10.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.832); }
  56.67% { transform: rotate(-9.77deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.833); }
  58.33% { transform: rotate(-8.7deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.833); }
  60% { transform: rotate(-7.62deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  61.67% { transform: rotate(-6.54deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  63.33% { transform: rotate(-5.46deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  65% { transform: rotate(-4.4deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  66.67% { transform: rotate(-3.36deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  68.33% { transform: rotate(-2.35deg); animation-timing-function: cubic-bezier(0.167, 0.169, 0.833, 0.836); }
  70% { transform: rotate(-1.36deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.882); }
  71.67% { transform: rotate(-0.4deg); animation-timing-function: cubic-bezier(0.167, 0.281, 0.833, 0.917); }
  73.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.034, 0.833, 1); }
  75% { transform: rotate(0deg); }
  76.67% { transform: rotate(0deg); }
  78.33% { transform: rotate(0deg); }
  80% { transform: rotate(0deg); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-5-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); }
  11.67% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); }
  15% { transform: rotate(0deg); }
  16.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.068); }
  18.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.724); }
  20% { transform: rotate(-0.81deg); animation-timing-function: cubic-bezier(0.167, 0.119, 0.833, 0.834); }
  21.67% { transform: rotate(-2.69deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.837); }
  23.33% { transform: rotate(-4.54deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.84); }
  25% { transform: rotate(-6.32deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.844); }
  26.67% { transform: rotate(-7.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-9.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-10.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-11.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-11.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-11.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-12.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-12.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-12.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-12.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-12.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-11.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-11.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-11.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-10.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-9.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-8.84deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-7.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.832); }
  56.67% { transform: rotate(-6.77deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.833); }
  58.33% { transform: rotate(-5.7deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.833); }
  60% { transform: rotate(-4.62deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  61.67% { transform: rotate(-3.54deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.834); }
  63.33% { transform: rotate(-2.46deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.835); }
  65% { transform: rotate(-1.4deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.888); }
  66.67% { transform: rotate(-0.36deg); animation-timing-function: cubic-bezier(0.167, 0.322, 0.833, 0.917); }
  68.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.03, 0.833, 1); }
  70% { transform: rotate(0deg); }
  71.67% { transform: rotate(0deg); }
  73.33% { transform: rotate(0deg); }
  75% { transform: rotate(0deg); }
  76.67% { transform: rotate(0deg); }
  78.33% { transform: rotate(0deg); }
  80% { transform: rotate(0deg); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-6-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); }
  11.67% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); }
  15% { transform: rotate(0deg); }
  16.67% { transform: rotate(0deg); }
  18.33% { transform: rotate(0deg); }
  20% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.128); }
  21.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.82); }
  23.33% { transform: rotate(-1.54deg); animation-timing-function: cubic-bezier(0.167, 0.155, 0.833, 0.84); }
  25% { transform: rotate(-3.32deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.844); }
  26.67% { transform: rotate(-4.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-6.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-7.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-8.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-8.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-8.85deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-9.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-9.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-9.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-9.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-9.1deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-8.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-8.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-8.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-7.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-6.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-5.83deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-4.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.832); }
  56.67% { transform: rotate(-3.77deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.833); }
  58.33% { transform: rotate(-2.7deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.833); }
  60% { transform: rotate(-1.62deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.875); }
  61.67% { transform: rotate(-0.54deg); animation-timing-function: cubic-bezier(0.167, 0.251, 0.833, 0.917); }
  63.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.045, 0.833, 1); }
  65% { transform: rotate(0deg); }
  66.67% { transform: rotate(0deg); }
  68.33% { transform: rotate(0deg); }
  70% { transform: rotate(0deg); }
  71.67% { transform: rotate(0deg); }
  73.33% { transform: rotate(0deg); }
  75% { transform: rotate(0deg); }
  76.67% { transform: rotate(0deg); }
  78.33% { transform: rotate(0deg); }
  80% { transform: rotate(0deg); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes feather-contornos-7-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); }
  5% { transform: rotate(0deg); }
  6.67% { transform: rotate(0deg); }
  8.33% { transform: rotate(0deg); }
  10% { transform: rotate(0deg); }
  11.67% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); }
  15% { transform: rotate(0deg); }
  16.67% { transform: rotate(0deg); }
  18.33% { transform: rotate(0deg); }
  20% { transform: rotate(0deg); }
  21.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.027); }
  23.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.495); }
  25% { transform: rotate(-0.32deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.844); }
  26.67% { transform: rotate(-1.97deg); animation-timing-function: cubic-bezier(0.167, 0.179, 0.833, 0.851); }
  28.33% { transform: rotate(-3.41deg); animation-timing-function: cubic-bezier(0.167, 0.189, 0.833, 0.864); }
  30% { transform: rotate(-4.55deg); animation-timing-function: cubic-bezier(0.167, 0.216, 0.833, 0.879); }
  31.67% { transform: rotate(-5.26deg); animation-timing-function: cubic-bezier(0.167, 0.267, 0.833, 0.85); }
  33.33% { transform: rotate(-5.59deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.855); }
  35% { transform: rotate(-5.84deg); animation-timing-function: cubic-bezier(0.167, 0.195, 0.833, 0.863); }
  36.67% { transform: rotate(-6.04deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.881); }
  38.33% { transform: rotate(-6.16deg); animation-timing-function: cubic-bezier(0.167, 0.276, 0.833, 0.948); }
  40% { transform: rotate(-6.21deg); animation-timing-function: cubic-bezier(0.167, -0.137, 0.833, 0.511); }
  41.67% { transform: rotate(-6.19deg); animation-timing-function: cubic-bezier(0.167, 0.1, 0.833, 0.762); }
  43.33% { transform: rotate(-6.09deg); animation-timing-function: cubic-bezier(0.167, 0.128, 0.833, 0.792); }
  45% { transform: rotate(-5.91deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.803); }
  46.67% { transform: rotate(-5.64deg); animation-timing-function: cubic-bezier(0.167, 0.144, 0.833, 0.776); }
  48.33% { transform: rotate(-5.26deg); animation-timing-function: cubic-bezier(0.167, 0.133, 0.833, 0.805); }
  50% { transform: rotate(-4.63deg); animation-timing-function: cubic-bezier(0.167, 0.146, 0.833, 0.823); }
  51.67% { transform: rotate(-3.79deg); animation-timing-function: cubic-bezier(0.167, 0.157, 0.833, 0.828); }
  53.33% { transform: rotate(-2.83deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.83); }
  55% { transform: rotate(-1.82deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.856); }
  56.67% { transform: rotate(-0.77deg); animation-timing-function: cubic-bezier(0.167, 0.197, 0.833, 0.917); }
  58.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.064, 0.833, 1); }
  60% { transform: rotate(0deg); }
  61.67% { transform: rotate(0deg); }
  63.33% { transform: rotate(0deg); }
  65% { transform: rotate(0deg); }
  66.67% { transform: rotate(0deg); }
  68.33% { transform: rotate(0deg); }
  70% { transform: rotate(0deg); }
  71.67% { transform: rotate(0deg); }
  73.33% { transform: rotate(0deg); }
  75% { transform: rotate(0deg); }
  76.67% { transform: rotate(0deg); }
  78.33% { transform: rotate(0deg); }
  80% { transform: rotate(0deg); }
  81.67% { transform: rotate(0deg); }
  83.33% { transform: rotate(0deg); }
  85% { transform: rotate(0deg); }
  86.67% { transform: rotate(0deg); }
  88.33% { transform: rotate(0deg); }
  90% { transform: rotate(0deg); }
  91.67% { transform: rotate(0deg); }
  93.33% { transform: rotate(0deg); }
  95% { transform: rotate(0deg); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-5-k {
  0% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.167, 0.833, 0.682); }
  1.67% { transform: rotate(-0.67deg); }
  3.33% { transform: rotate(-2.57deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  5% { transform: rotate(-5.51deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  6.67% { transform: rotate(-9.3deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  8.33% { transform: rotate(-13.74deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(-18.66deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(-23.85deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(-29.15deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(-34.34deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(-39.26deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(-43.7deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(-47.49deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(-50.42deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(-52.32deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(-53deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(-52.32deg); }
  28.33% { transform: rotate(-50.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(-47.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(-43.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(-39.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(-34.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(-29.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(-23.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(-18.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(-13.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  43.33% { transform: rotate(-9.3deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  45% { transform: rotate(-5.51deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  46.67% { transform: rotate(-2.57deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  48.33% { transform: rotate(-0.67deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1.138); }
  50% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.052, 0.833, 0.751); }
  51.67% { transform: rotate(-1.79deg); animation-timing-function: cubic-bezier(0.167, 0.125, 0.833, 0.816); }
  53.33% { transform: rotate(-5.35deg); animation-timing-function: cubic-bezier(0.167, 0.153, 0.833, 0.827); }
  55% { transform: rotate(-9.64deg); animation-timing-function: cubic-bezier(0.167, 0.16, 0.833, 0.831); }
  56.67% { transform: rotate(-14.26deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(-19.04deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(-23.83deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(-28.55deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(-33.11deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(-37.43deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(-41.45deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(-45.06deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(-48.18deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(-50.67deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(-52.36deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(-53deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(-52.32deg); }
  78.33% { transform: rotate(-50.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(-47.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(-43.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(-39.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(-34.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(-29.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(-23.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(-18.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(-13.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  93.33% { transform: rotate(-9.3deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  95% { transform: rotate(-5.51deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  96.67% { transform: rotate(-2.57deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  98.33% { transform: rotate(-0.67deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 0.917); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-6-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.209); }
  3.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.791); }
  5% { transform: rotate(-2.51deg); animation-timing-function: cubic-bezier(0.167, 0.139, 0.833, 0.819); }
  6.67% { transform: rotate(-6.3deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  8.33% { transform: rotate(-10.74deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(-15.66deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(-20.85deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(-26.15deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(-31.34deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(-36.26deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(-40.7deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(-44.49deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(-47.42deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(-49.32deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(-50deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(-49.32deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  28.33% { transform: rotate(-47.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(-44.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(-40.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(-36.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(-31.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(-26.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(-20.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(-15.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(-10.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  43.33% { transform: rotate(-6.3deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.861); }
  45% { transform: rotate(-2.51deg); animation-timing-function: cubic-bezier(0.167, 0.209, 0.833, 0.917); }
  46.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.209, 0.833, 1); }
  48.33% { transform: rotate(0deg); }
  50% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.196); }
  51.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.765); }
  53.33% { transform: rotate(-2.35deg); animation-timing-function: cubic-bezier(0.167, 0.129, 0.833, 0.827); }
  55% { transform: rotate(-6.64deg); animation-timing-function: cubic-bezier(0.167, 0.16, 0.833, 0.831); }
  56.67% { transform: rotate(-11.26deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(-16.04deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(-20.83deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(-25.55deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(-30.11deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(-34.43deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(-38.45deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(-42.06deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(-45.18deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(-47.67deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(-49.36deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(-50deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(-49.32deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  78.33% { transform: rotate(-47.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(-44.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(-40.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(-36.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(-31.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(-26.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(-20.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(-15.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(-10.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  93.33% { transform: rotate(-6.3deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.861); }
  95% { transform: rotate(-2.51deg); animation-timing-function: cubic-bezier(0.167, 0.209, 0.833, 0.917); }
  96.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.209, 0.833, 1); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes wing-contornos-7-k {
  0% { transform: rotate(0deg); }
  1.67% { transform: rotate(0deg); }
  3.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.275); }
  5% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.804); }
  6.67% { transform: rotate(-3.3deg); animation-timing-function: cubic-bezier(0.167, 0.145, 0.833, 0.824); }
  8.33% { transform: rotate(-7.74deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  10% { transform: rotate(-12.66deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  11.67% { transform: rotate(-17.85deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  13.33% { transform: rotate(-23.15deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  15% { transform: rotate(-28.34deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  16.67% { transform: rotate(-33.26deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.846); }
  18.33% { transform: rotate(-37.7deg); animation-timing-function: cubic-bezier(0.167, 0.181, 0.833, 0.852); }
  20% { transform: rotate(-41.49deg); animation-timing-function: cubic-bezier(0.167, 0.191, 0.833, 0.863); }
  21.67% { transform: rotate(-44.42deg); animation-timing-function: cubic-bezier(0.167, 0.212, 0.833, 0.887); }
  23.33% { transform: rotate(-46.32deg); animation-timing-function: cubic-bezier(0.167, 0.318, 0.833, 1); }
  25% { transform: rotate(-47deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 0.682); }
  26.67% { transform: rotate(-46.32deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  28.33% { transform: rotate(-44.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  30% { transform: rotate(-41.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  31.67% { transform: rotate(-37.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  33.33% { transform: rotate(-33.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  35% { transform: rotate(-28.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  36.67% { transform: rotate(-23.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  38.33% { transform: rotate(-17.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  40% { transform: rotate(-12.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  41.67% { transform: rotate(-7.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.855); }
  43.33% { transform: rotate(-3.3deg); animation-timing-function: cubic-bezier(0.167, 0.196, 0.833, 0.917); }
  45% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.275, 0.833, 1); }
  46.67% { transform: rotate(0deg); }
  48.33% { transform: rotate(0deg); }
  50% { transform: rotate(0deg); }
  51.67% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0, 0.833, 1.303); }
  53.33% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.083, 0.833, 0.811); }
  55% { transform: rotate(-3.64deg); animation-timing-function: cubic-bezier(0.167, 0.149, 0.833, 0.831); }
  56.67% { transform: rotate(-8.26deg); animation-timing-function: cubic-bezier(0.167, 0.164, 0.833, 0.833); }
  58.33% { transform: rotate(-13.04deg); animation-timing-function: cubic-bezier(0.167, 0.166, 0.833, 0.835); }
  60% { transform: rotate(-17.83deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.836); }
  61.67% { transform: rotate(-22.55deg); animation-timing-function: cubic-bezier(0.167, 0.17, 0.833, 0.838); }
  63.33% { transform: rotate(-27.11deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.839); }
  65% { transform: rotate(-31.43deg); animation-timing-function: cubic-bezier(0.167, 0.173, 0.833, 0.842); }
  66.67% { transform: rotate(-35.45deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.845); }
  68.33% { transform: rotate(-39.06deg); animation-timing-function: cubic-bezier(0.167, 0.18, 0.833, 0.85); }
  70% { transform: rotate(-42.18deg); animation-timing-function: cubic-bezier(0.167, 0.188, 0.833, 0.86); }
  71.67% { transform: rotate(-44.67deg); animation-timing-function: cubic-bezier(0.167, 0.206, 0.833, 0.885); }
  73.33% { transform: rotate(-46.36deg); animation-timing-function: cubic-bezier(0.167, 0.304, 0.833, 1.005); }
  75% { transform: rotate(-47deg); animation-timing-function: cubic-bezier(0.167, 0.005, 0.833, 0.682); }
  76.67% { transform: rotate(-46.32deg); animation-timing-function: cubic-bezier(0.167, 0.113, 0.833, 0.788); }
  78.33% { transform: rotate(-44.42deg); animation-timing-function: cubic-bezier(0.167, 0.137, 0.833, 0.809); }
  80% { transform: rotate(-41.49deg); animation-timing-function: cubic-bezier(0.167, 0.148, 0.833, 0.819); }
  81.67% { transform: rotate(-37.7deg); animation-timing-function: cubic-bezier(0.167, 0.154, 0.833, 0.824); }
  83.33% { transform: rotate(-33.26deg); animation-timing-function: cubic-bezier(0.167, 0.159, 0.833, 0.829); }
  85% { transform: rotate(-28.34deg); animation-timing-function: cubic-bezier(0.167, 0.162, 0.833, 0.832); }
  86.67% { transform: rotate(-23.15deg); animation-timing-function: cubic-bezier(0.167, 0.165, 0.833, 0.835); }
  88.33% { transform: rotate(-17.85deg); animation-timing-function: cubic-bezier(0.167, 0.168, 0.833, 0.838); }
  90% { transform: rotate(-12.66deg); animation-timing-function: cubic-bezier(0.167, 0.171, 0.833, 0.841); }
  91.67% { transform: rotate(-7.74deg); animation-timing-function: cubic-bezier(0.167, 0.176, 0.833, 0.855); }
  93.33% { transform: rotate(-3.3deg); animation-timing-function: cubic-bezier(0.167, 0.196, 0.833, 0.917); }
  95% { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.167, 0.275, 0.833, 1); }
  96.67% { transform: rotate(0deg); }
  98.33% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes neck-contornos-Grupo-1-Trazado-1-k {
  0% { d: 'M -20.94 -49.85 C -20.68 -47.3 -19.19 -42.93 -17.44 -39.02 C -16.64 -37.21 -15.15 -33.29 -14.89 -31.52 C -14.19 -26.85 -14.86 -18.1 -16.67 -13.96 C -17.95 -11.02 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.08 8.03 6.39 1.82 C 12.72 -5.6 26 -19.96 31.33 -28.41 C 36.67 -36.85 40.67 -48.85 38.44 -61.74 C 36.22 -74.63 15.32 -87.59 -3.36 -81.85 C -23.69 -75.6 -21.61 -56.3 -20.94 -49.85 Z'; }
  5% { d: 'M -20.94 -49.85 C -20.68 -47.3 -19.19 -42.93 -17.44 -39.02 C -16.64 -37.21 -15.15 -33.29 -14.89 -31.52 C -14.19 -26.85 -14.86 -18.1 -16.67 -13.96 C -17.95 -11.02 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.08 8.03 6.39 1.82 C 12.72 -5.6 26 -19.96 31.33 -28.41 C 36.67 -36.85 40.67 -48.85 38.44 -61.74 C 36.22 -74.63 15.32 -87.59 -3.36 -81.85 C -23.69 -75.6 -21.61 -56.3 -20.94 -49.85 Z'; }
  25% { d: 'M -21.94 -85.85 C -21.68 -83.3 -20.19 -78.93 -18.44 -75.02 C -17.64 -73.21 -16.15 -69.29 -15.89 -67.52 C -15.19 -62.85 -7.26 -49.67 -16.67 -13.96 C -17.48 -10.86 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.82 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.24 -4.14 4.39 -11.68 C 15.24 -37.67 25 -55.96 30.33 -64.41 C 35.67 -72.85 39.67 -84.85 37.44 -97.74 C 35.22 -110.63 14.32 -123.59 -4.36 -117.85 C -24.69 -111.6 -22.61 -92.3 -21.94 -85.85 Z'; }
  38.33% { d: 'M -21.94 -68.85 C -21.68 -66.31 -20.19 -61.93 -18.44 -58.02 C -17.64 -56.21 -16.15 -52.29 -15.89 -50.52 C -15.19 -45.85 -10.26 -35.67 -16.67 -13.96 C -17.57 -10.89 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 -0.62 9.2 2.89 1.82 C 10.24 -13.67 25 -38.96 30.33 -47.41 C 35.67 -55.85 39.67 -67.85 37.44 -80.74 C 35.22 -93.63 14.32 -106.59 -4.36 -100.85 C -24.69 -94.6 -22.61 -75.3 -21.94 -68.85 Z'; }
  50% { d: 'M -20.94 -49.85 C -20.68 -47.3 -19.19 -42.93 -17.44 -39.02 C -16.64 -37.21 -15.15 -33.29 -14.89 -31.52 C -14.19 -26.85 -14.86 -18.1 -16.67 -13.96 C -17.95 -11.02 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.08 8.03 6.39 1.82 C 12.72 -5.6 26 -19.96 31.33 -28.41 C 36.67 -36.85 40.67 -48.85 38.44 -61.74 C 36.22 -74.63 15.32 -87.59 -3.36 -81.85 C -23.69 -75.6 -21.61 -56.3 -20.94 -49.85 Z'; }
  73.33% { d: 'M -21.44 -37.35 C -21.18 -34.8 -19.69 -30.43 -17.94 -26.52 C -17.14 -24.71 -15.65 -20.79 -15.39 -19.02 C -14.69 -14.35 -15.36 -5.6 -17.17 -1.46 C -18.45 1.48 -28.26 7.83 -31.56 15.15 C -39.43 32.64 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 0.58 20.53 5.89 14.32 C 12.22 6.9 25.5 -7.46 30.83 -15.91 C 36.17 -24.35 40.17 -36.35 37.94 -49.24 C 35.72 -62.13 14.82 -75.09 -3.86 -69.35 C -24.19 -63.1 -22.11 -43.8 -21.44 -37.35 Z'; }
  81.67% { d: 'M -20.44 -43.35 C -20.18 -40.8 -18.69 -36.43 -16.94 -32.52 C -16.14 -30.71 -14.65 -26.79 -14.39 -25.02 C -13.69 -20.35 -14.36 -11.6 -16.17 -7.46 C -17.45 -4.53 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.58 14.53 6.89 8.32 C 13.22 0.9 26.5 -13.46 31.83 -21.91 C 37.17 -30.35 41.17 -42.35 38.94 -55.24 C 36.72 -68.13 15.82 -81.09 -2.86 -75.35 C -23.19 -69.1 -21.11 -49.8 -20.44 -43.35 Z'; }
  100% { d: 'M -20.94 -49.85 C -20.68 -47.3 -19.19 -42.93 -17.44 -39.02 C -16.64 -37.21 -15.15 -33.29 -14.89 -31.52 C -14.19 -26.85 -14.86 -18.1 -16.67 -13.96 C -17.95 -11.02 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.08 8.03 6.39 1.82 C 12.72 -5.6 26 -19.96 31.33 -28.41 C 36.67 -36.85 40.67 -48.85 38.44 -61.74 C 36.22 -74.63 15.32 -87.59 -3.36 -81.85 C -23.69 -75.6 -21.61 -56.3 -20.94 -49.85 Z'; }
}

@keyframes Wing_Left_Postion-k {
  0% { transform: translate(215px, 218px); }
  33.33% { transform: translate(215px, 245px); }
  66.67% { transform: translate(215px, 245px); }
  100% { transform: translate(215px, 218px); }
}

@keyframes head-contornos-k {
  0% { offset-distance: 0%; }
  9.62% { offset-distance: 6.53%; animation-timing-function: cubic-bezier(0.333, 0, 0.833, 0.887); }
  32.69% { offset-distance: 45.74%; animation-timing-function: cubic-bezier(0.167, 0.509, 0.667, 1); }
  48.08% { offset-distance: 51.56%; animation-timing-function: cubic-bezier(0.333, 0, 0.833, 0.635); }
  61.54% { offset-distance: 56.88%; animation-timing-function: cubic-bezier(0.167, 0.071, 0.833, 0.923); }
  76.92% { offset-distance: 88.24%; animation-timing-function: cubic-bezier(0.167, 0.23, 0.667, 1); }
  86.54% { offset-distance: 94.77%; }
  100% { offset-distance: 100%; }
}

@keyframes crest-contornos-k {
  0% { transform: rotate(0deg); }
  9.62% { transform: rotate(6deg); animation-timing-function: cubic-bezier(0.333, 0, 0.325, 0.995); }
  44.23% { transform: rotate(-10.01deg); animation-timing-function: cubic-bezier(0.455, 0, 0.576, 0.999); }
  90.38% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

@keyframes crest-contornos-k-2 {
  0% { transform: scale(1, 1); }
  9.62% { transform: scale(1, 0.89); }
  44.23% { transform: scale(1, 1.16); }
  92.31% { transform: scale(1, 0.89); }
  100% { transform: scale(1, 1); }
}

@keyframes iris-contornos-k {
  0% { transform: translate(18.33px, 15.87px); }
  7.14% { transform: translate(29.33px, 15.87px); }
  92.86% { transform: translate(29.33px, 15.87px); }
  100% { transform: translate(18.33px, 15.87px); }
}

@keyframes snood-contornos-k {
  0% { transform: rotate(0deg); }
  13.33% { transform: rotate(0deg); }
  21.67% { transform: rotate(-2.53deg); animation-timing-function: cubic-bezier(0.303, -0.001, 0.642, 0.985); }
  50% { transform: rotate(5.95deg); animation-timing-function: cubic-bezier(0.526, 0.011, 0.626, 1.005); }
  66.67% { transform: rotate(-1.82deg); animation-timing-function: cubic-bezier(0.18, -0.002, 0.525, 0.989); }
  85% { transform: rotate(1.61deg); animation-timing-function: cubic-bezier(0.406, 0.011, 0.293, 1.001); }
  100% { transform: rotate(0deg); }
}

#suelo-contornos {
  type: group;
  transform-origin: 221.58px 52.65px;
  transform: translate(27.4px, 387.49px);
  > #suelo-contornos-Grupo-15 {
    type: group;
    transform: translate(18.31px, 55.36px);
    > #suelo-contornos-Grupo-15-Trazado-1 {
      type: path;
      d: 'M 14.28 12.47 C 14.28 12.47 2.91 10.15 -1.28 9.02 C -6.61 7.58 -14.5 -0.09 -8.05 -6.76 C -2.54 -12.46 8.04 -3.64 11.72 3.13 C 14.5 8.24 14.28 12.47 14.28 12.47 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-14 {
    type: group;
    transform: translate(47.47px, 52.77px);
    > #suelo-contornos-Grupo-14-Trazado-1 {
      type: path;
      d: 'M -7.22 18.39 C -7.22 18.39 -8.44 -2.05 -7.22 -7.17 C -6 -12.28 -1.33 -18.39 3.56 -16.61 C 8.44 -14.83 5.11 -2.72 3.78 -0.39 C 2.44 1.95 -7.22 18.39 -7.22 18.39 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-13 {
    type: group;
    transform: translate(54.97px, 72.9px);
    > #suelo-contornos-Grupo-13-Trazado-1 {
      type: path;
      d: 'M -13.39 15.37 C -13.39 15.37 -12.61 8.77 -11.28 5.48 C -9.17 0.26 -4.17 -6.63 -1.5 -9.07 C 1.17 -11.52 6.07 -15.37 9.61 -13.07 C 13.39 -10.63 8.39 -3.19 3.39 0.37 C -1.61 3.93 -4.17 5.81 -6.5 7.81 C -8.44 9.48 -9.5 10.7 -13.39 15.37 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-12 {
    type: group;
    transform: translate(23.75px, 78.44px);
    > #suelo-contornos-Grupo-12-Trazado-1 {
      type: path;
      d: 'M 13.95 2.39 C 13.95 2.39 5.61 -5.39 -4.5 -5.39 C -14.61 -5.39 -13.17 0.17 -12.61 1.39 C -12.05 2.61 -9.72 5.39 -0.39 5.39 C 2.61 5.39 8.39 4.17 9.83 3.83 C 11.28 3.5 14.61 3.39 14.61 3.39 C 14.61 3.39 13.95 2.39 13.95 2.39 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-11 {
    type: group;
    transform: translate(36.24px, 77.49px);
    > #suelo-contornos-Grupo-11-Trazado-1 {
      type: path;
      d: 'M -5.11 -11.22 C -0.02 -7.77 5.11 3.7 3.85 9.79 C 3.71 10.32 3.56 10.94 2.78 11.22 C 2.39 10.55 2.39 10.14 2.37 9.65 C 1.52 2.39 0.23 -5.79 -5.11 -11.22 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-10 {
    type: group;
    transform: translate(39.15px, 78.41px);
    > #suelo-contornos-Grupo-10-Trazado-1 {
      type: path;
      d: 'M 1.77 -11.14 C 0.64 -4.92 0.97 1.44 0.14 7.69 C -0.38 11.14 -1.76 11.05 -1.72 7.53 C -1.34 1.23 -0.12 -5.11 1.77 -11.14 Z';
      fill: #4f74b2;
    }
  }
  > #suelo-contornos-Grupo-9 {
    type: group;
    transform: translate(385.49px, 57.74px);
    > #suelo-contornos-Grupo-9-Trazado-1 {
      type: path;
      d: 'M 14.93 -28.08 C -0.26 -16.31 -8.14 1.79 -11.72 20.24 C -11.72 20.24 -12.61 24.16 -12.61 24.16 C -12.88 25.48 -13.09 26.78 -14.07 28.08 C -14.93 26.67 -14.86 25.27 -14.8 23.89 C -13.58 3.82 -1.8 -16.92 14.93 -28.08 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-8 {
    type: group;
    transform: translate(381.89px, 21.45px);
    > #suelo-contornos-Grupo-8-Trazado-1 {
      type: path;
      d: 'M 4.19 21.2 C 4.19 21.2 -5.31 4.04 -6.97 -8.3 C -7.56 -12.6 -7.1 -19.44 -0.81 -20.3 C 5.84 -21.2 7.56 -14.34 7.03 -3.46 C 6.61 5.03 4.19 21.2 4.19 21.2 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-7 {
    type: group;
    transform: translate(361.72px, 45.48px);
    > #suelo-contornos-Grupo-7-Trazado-1 {
      type: path;
      d: 'M 12.47 17.85 C 12.47 17.85 -1.36 10.99 -7.8 0.35 C -10.05 -3.37 -12.47 -12.15 -8.97 -14.32 C -3.26 -17.85 4.02 -6.17 7.87 4.01 C 10.87 11.96 12.47 17.85 12.47 17.85 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-6 {
    type: group;
    transform: translate(363.63px, 72.16px);
    > #suelo-contornos-Grupo-6-Trazado-1 {
      type: path;
      d: 'M -8.21 -9.17 C -2.11 -5.4 4.09 -0.7 7.24 5.93 C 7.59 6.97 8.21 8.02 7.62 9.17 C 6.85 8.89 6.63 8.46 6.37 8.03 C 2.64 1.45 -2.18 -4.51 -8.21 -9.17 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-5 {
    type: group;
    transform: translate(361.12px, 79.07px);
    > #suelo-contornos-Grupo-5-Trazado-1 {
      type: path;
      d: 'M -5.7 -5.08 C -3.35 -4.05 -1.14 -2.75 0.96 -1.27 C 2.77 0.07 4.76 1.63 5.49 3.87 C 5.58 4.21 5.7 4.54 5.3 5.08 C 4.59 5.07 4.42 4.84 4.21 4.62 C 3.74 4.24 2.82 3.09 2.42 2.61 C 0.05 -0.25 -2.71 -2.84 -5.7 -5.08 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-4 {
    type: group;
    transform: translate(403.86px, 43.91px);
    > #suelo-contornos-Grupo-4-Trazado-1 {
      type: path;
      d: 'M -23.61 8.58 C -23.61 8.58 -1.94 8.42 5.73 7.25 C 13.39 6.08 23.61 2.18 20.89 -3.25 C 18.23 -8.58 8.06 -5.08 1.06 -2.75 C -5.94 -0.42 -23.61 8.58 -23.61 8.58 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-3 {
    type: group;
    transform: translate(412.42px, 17.24px);
    > #suelo-contornos-Grupo-3-Trazado-1 {
      type: path;
      d: 'M -11.67 12.08 C -11.67 12.08 -9.67 -3.08 -4.17 -7.58 C 1.33 -12.08 7 -9.58 9.33 -6.58 C 11.67 -3.58 10.33 5.25 3.67 8.08 C -3 10.92 -11.67 12.08 -11.67 12.08 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-2 {
    type: group;
    transform: translate(380.69px, 78.43px);
    > #suelo-contornos-Grupo-2-Trazado-1 {
      type: path;
      d: 'M -5.33 7.5 C -4.95 1.95 -1.99 -3.73 2.81 -6.7 C 3.15 -6.92 3.55 -7.05 3.94 -7.19 C 4.33 -7.33 4.7 -7.5 5.33 -7.17 C 5.29 -6.43 5 -6.19 4.72 -5.93 C 0.25 -2.36 -4.04 1.66 -5.33 7.5 Z';
      fill: #dd4073;
    }
  }
  > #suelo-contornos-Grupo-1 {
    type: group;
    transform: translate(221.58px, 93.27px);
    > #suelo-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M 221.33 -0.22 C 221.33 7.88 124.89 11.78 0.45 11.78 C -124 11.78 -221.33 9.21 -221.33 1.11 C -221.33 -6.99 -130.23 -11.78 -5.78 -11.78 C 118.67 -11.78 221.33 -8.32 221.33 -0.22 Z';
      fill: #2e2b60;
    }
  }
}

#Left_foot-contornos {
  type: group;
  transform-origin: 51.97px 21.41px;
  transform: translate(242.18px, 439.94px);
  > #Left_foot-contornos-Grupo-2 {
    type: group;
    transform: translate(51.97px, 32.82px);
    > #Left_foot-contornos-Grupo-2-Trazado-1 {
      type: path;
      d: 'M 50.33 -7.94 C 49.11 -9.75 47.39 -8.5 44.13 -8.07 C 30.97 -6.33 13.71 -5.68 0.16 -6.01 C -13.71 -6.46 -31.03 -6.45 -43.79 0.36 C -46.34 1.72 -51.72 4.96 -50.64 6.74 C -48.81 9.75 -43.36 7.18 -40.19 6.8 C -27.11 5.23 -13.22 5.79 0.27 6.73 C 19.68 8.09 34.67 4.39 47.09 -2.66 C 49.82 -4.2 51.72 -5.88 50.33 -7.94 Z';
      fill: #df1125;
    }
  }
  > #Left_foot-contornos-Grupo-1 {
    type: group;
    transform: translate(70.19px, 16.91px);
    > #Left_foot-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M 20.18 -12.82 C 18.6 -16.66 11.81 -7.02 7.52 -4.28 C 3.68 -1.31 -0.22 1.65 -4.43 4.07 C -9.28 7.07 -15.4 9.22 -20.99 10.15 C -22.34 10.38 -19.12 16.66 -19.12 16.66 C -14.73 16.28 -10.44 15.09 -6.44 13.4 C -2.49 11.65 1.13 10.53 4.63 8.04 C 7.95 5.41 11.79 1.89 14.58 -1.38 C 17.89 -5.24 22.34 -9.75 20.7 -12.4 C 20.7 -12.4 20.18 -12.82 20.18 -12.82 Z';
      fill: #df1125;
    }
  }
}

#Left_foot {
  type: group;
  transform: translate(334px, 256px);
  > #Left_foot-Forma-1 {
    type: group;
    > #Left_foot-Forma-1-Trazado-1 {
      type: path;
      d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38';
      fill: none;
      stroke: #df1125;
      stroke-width: 11px;
      animation: Left_foot-Forma-1-Trazado-1-k 0.75s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1;
      animation-fill-mode: both;
    }
  }
}

#Right_foot-contornos {
  type: group;
  transform-origin: 52.07px 20.5px;
  transform: translate(129.12px, 442.3px);
  > #Right_foot-contornos-Grupo-2 {
    type: group;
    transform: translate(52.07px, 32.03px);
    > #Right_foot-contornos-Grupo-2-Trazado-1 {
      type: path;
      d: 'M -50.48 -6.87 C -49.29 -8.71 -47.55 -7.49 -44.28 -7.13 C -31.08 -5.68 -13.82 -5.4 -0.28 -6.01 C 13.58 -6.75 30.89 -7.11 43.8 -0.57 C 46.37 0.73 51.82 3.86 50.78 5.67 C 49.01 8.71 43.51 6.26 40.34 5.94 C 27.23 4.65 13.35 5.5 -0.12 6.73 C -19.49 8.5 -34.56 5.12 -47.13 -1.66 C -49.88 -3.15 -51.82 -4.78 -50.48 -6.87 Z';
      fill: #df1125;
    }
  }
  > #Right_foot-contornos-Grupo-1 {
    type: group;
    transform: translate(33.54px, 16.51px);
    > #Right_foot-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M -20.45 -12.39 C -18.96 -16.26 -11.96 -6.76 -7.62 -4.12 C -3.71 -1.22 0.25 1.65 4.51 3.98 C 9.42 6.87 15.58 8.9 21.2 9.71 C 22.55 9.91 19.47 16.26 19.47 16.26 C 15.06 15.97 10.76 14.87 6.71 13.27 C 2.73 11.6 -0.91 10.56 -4.46 8.15 C -7.84 5.58 -11.75 2.15 -14.61 -1.06 C -18 -4.86 -22.55 -9.27 -20.97 -11.96 C -20.97 -11.96 -20.45 -12.39 -20.45 -12.39 Z';
      fill: #df1125;
    }
  }
}

#Right_foot {
  type: group;
  transform: translate(256px, 256px);
  > #Right_foot-Forma-1 {
    type: group;
    > #Right_foot-Forma-1-Trazado-1 {
      type: path;
      d: 'M -54.37 173.63 C -54.37 173.63 -54.37 188.25 -54.37 197.25 C -54.37 206.25 -54.37 217.38 -54.37 217.38';
      fill: none;
      stroke: #df1125;
      stroke-width: 11px;
      animation: Right_foot-Forma-1-Trazado-1-k 0.75s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1;
      animation-fill-mode: both;
    }
  }
}

#Wing_Right_Position {
  type: group;
  transform: scale(1.42, 1.5);
  animation: Wing_Right_Position-k 0.75s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1;
  animation-fill-mode: both;
  > #wing-contornos {
    type: group;
    transform-origin: 76.97px 124.08px;
    transform: translate(14.53px, -37.16px) scale(0.7, 0.67);
    z-index: -4;
    animation: wing-contornos-k 1s cubic-bezier(0.167, 0.113, 0.833, 0.788) 1;
    animation-fill-mode: both;
    > #wing-contornos-Grupo-2 {
      type: group;
      transform: translate(38.47px, 62.08px);
      > #wing-contornos-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 38.22 61.83 C 37.78 61.16 18.58 35.59 8.22 10.5 C 2.44 -3.5 -4.04 -26.33 -8 -41.06 C -9.35 -46.09 -13.29 -61.83 -27.11 -60.17 C -38.22 -58.84 -38 -42.17 -37.78 -39.28 C -37.56 -36.39 -36.44 -28.61 -34.44 -23.95 C -32.44 -19.28 -29.23 -1.2 -9.11 25.83 C 5.78 45.83 38.22 61.83 38.22 61.83 Z';
        fill: #2e2b60;
      }
    }
    > #wing-contornos-Grupo-1 {
      type: group;
      transform: translate(25.53px, 52.52px);
      > #wing-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -9.5 -25.83 C -6.79 -14.64 -3.58 -3.5 0.49 7.27 C 2.46 12.56 4.85 17.98 7.73 22.86 C 8.34 23.83 9.04 24.71 9.5 25.83 C 0.15 17.23 -6.59 -12.85 -9.5 -25.83 Z';
        fill: #fdfbec;
      }
    }
  }
  > #wing-contornos-2 {
    type: group;
    transform-origin: 101.65px 105.86px;
    transform: translate(-10.75px, -18.2px) scale(0.7, 0.67);
    z-index: -3;
    animation: wing-contornos-2-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
    animation-fill-mode: both;
    > #wing-contornos-2-Grupo-2 {
      type: group;
      transform: translate(50.9px, 52.86px);
      > #wing-contornos-2-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 50.65 52.61 C 50.21 51.94 16.65 32.83 1.1 11.72 C -7.89 -0.47 -16.72 -17.1 -20.68 -31.84 C -22.03 -36.87 -25.97 -52.61 -39.79 -50.95 C -46.52 -50.14 -48.96 -43.44 -49.54 -37.53 C -50.65 -26.17 -44.12 -14.41 -37.3 -5.75 C -21.49 14.31 -5.79 33.76 18.68 43.27 C 28.17 46.97 38.02 49.85 47.97 52.04 C 48.86 52.24 49.76 52.43 50.65 52.61 Z';
        fill: #2e2b60;
      }
    }
    > #wing-contornos-2-Grupo-1 {
      type: group;
      transform: translate(33.56px, 42.69px);
      > #wing-contornos-2-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -19 -25.67 C -11.91 -6.84 -0.89 11.43 15.72 23.24 C 16.82 24.03 17.98 24.71 19 25.67 C 0.69 17.34 -12.69 -7.31 -19 -25.67 Z';
        fill: #fdfbec;
      }
    }
  }
  > #wing-contornos-3 {
    type: group;
    transform-origin: 116.55px 71.23px;
    transform: translate(-23.38px, 16px) scale(0.7, 0.67);
    z-index: -2;
    animation: wing-contornos-3-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
    animation-fill-mode: both;
    > #wing-contornos-3-Grupo-2 {
      type: group;
      transform: translate(58.05px, 35.98px);
      > #wing-contornos-3-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 57.8 34.93 C 57.09 34.56 37.44 25.67 14.96 12.17 C -0.6 2.84 -15.78 -9.05 -26.34 -20.06 C -29.94 -23.82 -40.97 -35.73 -52.29 -27.62 C -57.8 -23.68 -56.71 -16.63 -54.38 -11.18 C -49.89 -0.68 -36.99 5.43 -27.04 10.17 C -12.6 17.06 6.07 24.84 21.62 29.95 C 36.59 34.87 46.51 35.73 55.18 35.73 C 56.09 35.73 56.93 35.21 57.8 34.93 Z';
        fill: #2e2b60;
      }
    }
    > #wing-contornos-3-Grupo-1 {
      type: group;
      transform: translate(37.57px, 32.21px);
      > #wing-contornos-3-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -18.33 -9.83 C -7.26 -3.02 4.07 3.44 15.99 8.66 C 16.79 8.99 17.59 9.26 18.33 9.83 C 14.8 9.54 11.65 7.74 8.49 6.3 C 5.37 4.75 2.31 3.07 -0.69 1.3 C -6.69 -2.23 -12.56 -5.96 -18.33 -9.83 Z';
        fill: #fdfbec;
      }
    }
  }
  > #wing-contornos-4 {
    type: group;
    transform-origin: 115px 35.24px;
    transform: translate(-22.15px, 51.98px) scale(0.7, 0.67);
    z-index: -1;
    animation: wing-contornos-4-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
    animation-fill-mode: both;
    > #wing-contornos-4-Grupo-2 {
      type: group;
      transform: translate(57.75px, 20.49px);
      > #wing-contornos-4-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 57.5 15.02 C 56.7 15.08 30.17 6.35 4.39 -2.76 C -9.89 -7.81 -13.24 -10.01 -28.06 -13.65 C -33.11 -14.9 -48.08 -20.24 -53.3 -7.33 C -57.5 3.04 -42.33 10.95 -39.69 12.15 C -37.06 13.35 -29.27 15.87 -24.28 16.79 C -14.19 18.66 -0.53 20.24 16.83 19.46 C 41.94 18.34 57.5 15.02 57.5 15.02 Z';
        fill: #2e2b60;
      }
    }
    > #wing-contornos-4-Grupo-1 {
      type: group;
      transform: translate(38.3px, 17.96px);
      > #wing-contornos-4-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -16.83 -3.9 C -7.66 0.55 2.6 2.74 12.77 2.28 C 16.83 2.17 13.47 3.01 11.81 3.17 C 1.84 3.9 -8.1 0.72 -16.83 -3.9 Z';
        fill: #fdfbec;
      }
    }
  }
}

#Left_thigh-contornos {
  type: group;
  transform-origin: 35.81px 4.68px;
  animation: Left_thigh-contornos-k 0.75s cubic-bezier(0.333, 0, 0.667, 1) 1, Left_thigh-contornos-k-2 0.717s cubic-bezier(0.333, 0, 0.667, 1) 1 0.05s;
  animation-fill-mode: both;
  > #Left_thigh-contornos-Grupo-1 {
    type: group;
    transform: translate(34.81px, 41.69px);
    > #Left_thigh-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M 0.97 36.1 C -21.98 32.62 -32.47 13.46 -31.05 -5.88 C -29.63 -25.21 -13.54 -39.35 3.42 -38.11 C 20.37 -36.86 32.47 -20.21 31.55 -0.85 C 30.86 13.56 22.44 39.35 0.97 36.1 Z';
      fill: #2e2b60;
      stroke: #000000;
      stroke-width: 0.93px;
      stroke-miterlimit: 10;
    }
  }
}

#Right_thigh-contornos {
  type: group;
  transform-origin: 34.11px 7.57px;
  animation: Right_thigh-contornos-k 0.75s cubic-bezier(0.333, 0, 0.667, 1) 1, Right_thigh-contornos-k-2 0.717s cubic-bezier(0.333, 0, 0.667, 1) 1 0.05s;
  animation-fill-mode: both;
  > #Right_thigh-contornos-Grupo-1 {
    type: group;
    transform: translate(33.11px, 40.57px);
    > #Right_thigh-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M 27.93 -2.99 C 30.23 16.7 19.93 33.63 2.54 35.66 C -14.85 37.69 -27.81 30.32 -29.13 6.71 C -30.23 -13.09 -23.18 -33.63 -5.79 -35.66 C 11.6 -37.69 25.63 -22.68 27.93 -2.99 Z';
      fill: #2e2b60;
      stroke: #000000;
      stroke-width: 1.15px;
      stroke-miterlimit: 10;
    }
  }
}

#body {
  type: group;
  transform-origin: 121.49px 101.74px;
  offset-path: path('M 216.79 298.69 C 216.79 298.69 216.79 295.49 216.79 295.49 C 216.79 295.49 216.79 333.16 216.79 333.69 C 216.79 334.23 216.79 298.69 216.79 298.69 C 216.79 298.69 216.79 293.69 216.79 293.69 C 216.79 293.69 216.79 298.69 216.79 298.69');
  offset-rotate: 0deg;
  transform: translate(-121.49px, -101.74px);
  animation: body-k 1s cubic-bezier(0.333, 0, 0.667, 1) 1;
  animation-fill-mode: both;
  > #body-Grupo-11 {
    type: group;
    transform: translate(82px, 130.58px);
    > #body-Grupo-11-Trazado-1 {
      type: path;
      d: 'M 39.01 16.12 C 30.6 -8.47 41.38 -42.64 42.84 -47.06 C 37.77 -42.81 14.12 -25.57 -30.99 -30.55 C -41.35 -31.69 -49.9 -34.17 -56.98 -37.46 C -56.89 -34.87 -56.68 -32.23 -56.32 -29.55 C -48.99 26.45 2.68 45.45 35.68 46.79 C 42.5 47.06 49.72 46.43 56.98 45.27 C 49 38.52 43.31 28.7 39.01 16.12 Z';
      fill: #4f74b2;
    }
  }
  > #body-Grupo-10 {
    type: group;
    transform: translate(101.03px, 44.64px);
    > #body-Grupo-10-Trazado-1 {
      type: path;
      d: 'M 24.65 37.88 C 24.71 37.71 33.09 13.44 31.43 -2.83 C 29.85 -18.24 23.98 -29.72 15.76 -34.83 C 14.2 -35.8 11.48 -36.84 8.2 -37.88 C -7.27 -31.33 -17.32 -21.63 -25.35 -19.94 C -27.32 -19.53 -30.11 -19.66 -33.09 -19.95 C -18.56 24.28 21.39 36.92 24.65 37.88 Z';
      fill: #f4c92a;
    }
  }
  > #body-Grupo-9 {
    type: group;
    transform: translate(184.03px, 89.29px);
    > #body-Grupo-9-Trazado-1 {
      type: path;
      d: 'M 57.12 16.76 C 55.22 -9.19 47.65 -35.97 29.28 -55.2 C 18.93 -66.03 5.98 -75.01 -8.15 -80.93 C -4.08 -66.89 -4.41 -57.18 -3.8 -49.37 C -3.02 -39.48 -2.24 -18.59 -16.58 -10.92 C -33.1 -2.09 -56.69 -6.43 -58.27 -6.74 C -58.18 -6.71 -58.13 -6.7 -58.13 -6.7 C -58.13 -6.7 -58.32 -6.51 -58.69 -6.19 C -53.41 -5.21 15.44 8.11 26.98 34.08 C 34.33 50.61 33.3 63.63 30.71 71.94 C 34.67 74.19 37.58 77.61 39.68 80.93 C 57.79 66.13 58.69 38.26 57.12 16.76 Z';
      fill: #dd4073;
    }
  }
  > #body-Grupo-8 {
    type: group;
    transform: translate(74.92px, 64.24px);
    > #body-Grupo-8-Trazado-1 {
      type: path;
      d: 'M -19.58 -40.54 C -20.22 -40.49 -20.9 -40.4 -21.6 -40.28 C -34.9 -25.7 -50.97 -1.61 -49.9 28.88 C -42.82 32.17 -34.27 34.65 -23.91 35.8 C 21.2 40.78 44.85 23.54 49.92 19.28 C 50.03 18.97 50.09 18.79 50.09 18.79 C 50.09 18.79 50.21 18.82 50.42 18.86 C 50.78 18.54 50.98 18.35 50.98 18.35 C 50.98 18.35 50.93 18.34 50.84 18.31 C 50.79 18.3 50.75 18.3 50.75 18.3 C 50.75 18.3 50.76 18.29 50.76 18.29 C 47.5 17.32 7.55 4.69 -6.98 -39.54 C -11.54 -39.98 -16.51 -40.77 -19.58 -40.54 Z';
      fill: #96c8c9;
    }
  }
  > #body-Grupo-7 {
    type: group;
    transform: translate(145.51px, 43.73px);
    > #body-Grupo-7-Trazado-1 {
      type: path;
      d: 'M -13.05 -1.92 C -11.39 14.36 -19.77 38.63 -19.83 38.8 C -19.8 38.81 -19.76 38.82 -19.74 38.82 C -18.16 39.13 5.43 43.48 21.95 34.64 C 36.28 26.97 35.5 6.08 34.73 -3.8 C 34.11 -11.62 34.45 -21.33 30.37 -35.37 C 19.56 -39.9 8.06 -42.63 -3.49 -43.03 C -16.66 -43.48 -27.37 -40.74 -36.28 -36.97 C -33 -35.93 -30.27 -34.88 -28.72 -33.92 C -20.5 -28.8 -14.62 -17.33 -13.05 -1.92 Z';
      fill: #2e2b60;
    }
  }
  > #body-Grupo-6 {
    type: group;
    transform: translate(125.72px, 82.54px);
    > #body-Grupo-6-Trazado-1 {
      type: path;
      d: 'M -0.04 0 C -0.04 0 -0.01 0 0.04 0.01 C 0.02 0.01 -0.01 0 -0.04 -0.01 C -0.04 -0.01 -0.04 0 -0.04 0 Z';
      fill: none;
      stroke: #000000;
      stroke-width: 1px;
      stroke-miterlimit: 10;
    }
  }
  > #body-Grupo-5 {
    type: group;
    transform: translate(165.48px, 129.47px);
    > #body-Grupo-5-Trazado-1 {
      type: path;
      d: 'M -44.47 17.23 C -40.17 29.81 -34.48 39.63 -26.5 46.38 C 1.37 41.92 29.87 29.49 38.86 29.23 C 42.95 29.11 46.38 30.13 49.26 31.76 C 51.85 23.45 52.88 10.43 45.53 -6.1 C 33.99 -32.07 -34.86 -45.39 -40.14 -46.38 C -40.28 -46.25 -40.44 -46.11 -40.63 -45.95 C -42.1 -41.54 -52.87 -7.36 -44.47 17.23 Z';
      fill: #96c8c9;
    }
  }
  > #body-Grupo-4 {
    type: group;
    transform: translate(125.09px, 83.28px);
    > #body-Grupo-4-Trazado-1 {
      type: path;
      d: 'M -0.25 0.24 C -0.05 0.08 0.11 -0.06 0.25 -0.18 C 0.04 -0.22 -0.08 -0.24 -0.08 -0.24 C -0.08 -0.24 -0.14 -0.07 -0.25 0.24 Z';
      fill: none;
      stroke: #000000;
      stroke-width: 1px;
      stroke-miterlimit: 10;
    }
  }
  > #body-Grupo-3 {
    type: group;
    transform: translate(111.98px, 140.2px);
    > #body-Grupo-3-Trazado-1 {
      type: path;
      d: 'M 102.76 21.04 C 101.12 26.3 98.86 29.67 97.7 30.84 C 94.7 33.84 75.25 49.61 49.36 45.5 C 40.34 44.07 33.02 40.74 27 35.65 C 19.74 36.82 12.52 37.45 5.7 37.17 C -27.3 35.84 -78.97 16.84 -86.3 -39.16 C -86.65 -41.84 -86.87 -44.48 -86.96 -47.07 C -96.25 -51.39 -103 -57.11 -107.88 -63.04 C -108.33 -61.53 -108.7 -60.12 -108.97 -58.83 C -111.73 -45.45 -110.62 -19.99 -103.3 -3.83 C -96.97 10.17 -81.82 23.69 -72.3 31.17 C -62.02 39.26 -38.33 51.21 -25.97 55.5 C -17.88 58.32 -3.52 61.38 5.03 61.84 C 12.46 62.24 22.07 63.04 34.03 60.84 C 46.7 58.5 62.32 54.73 67.7 52.5 C 77.36 48.5 96.26 40.42 108.36 32.5 C 109.55 31.73 110.67 30.89 111.73 30.02 C 109.63 26.71 106.72 23.28 102.76 21.04 Z';
      fill: #2e2b60;
    }
  }
  > #body-Grupo-2 {
    type: group;
    transform: translate(28.71px, 58.54px);
    > #body-Grupo-2-Trazado-1 {
      type: path;
      d: 'M 24.61 -34.58 C 15.9 -33.13 3.33 -26.77 -2.04 -21.84 C -10.36 -14.2 -20.71 5.68 -24.61 18.61 C -19.73 24.55 -12.99 30.26 -3.69 34.58 C -4.76 4.09 11.31 -20 24.61 -34.58 Z';
      fill: #4f74b2;
    }
  }
  > #body-Grupo-1 {
    type: group;
    transform: translate(176.86px, 174.2px);
    > #body-Grupo-1-Trazado-1 {
      type: path;
      d: 'M -37.88 1.65 C -31.86 6.74 -24.54 10.07 -15.52 11.51 C 10.37 15.62 29.82 -0.16 32.82 -3.16 C 33.98 -4.32 36.24 -7.7 37.88 -12.96 C 35 -14.6 31.57 -15.61 27.48 -15.49 C 18.49 -15.23 -10.01 -2.81 -37.88 1.65 Z';
      fill: #96c8c9;
    }
  }
  > #Tail-Control {
    type: group;
    transform: translate(163.69px, -116.95px) scale(2.13, 2.92);
    z-index: -13;
    > #feather-contornos {
      type: group;
      transform-origin: -0.51px -0.05px;
      transform: translate(29.41px, 74.72px) scale(0.47, 0.34);
      z-index: -8;
      animation: feather-contornos-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-Grupo-3 {
        type: group;
        transform: translate(22.49px, 35.45px);
        > #feather-contornos-Grupo-3-Trazado-1 {
          type: path;
          d: 'M -19.92 -21.26 C -18.65 -14.71 -17.09 -8.25 -15.08 -1.78 C -11.08 11.11 -1.92 35.2 15.53 31.32 C 16.68 31.06 17.84 30.72 18.78 30.01 C 20.23 28.92 20.97 27.09 21.15 25.29 C 22.24 13.76 15.28 2.64 8.54 -5.99 C 3.13 -12.91 -1.98 -20.23 -8.89 -25.76 C -10.8 -27.28 -21.93 -33.04 -22.24 -35.2 C -21.56 -30.49 -20.81 -25.85 -19.92 -21.26 Z';
          fill: #2e2b60;
        }
      }
      > #feather-contornos-Grupo-2 {
        type: group;
        transform: translate(23.58px, 39.92px);
        > #feather-contornos-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -6.33 -9.67 C -6.33 -9.67 0.32 -0.21 0.32 -0.21 C 1.97 2.16 3.63 4.53 5.14 7 C 5.59 7.89 6.26 8.61 6.33 9.67 C 5.4 9.18 5 8.28 4.36 7.51 C 2.7 5.14 1.19 2.67 -0.32 0.21 C -0.32 0.21 -6.33 -9.67 -6.33 -9.67 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-Grupo-1 {
        type: group;
        transform: translate(20.35px, 41.25px);
        > #feather-contornos-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -3.43 -7.33 C -1.59 -3.75 0.29 -0.18 2.02 3.46 C 2.46 4.63 3.43 6.06 3.23 7.33 C 2.14 6.64 1.71 4.98 1.11 3.87 C -0.5 0.18 -1.94 -3.59 -3.43 -7.33 Z';
          fill: #ffffff;
        }
      }
    }
    > #feather-contornos-2 {
      type: group;
      transform-origin: 28.33px 134.88px;
      transform: translate(-8.93px, -77.3px) scale(0.47, 0.34);
      z-index: -7;
      animation: feather-contornos-2-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-2-Grupo-4 {
        type: group;
        transform: translate(20.83px, 67.88px);
        > #feather-contornos-2-Grupo-4-Trazado-1 {
          type: path;
          d: 'M 20.58 34.77 C 20.58 34.77 19.51 -32.42 19.51 -32.42 C 19.51 -32.42 18.35 -49.81 17.92 -51.37 C 16.93 -54.96 17.13 -67.63 7.12 -67.3 C -1.05 -67.03 -3.3 -60.85 -4.86 -54.07 C -5.8 -54.33 -6.85 -54.45 -8.05 -54.37 C -16.26 -53.82 -18.27 -47.48 -19.6 -40.59 C -20.58 -35.57 -20.43 -26.57 -19.38 -8.37 C -18.27 10.97 -10.27 50.3 -10.27 50.3 C -10.27 50.3 0.62 67.63 0.62 67.63 C 0.62 67.63 8.16 48.89 8.16 48.89 C 8.16 48.89 11.67 54.92 11.67 54.92 C 11.67 54.92 20.58 34.77 20.58 34.77 Z';
          fill: #df1125;
        }
      }
      > #feather-contornos-2-Grupo-3 {
        type: group;
        transform: translate(9.02px, 38.07px);
        > #feather-contornos-2-Grupo-3-Trazado-1 {
          type: path;
          d: 'M 0.98 9 C 0.45 4.5 -0.12 0.03 -0.52 -4.47 C -0.53 -5.88 -0.98 -7.7 -0.35 -9 C 0.46 -7.81 0.28 -5.93 0.48 -4.53 C 0.75 -0.03 0.84 4.5 0.98 9 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-2-Grupo-2 {
        type: group;
        transform: translate(18.73px, 29.9px);
        > #feather-contornos-2-Grupo-2-Trazado-1 {
          type: path;
          d: 'M 1.6 15.5 C 1.02 10.03 -0.43 -2.42 -0.89 -7.72 C -1 -10.31 -1.6 -12.93 -1.06 -15.5 C -0.09 -13.06 -0.23 -10.36 0.1 -7.78 C 0.55 -2.54 1.25 10.09 1.6 15.5 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-2-Grupo-1 {
        type: group;
        transform: translate(23.17px, 24.07px);
        > #feather-contornos-2-Grupo-1-Trazado-1 {
          type: path;
          d: 'M 0.83 11 C 0.53 4.58 -0.4 -1.8 -0.75 -8.22 C -0.72 -9.17 -0.95 -10.08 -0.51 -11 C 0.38 -9.37 0.18 -7.35 0.42 -5.54 C 0.73 -0.25 0.95 5.7 0.83 11 Z';
          fill: #ffffff;
        }
      }
    }
    > #feather-contornos-3 {
      type: group;
      transform-origin: 12.14px 158.47px;
      transform: translate(16.07px, -100.37px) scale(0.47, 0.34);
      z-index: -6;
      animation: feather-contornos-3-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-3-Grupo-4 {
        type: group;
        transform: translate(38.14px, 83.47px);
        > #feather-contornos-3-Grupo-4-Trazado-1 {
          type: path;
          d: 'M 19.22 -78.56 C 8.43 -81.12 1.61 -74.8 -2.74 -67.08 C -3.94 -74.62 -7.36 -81.49 -16.56 -82.11 C -33 -83.22 -35.67 -64.11 -36.78 -52.33 C -37.89 -40.55 -32.78 69 -32.78 69 C -32.78 69 -25.22 83.22 -25.22 83.22 C -25.22 83.22 -16.11 69 -16.11 67.44 C -16.11 67.36 -16.07 66.97 -16 66.33 C -16 66.33 -10.56 60.11 -10.56 60.11 C -10.56 60.11 21.31 -10.12 28.33 -35.89 C 30.33 -43.22 37.89 -74.11 19.22 -78.56 Z';
          fill: #ef7a37;
        }
      }
      > #feather-contornos-3-Grupo-3 {
        type: group;
        transform: translate(14.78px, 38.31px);
        > #feather-contornos-3-Grupo-3-Trazado-1 {
          type: path;
          d: 'M -1.75 10.83 C -1.2 5.39 -0.68 -0.06 0 -5.48 C 0.35 -7.25 0.28 -9.28 1.25 -10.83 C 1.75 -9.08 1.14 -7.14 0.99 -5.35 C 0.18 0.06 -0.81 5.44 -1.75 10.83 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-3-Grupo-2 {
        type: group;
        transform: translate(36.78px, 35.31px);
        > #feather-contornos-3-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -4.41 16.83 C -2.2 8.78 -0.37 -0.42 1.67 -8.52 C 2.48 -11.3 2.83 -14.27 4.25 -16.83 C 4.42 -15.33 3.9 -13.95 3.66 -12.5 C 1.32 -2.89 -1.48 7.38 -4.41 16.83 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-3-Grupo-1 {
        type: group;
        transform: translate(31.12px, 28.6px);
        > #feather-contornos-3-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -4.43 12.21 C -3.01 8.76 -1.49 3.52 -0.29 -0.07 C 0.68 -3.16 1.68 -6.25 2.79 -9.29 C 3.25 -10.3 3.45 -11.38 4.28 -12.21 C 4.43 -11.05 3.93 -10.07 3.67 -8.99 C 2.69 -5.9 1.57 -2.85 0.42 0.18 C -0.99 3.71 -2.79 8.82 -4.43 12.21 Z';
          fill: #ff0000;
          stroke: #ffffff;
          stroke-width: 1px;
          stroke-miterlimit: 10;
        }
      }
    }
    > #feather-contornos-4 {
      type: group;
      transform-origin: 2.05px 134.14px;
      transform: translate(33.53px, -77.6px) scale(0.47, 0.34);
      z-index: -5;
      animation: feather-contornos-4-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-4-Grupo-4 {
        type: group;
        transform: translate(53.05px, 70.14px);
        > #feather-contornos-4-Grupo-4-Trazado-1 {
          type: path;
          d: 'M 38.98 -35.44 C 29.32 -44.09 21.41 -42.69 15.82 -39.25 C 17.9 -48.18 17.47 -57.85 8.09 -62.33 C -7.69 -69.89 -15.46 -58.56 -23.24 -39.44 C -31.02 -20.33 -52.8 47.22 -52.8 47.22 C -52.8 47.22 -52.57 63 -52.57 63 C -52.57 63 -44.73 56.63 -44.73 56.63 C -44.73 56.63 -48.13 69.89 -48.13 69.89 C -48.13 69.89 -33.24 62.78 -33.24 62.78 C -33.24 62.78 7.2 24.33 7.2 24.33 C 7.2 24.33 30.09 3.22 35.65 -1.67 C 41.2 -6.55 52.8 -23.08 38.98 -35.44 Z';
          fill: #4f74b2;
        }
      }
      > #feather-contornos-4-Grupo-3 {
        type: group;
        transform: translate(58.25px, 39.69px);
        > #feather-contornos-4-Grupo-3-Trazado-1 {
          type: path;
          d: 'M -5.33 7.67 C -2.83 3.72 -0.36 -0.25 2.26 -4.12 C 3.18 -5.28 3.98 -6.99 5.33 -7.67 C 5.17 -6.17 3.84 -4.81 3.07 -3.55 C 0.36 0.25 -2.51 3.95 -5.33 7.67 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-4-Grupo-2 {
        type: group;
        transform: translate(56.58px, 50.69px);
        > #feather-contornos-4-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -10.33 15.33 C -6.77 9.84 1.22 -2.7 4.76 -7.94 C 6.57 -10.44 8.02 -13.26 10.33 -15.33 C 9.28 -12.41 7.21 -10.01 5.58 -7.39 C 2.09 -2.21 -6.64 10.05 -10.33 15.33 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-4-Grupo-1 {
        type: group;
        transform: translate(60.08px, 59.69px);
        > #feather-contornos-4-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -10.17 12.33 C -6.66 7.9 1.23 -2.26 4.7 -6.48 C 6.48 -8.47 7.94 -10.82 10.17 -12.33 C 9.11 -9.86 7.08 -7.98 5.47 -5.85 C 2.03 -1.68 -6.54 8.11 -10.17 12.33 Z';
          fill: #ffffff;
        }
      }
    }
    > #feather-contornos-5 {
      type: group;
      transform-origin: 5.67px 91.43px;
      transform: translate(33.88px, -30.11px) scale(0.47, 0.34);
      z-index: -4;
      animation: feather-contornos-5-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-5-Grupo-3 {
        type: group;
        transform: translate(63.17px, 48.93px);
        > #feather-contornos-5-Grupo-3-Trazado-1 {
          type: path;
          d: 'M 58.92 6.68 C 56.51 -4.3 48.53 -6.59 41.95 -6.52 C 48.98 -12.53 55.1 -22.35 46.47 -33.1 C 33.97 -48.68 16.25 -34.88 14.69 -33.99 C 13.14 -33.1 -15.08 -9.77 -15.08 -9.77 C -15.08 -9.77 -48.42 18.23 -48.42 18.23 C -48.42 18.23 -59.97 36.9 -59.97 36.9 C -59.97 36.9 -53.32 35.13 -53.32 35.13 C -59.51 40.42 -62.92 44.91 -59.53 46.01 C -51.31 48.68 -9.97 46.45 -9.97 46.45 C -9.97 46.45 35.37 30.53 39.36 28.9 C 44.25 26.9 62.92 24.9 58.92 6.68 Z';
          fill: #ef7a37;
        }
      }
      > #feather-contornos-5-Grupo-2 {
        type: group;
        transform: translate(73.58px, 43.17px);
        > #feather-contornos-5-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -5.5 4.21 C -2.41 1.62 0.56 -1.12 3.84 -3.46 C 4.4 -3.74 4.78 -4.21 5.5 -4.13 C 5.38 -3.41 4.84 -3.17 4.41 -2.71 C 1.27 -0.19 -2.17 1.93 -5.5 4.21 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-5-Grupo-1 {
        type: group;
        transform: translate(86.25px, 52.38px);
        > #feather-contornos-5-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -16.5 9 C -10.72 5.72 2.37 -1.86 8.01 -4.93 C 10.82 -6.34 13.45 -8.2 16.5 -9 C 14.18 -6.86 11.18 -5.66 8.49 -4.07 C 2.91 -1.02 -10.7 5.96 -16.5 9 Z';
          fill: #ffffff;
        }
      }
    }
    > #feather-contornos-6 {
      type: group;
      transform-origin: 2.8px 46.03px;
      transform: translate(22.28px, 24.02px) scale(0.47, 0.34);
      z-index: -3;
      animation: feather-contornos-6-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-6-Grupo-4 {
        type: group;
        transform: translate(77.3px, 38.03px);
        > #feather-contornos-6-Grupo-4-Trazado-1 {
          type: path;
          d: 'M 60.1 2.36 C 65.7 1.19 77.05 -2.47 74.72 -18.22 C 71.84 -37.78 52.28 -32.44 50.06 -31.55 C 47.84 -30.67 -39.27 -8.89 -39.27 -8.89 C -39.27 -8.89 -52.38 -3.78 -53.05 -3.33 C -53.47 -3.05 -47.81 -1.54 -43.55 -0.45 C -48.61 -0.32 -51.72 -0.22 -51.72 -0.22 C -51.72 -0.22 -77.05 10.67 -77.05 10.67 C -77.05 10.67 -55.05 26.89 -55.05 26.89 C -55.05 26.89 8.24 34.92 26.73 36.22 C 39.39 37.11 66.06 37.78 69.84 22.22 C 72.85 9.82 65.91 4.64 60.1 2.36 Z';
          fill: #df1125;
        }
      }
      > #feather-contornos-6-Grupo-3 {
        type: group;
        transform: translate(123.36px, 22.44px);
        > #feather-contornos-6-Grupo-3-Trazado-1 {
          type: path;
          d: 'M -6.67 1.37 C -2.81 0.49 1.01 -0.57 4.92 -1.13 C 5.54 -1.13 6.07 -1.37 6.67 -0.96 C 6.25 -0.38 5.66 -0.42 5.08 -0.21 C 1.21 0.58 -2.75 0.88 -6.67 1.37 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-6-Grupo-2 {
        type: group;
        transform: translate(113.86px, 36.95px);
        > #feather-contornos-6-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -19.5 -1.15 C -12.59 -0.96 3.1 -0.67 9.77 -0.39 C 13.02 -0.14 16.35 -0.38 19.5 0.52 C 16.28 1.15 12.98 0.63 9.73 0.6 C 3.14 0.32 -12.71 -0.74 -19.5 -1.15 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-6-Grupo-1 {
        type: group;
        transform: translate(111.86px, 43.36px);
        > #feather-contornos-6-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -19.5 -1.22 C -13.1 -0.06 -6.51 -0.18 -0.02 0.07 C 4.81 0.13 9.77 0.15 14.61 0.02 C 16.26 0.06 17.85 -0.23 19.5 0.11 C 17.96 0.81 16.29 0.77 14.65 0.95 C 9.75 1.22 4.84 1.08 -0.05 0.83 C -6.54 0.34 -13.14 0.19 -19.5 -1.22 Z';
          fill: #ffffff;
        }
      }
    }
    > #feather-contornos-7 {
      type: group;
      transform-origin: 0.75px 0.14px;
      transform: translate(23.26px, 73.68px) scale(0.47, 0.34);
      z-index: -2;
      animation: feather-contornos-7-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
      animation-fill-mode: both;
      > #feather-contornos-7-Grupo-4 {
        type: group;
        transform: translate(66.25px, 36.14px);
        > #feather-contornos-7-Grupo-4-Trazado-1 {
          type: path;
          d: 'M 44.89 -26.55 C 30 -31 17.33 -31.22 4.22 -32.33 C -8.89 -33.44 -44.22 -33.89 -44.22 -33.89 C -44.22 -33.89 -51.69 -33.63 -51.69 -33.63 C -51.69 -33.63 -55.78 -35.22 -55.78 -35.22 C -55.78 -35.22 -66 -35.89 -66 -35.89 C -66 -35.89 -61.78 -30.55 -61.78 -30.55 C -61.78 -30.55 -17.55 7.67 -10.89 12.78 C -4.22 17.89 9.11 26.11 12 27.22 C 14.89 28.33 31.78 35.89 41.78 26.33 C 47.81 20.57 46.56 13.51 41.89 7.65 C 43 7.9 43.8 8.06 44.22 8.11 C 50 8.78 61.56 6.33 63.78 -4.55 C 66 -15.44 59.78 -22.11 44.89 -26.55 Z';
          fill: #2e2b60;
        }
      }
      > #feather-contornos-7-Grupo-3 {
        type: group;
        transform: translate(73.16px, 30.88px);
        > #feather-contornos-7-Grupo-3-Trazado-1 {
          type: path;
          d: 'M -31.91 -12.63 C -12.68 -4.88 8.12 2.27 27.28 10.17 C 31.91 12.05 31.89 12.63 27.02 10.85 C 7.58 3.68 -12.79 -4.64 -31.91 -12.63 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-7-Grupo-2 {
        type: group;
        transform: translate(86.42px, 28.99px);
        > #feather-contornos-7-Grupo-2-Trazado-1 {
          type: path;
          d: 'M -14.17 -4.4 C -10.02 -3.39 -4.05 -1.64 0.13 -0.49 C 3.7 0.51 7.25 1.55 10.77 2.72 C 11.94 3.2 13.17 3.41 14.17 4.26 C 12.86 4.4 11.73 3.88 10.49 3.61 C 6.94 2.57 3.42 1.41 -0.09 0.23 C -4.22 -1.13 -10.06 -3.17 -14.17 -4.4 Z';
          fill: #ffffff;
        }
      }
      > #feather-contornos-7-Grupo-1 {
        type: group;
        transform: translate(42.58px, 27.59px);
        > #feather-contornos-7-Grupo-1-Trazado-1 {
          type: path;
          d: 'M -5.67 -5.01 C -2.7 -2.66 0.29 -0.34 3.16 2.12 C 3.88 2.74 4.59 3.36 5.2 4.09 C 5.41 4.33 5.63 4.55 5.67 4.99 C 5.23 5.01 4.98 4.82 4.72 4.64 C 3.92 4.12 3.21 3.49 2.5 2.86 C -0.29 0.31 -2.96 -2.36 -5.67 -5.01 Z';
          fill: #ffffff;
        }
      }
    }
    > #back-contornos {
      type: group;
      transform-origin: 71.3px 97.18px;
      transform: translate(-40.63px, -38.85px) scale(0.47, 0.34);
      z-index: -1;
      > #back-contornos-Grupo-20 {
        type: group;
        transform: translate(79.27px, 77.48px);
        > #back-contornos-Grupo-20-Trazado-1 {
          type: path;
          d: 'M 62.81 44.17 C 62.81 39.65 59.24 35.58 53.59 32.81 C 59.5 29.42 63.09 24.49 62.61 19.35 C 62.14 14.25 57.78 10.1 51.43 7.84 C 53.59 5.53 54.65 3 54.16 0.59 C 53.7 -1.69 51.92 -3.53 49.28 -4.82 C 52.42 -12.37 50.51 -21.24 44 -26.43 C 41.68 -28.28 39.02 -29.44 36.26 -29.97 C 36.28 -30.4 36.3 -30.83 36.3 -31.27 C 36.3 -43.49 27.2 -53.45 15.83 -53.89 C 15.02 -61.42 10.39 -67.66 3.66 -69.21 C 0.8 -69.86 -2.09 -69.58 -4.78 -68.56 C -7.43 -73.8 -11.71 -77.23 -16.55 -77.23 C -23.42 -77.23 -29.17 -70.35 -30.7 -61.12 C -32.2 -60.92 -33.61 -60.33 -34.9 -59.46 C -37.13 -63.48 -40.65 -66.09 -44.62 -66.09 C -51.35 -66.09 -56.81 -58.62 -56.81 -49.42 C -56.81 -49.13 -56.79 -48.86 -56.78 -48.57 C -62.22 -45.13 -63.09 -36.33 -58.67 -28.67 C -54.16 -20.86 -45.87 -17.21 -40.16 -20.51 C -37.07 -22.29 -35.38 -25.75 -35.17 -29.78 C -33.48 -28.56 -31.55 -27.86 -29.51 -27.86 C -25.19 -27.86 -21.4 -30.94 -19.24 -35.57 C -18.37 -35.34 -17.47 -35.2 -16.55 -35.2 C -15.36 -35.2 -14.22 -35.42 -13.11 -35.81 C -11.28 -33.61 -8.93 -31.97 -6.2 -31.11 C -6.13 -19.17 2.63 -9.42 13.69 -8.68 C 14.07 -5.46 15.29 -2.38 17.31 0.24 C 14.13 2.92 12.45 6.01 13.05 8.94 C 13.48 11.05 15.03 12.77 17.34 14.03 C 14.36 16.95 12.75 20.4 13.08 23.95 C 13.39 27.27 15.35 30.19 18.43 32.45 C 12.35 35.23 8.46 39.45 8.46 44.17 C 8.46 46.13 9.14 48.01 10.36 49.73 C 8.08 51.36 6.59 53.43 6.17 55.82 C 4.78 63.67 15.39 72.11 29.87 74.67 C 44.35 77.23 57.21 72.93 58.59 65.08 C 59.19 61.7 57.56 58.22 54.37 55.14 C 59.56 52.38 62.81 48.49 62.81 44.17 Z';
          fill: #dd4073;
        }
      }
      > #back-contornos-Grupo-19 {
        type: group;
        transform: translate(119.95px, 121.5px);
        > #back-contornos-Grupo-19-Trazado-1 {
          type: path;
          d: 'M 21 0 C 21 6.63 11.6 12 0 12 C -11.6 12 -21 6.63 -21 0 C -21 -6.63 -11.6 -12 0 -12 C 11.6 -12 21 -6.63 21 0 Z';
          fill: #4f74b2;
        }
      }
      > #back-contornos-Grupo-18 {
        type: group;
        transform: translate(116.62px, 141.83px);
        > #back-contornos-Grupo-18-Trazado-1 {
          type: path;
          d: 'M 21 0 C 21 6.63 11.6 12 0 12 C -11.6 12 -21 6.63 -21 0 C -21 -6.63 -11.6 -12 0 -12 C 11.6 -12 21 -6.63 21 0 Z';
          fill: #4f74b2;
        }
      }
      > #back-contornos-Grupo-17 {
        type: group;
        transform: translate(28.28px, 44px);
        > #back-contornos-Grupo-17-Trazado-1 {
          type: path;
          d: 'M 10.14 -3.31 C 12.91 5.17 10.62 13.54 5.02 15.37 C -0.58 17.2 -7.36 11.8 -10.14 3.31 C -12.91 -5.17 -10.62 -13.54 -5.02 -15.37 C 0.58 -17.2 7.36 -11.8 10.14 -3.31 Z';
          fill: #4f74b2;
        }
      }
      > #back-contornos-Grupo-16 {
        type: group;
        transform: translate(36.48px, 29.01px);
        > #back-contornos-Grupo-16-Trazado-1 {
          type: path;
          d: 'M 10.62 -3.47 C 13.6 5.66 11.27 14.62 5.41 16.54 C -0.46 18.45 -7.63 12.6 -10.62 3.47 C -13.6 -5.66 -11.27 -14.62 -5.41 -16.54 C 0.46 -18.45 7.64 -12.6 10.62 -3.47 Z';
          fill: #4f74b2;
        }
      }
      > #back-contornos-Grupo-15 {
        type: group;
        transform: translate(34.53px, 39.79px);
        > #back-contornos-Grupo-15-Trazado-1 {
          type: path;
          d: 'M -6.8 15.71 C -7.74 14.99 -8.58 13.71 -8.58 13.71 C -8.58 13.71 -8.58 -18.29 -8.58 -18.29 C -8.58 -18.29 5.97 0.82 5.97 0.82 C 5.97 0.82 7.72 4.11 7.97 5.27 C 8.58 8.08 7.62 14.77 5.31 16.49 C 2.87 18.29 -4.4 17.56 -6.8 15.71 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-14 {
        type: group;
        transform: translate(112.95px, 93.03px);
        > #back-contornos-Grupo-14-Trazado-1 {
          type: path;
          d: 'M -17.56 -4.75 C -16.79 -6.75 -10.89 -10.19 -10.89 -10.19 C -10.89 -10.19 18.8 -8.07 18.8 -8.07 C 18.8 -8.07 0.31 7.28 0.31 7.28 C 0.31 7.28 -2.9 9.17 -4.04 9.47 C -6.83 10.19 -15.08 7.49 -16.89 5.25 C -18.8 2.89 -18.64 -1.92 -17.56 -4.75 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-13 {
        type: group;
        transform: translate(113.8px, 131.17px);
        > #back-contornos-Grupo-13-Trazado-1 {
          type: path;
          d: 'M -15.98 -6.78 C -13.08 -9.67 -6.85 -8.11 -6.85 -8.11 C -6.85 -8.11 19.56 1.55 19.56 1.55 C 19.56 1.55 -4.74 9.11 -4.74 9.11 C -4.74 9.11 -9.19 9.67 -11.52 8.78 C -14.21 7.75 -17.49 5.62 -18.5 2.92 C -19.56 0.08 -18.13 -4.64 -15.98 -6.78 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-12 {
        type: group;
        transform: translate(113.14px, 148.28px);
        > #back-contornos-Grupo-12-Trazado-1 {
          type: path;
          d: 'M -11.92 -9.69 C -8.15 -11.29 -2.96 -7.52 -2.96 -7.52 C -2.96 -7.52 17.95 11.29 17.95 11.29 C 17.95 11.29 -7.42 9.24 -7.42 9.24 C -7.42 9.24 -11.75 8.1 -13.59 6.41 C -15.7 4.45 -17.95 1.25 -17.88 -1.63 C -17.81 -4.66 -14.72 -8.5 -11.92 -9.69 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-11 {
        type: group;
        transform: translate(115.73px, 112.09px);
        > #back-contornos-Grupo-11-Trazado-1 {
          type: path;
          d: 'M -17.89 -6.92 C -15.66 -12.36 -8.89 -11.25 -8.89 -11.25 C -8.89 -11.25 19.89 -5.25 19.89 -5.25 C 19.89 -5.25 -3.11 8.86 -3.11 8.86 C -3.11 8.86 -8.97 11.34 -10.11 11.64 C -12.9 12.36 -18.22 6.86 -19.11 3.52 C -19.89 0.59 -19.03 -4.11 -17.89 -6.92 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-10 {
        type: group;
        transform: translate(108.69px, 73.78px);
        > #back-contornos-Grupo-10-Trazado-1 {
          type: path;
          d: 'M -17.96 -8.51 C -17.07 -10.5 -13.96 -13.17 -13.96 -13.17 C -13.96 -13.17 19.2 -12.38 19.2 -12.38 C 19.2 -12.38 -1.63 11.83 -1.63 11.83 C -3.8 13.17 -9.63 12.16 -11.74 11.38 C -14.45 10.39 -16.74 7.27 -18.07 3.61 C -19.11 0.75 -19.2 -5.73 -17.96 -8.51 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-9 {
        type: group;
        transform: translate(50.2px, 29.46px);
        > #back-contornos-Grupo-9-Trazado-1 {
          type: path;
          d: 'M -6.58 16.48 C -7.45 15.68 -9.88 11.9 -9.92 10.48 C -10.25 -2.74 -1.89 -18.76 -1.89 -18.76 C -1.89 -18.76 8.97 4.26 8.97 4.26 C 8.97 4.26 10.25 8.87 10.08 10.04 C 9.67 12.89 4.41 17.13 1.64 17.92 C -1.28 18.76 -5.14 17.81 -6.58 16.48 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-8 {
        type: group;
        transform: translate(66.85px, 28.37px);
        > #back-contornos-Grupo-8-Trazado-1 {
          type: path;
          d: 'M -6.68 15.02 C -7.32 14.03 -8.99 10.19 -8.68 8.8 C -5.74 -4.1 5.51 -18.05 5.51 -18.05 C 5.55 -18.46 8.54 -2 8.88 5.02 C 8.98 7.11 8.99 12.27 8.54 13.36 C 7.44 16.02 2.77 18.28 -0.11 18.37 C -3.14 18.46 -5.61 16.67 -6.68 15.02 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-7 {
        type: group;
        transform: translate(82.36px, 40.62px);
        > #back-contornos-Grupo-7-Trazado-1 {
          type: path;
          d: 'M -10.16 11.69 C -10.52 10.56 -10.19 6.8 -9.52 5.55 C -3.27 -6.1 10.37 -16.96 10.37 -16.96 C 10.52 -17.34 8.8 -0.97 7.26 5.88 C 6.8 7.92 5.68 13.2 4.96 14.13 C 3.18 16.4 -1.92 17.34 -4.72 16.66 C -7.67 15.94 -9.57 13.56 -10.16 11.69 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-6 {
        type: group;
        transform: translate(95.58px, 52.37px);
        > #back-contornos-Grupo-6-Trazado-1 {
          type: path;
          d: 'M -12.84 7.08 C -12.74 3.47 -11.64 1.02 -10.74 -0.09 C -2.42 -10.37 12.68 -17.23 12.68 -17.23 C 12.9 -17.58 10.16 0.46 7.37 6.91 C 6.54 8.83 4.03 13.91 3.14 14.69 C 0.98 16.59 -2.52 17.58 -8.74 14.69 C -11.5 13.41 -12.9 9.04 -12.84 7.08 Z';
          fill: #2e2b60;
        }
      }
      > #back-contornos-Grupo-5 {
        type: group;
        transform: translate(52.61px, 117.42px);
        > #back-contornos-Grupo-5-Trazado-1 {
          type: path;
          d: 'M 13.45 -6.14 C -9.22 -16.21 -18.42 -46.31 -9.62 -76.69 C -33.94 -70.01 -52.35 -38.53 -52.35 -0.66 C -52.35 42.06 -28.91 76.69 0 76.69 C 28.92 76.69 52.36 42.06 52.36 -0.66 C 52.36 -3.32 52.26 -5.95 52.09 -8.55 C 39.34 -2.07 25.57 -0.76 13.45 -6.14 Z';
          fill: #5aa0ac;
        }
      }
      > #back-contornos-Grupo-4 {
        type: group;
        transform: translate(69.44px, 78.04px);
        > #back-contornos-Grupo-4-Trazado-1 {
          type: path;
          d: 'M -16.83 -38.63 C -20.12 -38.63 -23.33 -38.16 -26.45 -37.3 C -35.25 -6.92 -26.06 23.18 -3.38 33.25 C 8.74 38.63 22.51 37.32 35.26 30.84 C 32.58 -8.18 10.28 -38.63 -16.83 -38.63 Z';
          fill: #96c8c9;
        }
      }
      > #back-contornos-Grupo-3 {
        type: group;
        transform: translate(58.73px, 58.83px);
        > #back-contornos-Grupo-3-Trazado-1 {
          type: path;
          d: 'M 1.56 0 C 1.56 -0.86 0.86 -1.56 0 -1.56 C -0.86 -1.56 -1.55 -0.86 -1.55 0 C -1.55 0.86 -0.86 1.56 0 1.56 C 0.86 1.56 1.56 0.86 1.56 0 Z';
          fill: #fdfbec;
        }
      }
      > #back-contornos-Grupo-2 {
        type: group;
        transform: translate(84.86px, 90.2px);
        > #back-contornos-Grupo-2-Trazado-1 {
          type: path;
          d: 'M 2.11 0 C 2.11 -1.16 1.16 -2.11 0 -2.11 C -1.16 -2.11 -2.11 -1.16 -2.11 0 C -2.11 1.16 -1.16 2.11 0 2.11 C 1.16 2.11 2.11 1.16 2.11 0 Z';
          fill: #fdfbec;
        }
      }
      > #back-contornos-Grupo-1 {
        type: group;
        transform: translate(79.94px, 66.05px);
        > #back-contornos-Grupo-1-Trazado-1 {
          type: path;
          d: 'M 1.86 0 C 1.86 -1.02 1.02 -1.85 0 -1.85 C -1.02 -1.85 -1.85 -1.02 -1.85 0 C -1.85 1.02 -1.02 1.86 0 1.86 C 1.02 1.86 1.86 1.02 1.86 0 Z';
          fill: #fdfbec;
        }
      }
    }
  }
  > #body_mask {
    type: group;
    transform: translate(160.69px, 59.05px);
    z-index: -1;
    > #body_mask-Elipse-1 {
      type: group;
      transform: translate(11.49px, 77.07px) scale(1.09, 1.01);
      > #body_mask-Elipse-1-Trazado-el-ptico-1 {
        type: ellipse;
        cx: 0px;
        cy: 0px;
        rx: 47.68px;
        ry: 50.16px;
        fill: #96c8c9;
      }
    }
  }
  > #wing-contornos-5 {
    type: group;
    transform-origin: 0.42px 55.92px;
    transform: translate(124.98px, 25.78px);
    z-index: 1;
    animation: wing-contornos-5-k 1s cubic-bezier(0.167, 0.113, 0.833, 0.788) 1;
    animation-fill-mode: both;
    > #wing-contornos-5-Grupo-3 {
      type: group;
      transform: translate(57.67px, 39.17px);
      > #wing-contornos-5-Grupo-3-Trazado-1 {
        type: path;
        d: 'M -57.42 16.92 C -57.42 16.92 -28.58 11.58 -3.42 -8.08 C 23.42 -29.05 35.28 -36.78 42.92 -37.75 C 52.08 -38.92 57.42 -21.58 47.42 -3.92 C 39.03 10.91 28.58 20.92 14.58 27.25 C 0.58 33.58 -29.42 38.92 -57.42 16.92 Z';
        fill: #ef7a37;
      }
    }
    > #wing-contornos-5-Grupo-2 {
      type: group;
      transform: translate(55.58px, 38.31px);
      > #wing-contornos-5-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 38 -20.23 C 20.87 -1.33 -1.34 14.91 -26.95 19.26 C -30.56 19.73 -34.37 20.23 -38 19.77 C -34.43 19.18 -30.66 19.08 -27.1 18.35 C -1.72 13.77 20.64 -1.62 38 -20.23 Z';
        fill: #fdfbec;
      }
    }
    > #wing-contornos-5-Grupo-1 {
      type: group;
      transform: translate(65.06px, 54.2px);
      > #wing-contornos-5-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 10.52 -5.45 C 5.21 -1.86 -0.09 1.95 -6.03 4.44 C -7.01 4.94 -10.52 5.45 -7.61 4.15 C -1.41 1.31 4.64 -1.97 10.52 -5.45 Z';
        fill: #fdfbec;
      }
    }
  }
  > #wing-contornos-6 {
    type: group;
    transform-origin: 0.92px 0.58px;
    transform: translate(124.82px, 81.45px);
    z-index: 2;
    animation: wing-contornos-6-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
    animation-fill-mode: both;
    > #wing-contornos-6-Grupo-2 {
      type: group;
      transform: translate(66.17px, 29.08px);
      > #wing-contornos-6-Grupo-2-Trazado-1 {
        type: path;
        d: 'M -65.92 -28.83 C -65.92 -28.83 -32.9 -20.34 -7.08 -19.33 C 10.08 -18.67 29.75 -19.5 29.75 -19.5 C 29.75 -19.5 65.92 -19.5 60.92 4.67 C 55.92 28.83 22.08 17.5 18.08 16.5 C 14.08 15.5 -47.25 -9.67 -65.92 -28.83 Z';
        fill: #ef7a37;
      }
    }
    > #wing-contornos-6-Grupo-1 {
      type: group;
      transform: translate(59.58px, 19.02px);
      > #wing-contornos-6-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 48.83 4.56 C 30.11 10.1 9.93 8.59 -8.97 4.69 C -11.78 3.98 -15.36 3.08 -18.16 2.35 C -22.22 1.03 -27.71 -0.55 -31.63 -2.2 C -37.33 -4.38 -43.6 -7 -48.83 -10.1 C -44.78 -8.87 -41.09 -6.88 -37.16 -5.36 C -37.16 -5.36 -31.28 -3.12 -31.28 -3.12 C -27.34 -1.5 -21.97 0.1 -17.9 1.44 C -15.11 2.17 -11.56 3.11 -8.78 3.85 C 10 7.98 30.09 9.81 48.83 4.56 Z';
        fill: #fdfbec;
      }
    }
  }
  > #wing-contornos-7 {
    type: group;
    transform-origin: 0.25px 0.67px;
    transform: translate(124.98px, 81.62px);
    z-index: 3;
    animation: wing-contornos-7-k 1s cubic-bezier(0.167, 0, 0.833, 1) 1;
    animation-fill-mode: both;
    > #wing-contornos-7-Grupo-2 {
      type: group;
      transform: translate(55px, 48.42px);
      > #wing-contornos-7-Grupo-2-Trazado-1 {
        type: path;
        d: 'M -54.75 -48.17 C -54.75 -48.17 -52.25 -26.5 -35.92 -4.5 C -23.2 12.63 7.08 34.5 10.25 36.33 C 13.42 38.17 28.42 48.17 41.58 38.67 C 54.75 29.17 37.42 10 30.25 4.17 C 23.08 -1.67 2.42 -14.83 -6.92 -20.17 C -16.25 -25.5 -54.75 -48.17 -54.75 -48.17 Z';
        fill: #ef7a37;
      }
    }
    > #wing-contornos-7-Grupo-1 {
      type: group;
      transform: translate(39.92px, 37.08px);
      > #wing-contornos-7-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 36.67 32.33 C 13.17 17.55 -20.87 -5.93 -35.33 -29.54 C -35.82 -30.44 -36.27 -31.38 -36.67 -32.33 C -35.39 -30.71 -34.29 -29 -33.1 -27.32 C -24.63 -15.72 -14.05 -5.89 -3.11 3.34 C 9.5 13.84 22.83 23.5 36.67 32.33 Z';
        fill: #fdfbec;
      }
    }
  }
  > #neck-contornos {
    type: group;
    transform-origin: 19.42px 158.84px;
    transform: translate(38.54px, -119.62px);
    z-index: 6;
    mask: #neck-cut alpha-invert;
    > #neck-contornos-Grupo-1 {
      type: group;
      transform: translate(40.92px, 87.84px);
      > #neck-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -20.94 -49.85 C -20.68 -47.3 -19.19 -42.93 -17.44 -39.02 C -16.64 -37.21 -15.15 -33.29 -14.89 -31.52 C -14.19 -26.85 -14.86 -18.1 -16.67 -13.96 C -17.95 -11.02 -23.78 -1.96 -31.56 15.15 C -39.5 32.61 -40.67 57.37 -39.56 67.59 C -38.44 77.81 -34.22 82.26 -21.78 84.93 C -9.33 87.59 -0.22 73.37 -0.67 65.15 C -0.67 65.15 -4.58 64.87 -8.03 59.9 C -9.92 57.16 -12.45 53.47 -12.28 46.48 C -11.78 26.57 1.08 8.03 6.39 1.82 C 12.72 -5.6 26 -19.96 31.33 -28.41 C 36.67 -36.85 40.67 -48.85 38.44 -61.74 C 36.22 -74.63 15.32 -87.59 -3.36 -81.85 C -23.69 -75.6 -21.61 -56.3 -20.94 -49.85 Z';
        fill: #9c4b76;
        animation: neck-contornos-Grupo-1-Trazado-1-k 1s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1;
        animation-fill-mode: both;
      }
    }
  }
}

#Wing_Left_Postion {
  type: group;
  transform: scale(1.49, 1.6);
  animation: Wing_Left_Postion-k 0.75s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1;
  animation-fill-mode: both;
}

#head-contornos {
  type: group;
  transform-origin: 34px 33.23px;
  offset-path: path('M 180.4 106.48 C 180.4 106.48 180.4 101.48 180.4 101.48 C 180.4 101.48 180.4 125.81 180.4 131.48 C 180.4 137.14 180.4 135.48 180.4 135.48 C 180.4 135.48 180.4 136.14 180.4 131.48 C 180.4 126.81 180.4 112.31 180.4 107.48 C 180.4 102.64 180.4 102.48 180.4 102.48 C 180.4 102.48 180.4 106.48 180.4 106.48');
  offset-rotate: 0deg;
  transform: translate(-34px, -33.23px);
  animation: head-contornos-k 0.867s cubic-bezier(0.333, 0, 0.667, 1) 1 0.133s;
  animation-fill-mode: both;
  > #head-contornos-Grupo-1 {
    type: group;
    transform: translate(34px, 33.23px);
    > #head-contornos-Grupo-1-Trazado-1 {
      type: path;
      d: 'M 33.75 1.09 C 33.75 17.8 18.77 32.98 0.92 31.34 C -20.92 29.34 -33.75 8.05 -33.75 -8.66 C -33.75 -25.36 -19.5 -32.66 0.25 -32.82 C 18.38 -32.98 33.75 -15.61 33.75 1.09 Z';
      fill: #9c4b76;
    }
  }
  > #crest-contornos {
    type: group;
    transform-origin: 18.43px 39.13px;
    transform: translate(27.42px, -31.51px);
    z-index: -3;
    animation: crest-contornos-k 0.867s cubic-bezier(0.333, 0, 0.667, 1) 1 0.133s, crest-contornos-k-2 0.867s cubic-bezier(0.333, 0, 0.667, 1) 1 0.133s;
    animation-fill-mode: both;
    > #crest-contornos-Grupo-5 {
      type: group;
      transform: translate(4.58px, 27.25px);
      > #crest-contornos-Grupo-5-Trazado-1 {
        type: path;
        d: 'M 4.33 -0.92 C 4.33 5.8 2.47 11.25 0.17 11.25 C -2.14 11.25 -4.33 7.97 -4.33 1.25 C -4.33 -5.47 -3.08 -11.25 0.75 -11.17 C 4.17 -11.09 4.33 -7.64 4.33 -0.92 Z';
        fill: #dd4073;
      }
    }
    > #crest-contornos-Grupo-4 {
      type: group;
      transform: translate(18.38px, 23.7px);
      > #crest-contornos-Grupo-4-Trazado-1 {
        type: path;
        d: 'M 4.79 3.8 C 2.88 9.47 -1.36 14.65 -5.13 13.89 C -9.21 13.05 -8.21 5.9 -6.54 -0.61 C -4.88 -7.12 -0.34 -14.65 4.62 -13.03 C 9.21 -11.53 6.95 -2.56 4.79 3.8 Z';
        fill: #dd4073;
      }
    }
    > #crest-contornos-Grupo-3 {
      type: group;
      transform: translate(35.67px, 21.46px);
      > #crest-contornos-Grupo-3-Trazado-1 {
        type: path;
        d: 'M -12.01 4.21 C -9.17 -0.79 3.58 -21.21 11.33 -14.12 C 19.55 -6.61 -4.66 8.8 -8.76 14.21 C -10.84 16.96 -12.84 21.21 -17.01 17.04 C -19.55 14.5 -13.97 7.67 -12.01 4.21 Z';
        fill: #dd4073;
      }
    }
    > #crest-contornos-Grupo-2 {
      type: group;
      transform: translate(38.7px, 32.96px);
      > #crest-contornos-Grupo-2-Trazado-1 {
        type: path;
        d: 'M -14.61 5.8 C -11.12 -0.07 8.31 -12.29 12.39 -5.87 C 17.42 2.03 -4.95 10.7 -11.86 11.55 C -13.04 11.69 -15.96 12.29 -16.61 11.3 C -17.42 10.08 -15.36 7.05 -14.61 5.8 Z';
        fill: #dd4073;
      }
    }
    > #crest-contornos-Grupo-1 {
      type: group;
      transform: translate(37.78px, 44.46px);
      > #crest-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M -10.23 -0.17 C -9.11 0.12 -2.11 1.21 0.64 1.54 C 3.39 1.88 11.89 4.04 12.89 0.21 C 13.89 -3.62 5.73 -4.04 2.56 -3.87 C -0.61 -3.71 -6.98 -2.71 -10.77 -2.08 C -11.4 -1.98 -13.83 -1.76 -13.86 -1.12 C -13.89 -0.37 -10.96 -0.36 -10.23 -0.17 Z';
        fill: #dd4073;
      }
    }
  }
  > #neck-cut {
    type: group;
    transform: translate(109.6px, 182.75px) scale(1.11, 1.18);
    z-index: -1;
    > #neck-cut-Rect-ngulo-1 {
      type: group;
      transform: translate(-78.53px, -156.59px);
      > #neck-cut-Rect-ngulo-1-Trazado-de-rect-ngulo-1 {
        type: rect;
        x: -51.47px;
        y: -33.41px;
        width: 102.93px;
        height: 66.82px;
        fill: #c1d6ad;
      }
    }
  }
  > #beak-contornos {
    type: group;
    transform-origin: 24.71px 20.19px;
    transform: translate(-38.48px, 9.17px);
    z-index: 1;
    > #beak-contornos-Grupo-1 {
      type: group;
      transform: translate(24.71px, 20.19px);
      > #beak-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 19.71 -19.89 C 19 -19.88 18.37 -19.31 17.49 -18.73 C 15.94 -17.71 14.24 -16.9 12.57 -16.06 C 10.46 -15.01 7.33 -14.02 4.24 -13.01 C 0.61 -11.81 -4.33 -9.99 -6.93 -8.84 C -10.65 -7.18 -12.81 -5.94 -15.93 -3.34 C -18.41 -1.27 -20.74 1.73 -22.2 4.66 C -23.01 6.28 -23.87 8.83 -24.15 10.88 C -24.2 11.24 -24.46 13.16 -23.87 13.16 C -23.35 13.16 -22.54 12.16 -22.2 11.85 C -21.16 10.91 -20.15 9.96 -19.07 9.07 C -13.74 4.61 -7.75 3.45 -0.93 3.94 C 2.55 4.19 4.06 4.31 7.46 5.05 C 9.84 5.56 13.06 6.79 14.46 7.55 C 15.34 8.02 17.65 9.84 17.35 11.16 C 17.13 12.16 15.24 12.05 14.35 12.05 C 13.46 12.05 6.68 11.75 5.13 11.61 C 2.69 11.38 -0.08 11.18 -0.37 12.44 C -0.76 14.11 2.07 15.66 4.13 16.55 C 6.39 17.53 11.13 18.49 13.35 19.05 C 15.57 19.61 17.69 19.94 17.69 19.94 C 17.69 19.94 20.69 17.49 22.57 11.94 C 24.46 6.38 24.21 -0.28 23.91 -4.56 C 23.61 -8.8 22.79 -16.34 22.46 -17.62 C 22.33 -18.15 21.75 -19.08 21.35 -19.45 C 20.82 -19.94 20.12 -19.9 19.71 -19.89 Z';
        fill: #ef7a37;
      }
    }
  }
  > #under-eye-contornos {
    type: group;
    transform-origin: 20.63px 20.83px;
    transform: translate(14.5px, 8.82px);
    z-index: 2;
    > #under-eye-contornos-Grupo-1 {
      type: group;
      transform: translate(20.63px, 20.83px);
      > #under-eye-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 20.38 0 C 20.38 11.36 11.25 20.58 0 20.58 C -11.25 20.58 -20.37 11.36 -20.37 0 C -20.37 -11.36 -11.25 -20.58 0 -20.58 C 11.25 -20.58 20.38 -11.36 20.38 0 Z';
        fill: #2e2b60;
      }
    }
  }
  > #eye-contornos {
    type: group;
    transform-origin: 18.58px 18.58px;
    transform: translate(16px, 9.82px);
    z-index: 3;
    > #eye-contornos-Grupo-1 {
      type: group;
      transform: translate(18.58px, 18.58px);
      > #eye-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 18.33 0 C 18.33 10.13 10.13 18.33 0 18.33 C -10.12 18.33 -18.33 10.13 -18.33 0 C -18.33 -10.12 -10.12 -18.33 0 -18.33 C 10.13 -18.33 18.33 -10.12 18.33 0 Z';
        fill: #fdfbec;
      }
    }
  }
  > #iris-contornos {
    type: group;
    transform-origin: 12.03px 12.03px;
    z-index: 4;
    animation: iris-contornos-k 0.467s cubic-bezier(0.167, 0.167, 0.833, 0.833) 1 0.333s;
    animation-fill-mode: both;
    > #iris-contornos-Grupo-2 {
      type: group;
      transform: translate(12.03px, 12.03px);
      > #iris-contornos-Grupo-2-Trazado-1 {
        type: path;
        d: 'M 11.78 0 C 11.78 6.51 6.51 11.78 0 11.78 C -6.5 11.78 -11.78 6.51 -11.78 0 C -11.78 -6.5 -6.5 -11.78 0 -11.78 C 6.51 -11.78 11.78 -6.5 11.78 0 Z';
        fill: #f4c92a;
      }
    }
    > #iris-contornos-Grupo-1 {
      type: group;
      transform: translate(9.75px, 12.75px);
      > #iris-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 5.78 0 C 5.78 3.19 3.19 5.78 0 5.78 C -3.19 5.78 -5.78 3.19 -5.78 0 C -5.78 -3.19 -3.19 -5.78 0 -5.78 C 3.19 -5.78 5.78 -3.19 5.78 0 Z';
        fill: #2e2b60;
      }
    }
  }
  > #snood-contornos {
    type: group;
    transform-origin: 14.35px 0.75px;
    transform: translate(-11.78px, 11.57px);
    z-index: 5;
    animation: snood-contornos-k 1s cubic-bezier(0.333, 0, 0.667, 1) 1;
    animation-fill-mode: both;
    > #snood-contornos-Grupo-1 {
      type: group;
      transform: translate(14.35px, 48.75px);
      > #snood-contornos-Grupo-1-Trazado-1 {
        type: path;
        d: 'M 0.05 -48.5 C 1.24 -47.67 1.64 -43.36 2.07 -41.18 C 4.28 -26.6 6.09 -11.87 7.85 2.65 C 8.76 12.83 14.1 46.76 0.01 48.5 C -14.1 46.71 -8.72 12.85 -7.83 2.65 C -6.07 -11.87 -4.26 -26.6 -2.05 -41.17 C -1.65 -43.56 -1.33 -45.85 -0.63 -47.73 C -0.44 -48.24 -0.16 -48.5 -0.02 -48.5 C -0.02 -48.5 0.05 -48.5 0.05 -48.5 Z';
        fill: #dd4073;
      }
    }
  }
}
`;
