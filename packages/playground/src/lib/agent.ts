import { isToolError } from "./agent-defs";

export { SYSTEM_PROMPT } from "./agent-defs";

export type Role = "user" | "agent";

export type Message = {
  id: number;
  role: Role;
  text: string;
  // Creation time (ms epoch), for interleaving with own-agent tool events.
  at: number;
  // Compact activity log rendered inside the agent bubble; `ok: false` = a
  // rejected/failed tool result.
  toolEvents?: { label: string; ok: boolean }[];
  // Set on an agent message whose run changed the scene: the snapshot to
  // restore via the Revert button.
  revertTo?: string;
};

export type ReasoningEffort = "default" | "off" | "low" | "medium" | "high";

export type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  // OpenRouter's unified reasoning knob; "default"/absent = model default.
  // "off" disables reasoning; low/medium/high sets effort (enables thinking
  // for Anthropic models, which is the intended user-facing behavior).
  reasoning?: ReasoningEffort;
};

const STORAGE_KEY = "popkorn.agent.config";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "anthropic/claude-opus-5.5";

export const MODEL_PRESETS = [
  "anthropic/claude-opus-5.5",
  "openai/gpt-5.6-sol",
  "anthropic/claude-fable-5.1",
  "anthropic/claude-sonnet-5",
  "google/gemini-3.8-flash",
  "x-ai/grok-4.7",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.3",
  "z-ai/glm-5.3-flash",
  "deepseek/deepseek-v4-pro-0813",
  "deepseek/deepseek-v4.1-flash",
];

export const GREETING: Message = {
  id: 0,
  role: "agent",
  at: 0,
  text: "I'm your Popkorn Copilot. Describe a new animation and I'll build it from scratch, or ask for a change and I'll edit the live scene. Questions about the Popkorn format welcome too.",
};

export const SUGGESTIONS = [
  "Create a solar system animation from scratch",
  "Make the ball bounce twice as fast",
  "Change the palette to warm colors",
];

export function loadConfig(): AgentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (!parsed.apiKey || !parsed.baseUrl) return null;
    return {
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      model: parsed.model ?? DEFAULT_MODEL,
      reasoning: parsed.reasoning ?? "default",
    };
  } catch {
    return null;
  }
}

export function saveConfig(cfg: AgentConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// Shared line-buffered SSE reader: invokes onData with each `data:` payload
// (still trimmed, "[DONE]" and keepalives included) until the stream ends.
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        onData(trimmed.slice(5).trim());
      }
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
}

export type ToolEvent = {
  name: string;
  args: Record<string, unknown>;
  result: string;
};

// A compact human label for a tool call, shown as a status row in the bubble.
export function toolLabel(ev: ToolEvent): string {
  switch (ev.name) {
    case "get_outline":
      return "outline";
    case "read_rules": {
      const sel = ev.args.selectors;
      return Array.isArray(sel) ? `read ${sel.join(", ")}` : "read rules";
    }
    case "read_lines":
      return `read lines ${ev.args.start}–${ev.args.end}`;
    case "search":
      return `searched ${JSON.stringify(ev.args.query)}`;
    case "read_docs": {
      const sec = ev.args.sections;
      return Array.isArray(sec) && sec.length
        ? `read docs §${sec.map((s) => String(s).replace(/^§/, "")).join(", §")}`
        : "read guide";
    }
    case "read_example":
      return ev.args.name ? `read example ${ev.args.name}` : "listed examples";
    case "apply_edit":
      return "edited scene";
    case "rewrite_scene":
      return "rewrote scene";
    case "render_frames": {
      const t = ev.args.times;
      return Array.isArray(t)
        ? `rendered ${t.length} frames`
        : "rendered frames";
    }
    default:
      return ev.name;
  }
}

type ChatMessage = Record<string, unknown>;

type ToolCallAccum = { id: string; name: string; args: string };

const MAX_ITERATIONS = 12;

// One id per page load: OpenRouter pins a session's requests to the provider
// endpoint that holds its prompt cache, across runs as well as loop turns.
const SESSION_ID = crypto.randomUUID();

// Provider-specific caching knobs. Anthropic caches only with a breakpoint; the
// top-level form advances it to the last block each turn, so the loop re-reads
// its own growing tool history from cache too. OpenAI/DeepSeek/Gemini prefix-
// cache automatically; `session_id` keeps them on the same warm endpoint.
function cacheParams(cfg: AgentConfig): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (cfg.model.startsWith("anthropic/")) {
    params.cache_control = { type: "ephemeral" };
  }
  if (cfg.baseUrl.includes("openrouter.ai")) params.session_id = SESSION_ID;
  return params;
}

