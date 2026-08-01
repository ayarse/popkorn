import startHandler from "@tanstack/react-start/server-entry";

export { CopilotSession } from "./copilot-session";

// /mcp/<uuid> (agent, http) and /mcp/<uuid>/tab (playground tab, WebSocket).
const MCP_ROUTE = /^\/mcp\/([0-9a-fA-F-]{36})(\/tab)?$/;

// Umami served first-party: blocklists kill cloud.umami.is/gateway.umami.is by
// domain, so /pk/s.js is the tracker and /pk/api/send its collect endpoint
// (data-host-url="/pk" in __root.tsx makes the script post back here).
async function proxyUmami(request: Request, path: string): Promise<Response> {
  if (path === "/pk/s.js") {
    return fetch("https://cloud.umami.is/script.js", {
      cf: { cacheEverything: true, cacheTtl: 3600 },
    } as RequestInit);
  }
  const headers = new Headers(request.headers);
  headers.delete("cookie"); // never hand Clerk's session to a third party
  headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "");
  return fetch("https://gateway.umami.is/api/send", {
    method: request.method,
    headers,
    body: await request.text(),
  });
}

type Env = Record<string, unknown> & {
  COPILOT_SESSION: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

export default {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/pk/s.js" || pathname === "/pk/api/send") {
      return proxyUmami(request, pathname);
    }
    const match = pathname.match(MCP_ROUTE);
    if (match) {
      const ns = env.COPILOT_SESSION;
      return ns.get(ns.idFromName(match[1])).fetch(request);
    }
    return (
      startHandler as { fetch(...args: unknown[]): Promise<Response> }
    ).fetch(request, env, ctx);
  },
};
