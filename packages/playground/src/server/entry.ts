import startHandler from "@tanstack/react-start/server-entry";

export { CopilotSession } from "./copilot-session";

// /mcp/<uuid> (agent, http) and /mcp/<uuid>/tab (playground tab, WebSocket).
const MCP_ROUTE = /^\/mcp\/([0-9a-fA-F-]{36})(\/tab)?$/;

type Env = Record<string, unknown> & {
  COPILOT_SESSION: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

export default {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const match = new URL(request.url).pathname.match(MCP_ROUTE);
    if (match) {
      const ns = env.COPILOT_SESSION;
      return ns.get(ns.idFromName(match[1])).fetch(request);
    }
    return (
      startHandler as { fetch(...args: unknown[]): Promise<Response> }
    ).fetch(request, env, ctx);
  },
};