// Thinking can't be disabled on these; "off" falls back to the lowest effort.
const ALWAYS_THINKS = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-fable-5.1",
];

export async function runAgent(
  cfg: AgentConfig,
  messages: { role: string; content: string }[],
  opts: {
    tools: unknown[];
    executeTool: (name: string, args: Record<string, unknown>) => string;
    signal: AbortSignal;
    onToken: (delta: string) => void;
    onToolEvent: (ev: ToolEvent) => void;
    onReasoning?: (delta: string) => void;
  },
): Promise<string> {
  // Maps AgentConfig.reasoning → OpenRouter's unified `reasoning` param.
  // Omitted entirely for the model default.
  const reasoning =
    cfg.reasoning === "off"
      ? ALWAYS_THINKS.includes(cfg.model)
        ? { effort: "low" }
        : { enabled: false }
      : cfg.reasoning && cfg.reasoning !== "default"
        ? { effort: cfg.reasoning }
        : undefined;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const running: ChatMessage[] = messages.map((m) => ({ ...m }));
  let finalText = "";
  // Keys (name + raw JSON args) of tool calls that already FAILED this run, so
  // an identical retry is short-circuited instead of blindly re-executed.
  const failedCalls = new Set<string>();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (opts.signal.aborted) break;
    // Final iteration forces a text answer so the loop always terminates.
    const toolChoice = iter === MAX_ITERATIONS - 1 ? "none" : "auto";
    // …and tells the model to summarize honestly rather than overclaim success.
    if (iter === MAX_ITERATIONS - 1) {
      running.push({
        role: "user",
        content:
          "You've hit the tool-call limit for this run. Summarize honestly: state exactly what was and wasn't completed.",
      });
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: running,
        stream: true,
        tools: opts.tools,
        tool_choice: toolChoice,
        ...(reasoning ? { reasoning } : {}),
        ...cacheParams(cfg),
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${res.status}: ${err.slice(0, 200)}`);
    }

    let text = "";
    const calls: ToolCallAccum[] = [];
    // Echoed back with the tool calls; the provider needs the model's own reasoning.
    const reasoningDetails: unknown[] = [];
    await readSSE(res.body!, (data) => {
      if (data === "[DONE]") return;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        return; // keepalive or partial frame
      }
      if (parsed.error) {
        throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
      }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        text += delta.content;
        opts.onToken(delta.content);
      }
      // Streamed reasoning: surface it so a reasoning-by-default model doesn't
      // look stalled. Providers split on the field name; first non-empty wins.
      // Never appended to the answer text.
      const reasoningDelta = delta.reasoning || delta.reasoning_content;
      if (reasoningDelta) opts.onReasoning?.(reasoningDelta);
      if (delta.reasoning_details)
        reasoningDetails.push(...delta.reasoning_details);
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          calls[i] ??= { id: "", name: "", args: "" };
          const acc = calls[i];
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }
    });

    finalText = text;
    const toolCalls = calls.filter(Boolean);
    if (toolCalls.length === 0) return text;

    running.push({
      role: "assistant",
      content: text || null,
      ...(reasoningDetails.length
        ? { reasoning_details: reasoningDetails }
        : {}),
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const c of toolCalls) {
      const key = `${c.name} ${c.args}`;
      // Repeat-call breaker: an identical call that already failed won't fail
      // differently — don't re-run it; tell the model to change approach.
      if (failedCalls.has(key)) {
        const result =
          "You already tried this exact call and it failed with the same error. Do not repeat it. Read the actual source first (read_rules/read_lines) and construct a different edit.";
        opts.onToolEvent({ name: c.name, args: {}, result });
        running.push({ role: "tool", tool_call_id: c.id, content: result });
        continue;
      }
      let result: string;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.args);
      } catch (e) {
        result = `Invalid tool arguments: ${(e as Error).message}`;
        failedCalls.add(key);
        opts.onToolEvent({ name: c.name, args: {}, result });
        running.push({ role: "tool", tool_call_id: c.id, content: result });
        continue;
      }
      result = opts.executeTool(c.name, args);
      if (isToolError(result)) failedCalls.add(key);
      opts.onToolEvent({ name: c.name, args, result });
      running.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }

  return finalText;
}
