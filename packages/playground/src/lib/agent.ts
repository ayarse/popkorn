import referenceMd from "../../../../.claude/skills/creating-popkorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popkorn-animations/SKILL.md?raw";

export type Role = "user" | "agent";

export type Message = {
  id: number;
  role: Role;
  text: string;
  // Compact activity log rendered inside the agent bubble; `ok: false` = a
  // rejected/failed tool result.
  toolEvents?: { label: string; ok: boolean }[];
  // Set on an agent message whose run changed the scene: the snapshot to
  // restore via the Revert button.
  revertTo?: string;
  // True while reasoning deltas are streaming and no answer/tool activity has
  // arrived yet — drives the quiet "thinking…" indicator. Not the reasoning
  // text itself; that's never stored or rendered.
  reasoning?: boolean;
};

export type ReasoningEffort = "off" | "low" | "medium" | "high";

export type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  // OpenRouter's unified reasoning knob; absent = model default. "off"
  // disables reasoning; low/medium/high sets effort (enables thinking for
  // Anthropic models, which is the intended user-facing behavior).
  reasoning?: ReasoningEffort;
};

const STORAGE_KEY = "popkorn.agent.config";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

export const MODEL_PRESETS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.5",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "minimax/m3",
  "xiaomi/mimo-v2.5",
];

// The skill docs double as the repo's Claude skill, so they carry repo-only
// asides (source-file pointers, `examples/` paths) fenced in HTML comments.
// Strip those before they reach the copilot — it can't open repo files, and the
// strip runs once at module scope so the prompt stays byte-stable per session
// (preserving the Anthropic prompt-cache breakpoint).
const stripRepoOnly = (s: string): string =>
  s.replace(/<!-- repo-only -->[\s\S]*?<!-- \/repo-only -->/g, "");

export const SYSTEM_PROMPT = [
  "You are Popkorn Copilot, embedded in the Popkorn demo editor. Popkorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Output contract:",
  "- You edit the live scene with tools, not fenced blocks. You are embedded in the editor and for context you receive a scene outline (or, for a small scene, its full source).",
  "- Inspect before you edit: use get_outline, read_rules, read_lines, and search to read the parts of the scene you need. Don't guess at source you haven't seen.",
  "- For a brand-new scene, consider read_example first to match house style — the gallery scenes are idiomatic Popkorn to model.",
  "- Make surgical apply_edit calls — an exact, unique, minimal search string paired with its replacement — rather than rewriting large spans. Keep the search text just long enough to be unique.",
  "- To change every occurrence of a repeated literal (e.g. a color across a palette swap), use apply_edit with replace_all instead of many single edits; check the outline's Palette section first when recoloring.",
  "- When replacing a shape, read its current geometry first and draw the replacement to occupy the same local bounds — same footprint, same coordinate frame. Keep transform, transform-origin, and every animation-* property untouched.",
  "- Never modify @keyframes unless the request is explicitly about motion — the existing animation pivots and distances depend on the old shape's bounds.",
  "- Use rewrite_scene only for a brand-new scene or a full rewrite, never for a small change.",
  "- A rejected edit returns the reason (non-unique match, parse error) as the tool result — fix it and retry.",
  "- Finish with one or two short sentences summarizing what changed. A pure question that changes nothing needs no tools — just answer.",
  "",
  "The following is your authoritative knowledge of the Popkorn language. Follow it exactly.",
  "",
  "=== SKILL.md ===",
  stripRepoOnly(skillMd),
  "",
  "=== reference.md ===",
  stripRepoOnly(referenceMd),
].join("\n");

export const GREETING: Message = {
  id: 0,
  role: "agent",
  text: "I'm your Popkorn Copilot. Describe a new animation and I'll build it from scratch, or ask for a change and I'll edit the live scene. Questions about the DSL welcome too.",
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
      // Absent in old stored configs stays absent (model default).
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
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
}

export type ToolEvent = {
  name: string;
  args: Record<string, unknown>;
  result: string;
};

type ChatMessage = Record<string, unknown>;

type ToolCallAccum = { id: string; name: string; args: string };

const MAX_ITERATIONS = 12;

// Anthropic models get a prompt-cache breakpoint on the system message; the
// content-array form is what OpenRouter passes through to Anthropic.
function prepareMessages(
  cfg: AgentConfig,
  messages: { role: string; content: string }[],
): ChatMessage[] {
  const cache = cfg.model.startsWith("anthropic/");
  return messages.map((m) =>
    cache && m.role === "system"
      ? {
          role: "system",
          content: [
            {
              type: "text",
              text: m.content,
              cache_control: { type: "ephemeral" },
            },
          ],
        }
      : { role: m.role, content: m.content },
  );
}

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
  // Omitted entirely when unset so the model's default applies.
  const reasoning =
    cfg.reasoning === "off"
      ? { enabled: false }
      : cfg.reasoning
        ? { effort: cfg.reasoning }
        : undefined;
  const running: ChatMessage[] = prepareMessages(cfg, messages);
  let finalText = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (opts.signal.aborted) break;
    // Final iteration forces a text answer so the loop always terminates.
    const toolChoice = iter === MAX_ITERATIONS - 1 ? "none" : "auto";

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${res.status}: ${err.slice(0, 200)}`);
    }

    let text = "";
    const calls: ToolCallAccum[] = [];
    await readSSE(res.body!, (data) => {
      if (data === "[DONE]") return;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        return; // keepalive or partial frame
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
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const c of toolCalls) {
      let result: string;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.args);
      } catch (e) {
        result = `Invalid tool arguments: ${(e as Error).message}`;
        opts.onToolEvent({ name: c.name, args: {}, result });
        running.push({ role: "tool", tool_call_id: c.id, content: result });
        continue;
      }
      result = opts.executeTool(c.name, args);
      opts.onToolEvent({ name: c.name, args, result });
      running.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }

  return finalText;
}
