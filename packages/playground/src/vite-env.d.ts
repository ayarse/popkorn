/// <reference types="vite/client" />

// Minimal stand-in for `wrangler types`, whose generated workerd globals collide
// with the DOM lib this package compiles against. `lib/scenes.ts` narrows this
// to the bindings it actually uses.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
