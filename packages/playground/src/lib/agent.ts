import referenceMd from "../../../../.claude/skills/creating-popkorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popkorn-animations/SKILL.md?raw";
import { isToolError } from "./agent-tools";

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

export const DEFAULT_MODEL = "openai/gpt-5.5";

export const MODEL_PRESETS = [
  "openai/gpt-5.5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-4.6",
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
  "- Creating a new scene from scratch: build in two passes. Pass 1 — rewrite_scene with the STATIC art only: stage, palette (custom --props for repeated colors), every shape placed and painted, no @keyframes yet. Structure for motion up front: anything that will animate its transform gets a wrapper group carrying a static translate for placement, with the shape authored in local coords and its pivot at the origin (keyframes overwrite the whole transform each frame, so placement must not live in the animated channel). Pass 2 — add motion with apply_edit calls: append @keyframes and animation-* declarations onto the static base, a few at a time, so a bad keyframe can't destroy the layout and placement warnings stay meaningful.",
  "- Design original art for the request: choose your own subject, palette, and composition. Never add captions, labels, or title text unless the user asks for text.",
  "- The gallery examples (read_example) are a syntax/capability reference, not templates. Consult one only when unsure how to express a specific feature, and never carry over its content — subject, palette, caption text, or structure.",
  "- Make surgical apply_edit calls — an exact, unique, minimal search string paired with its replacement — rather than rewriting large spans. Keep the search text just long enough to be unique.",
  "- To change every occurrence of a repeated literal (e.g. a color across a palette swap), use apply_edit with replace_all instead of many single edits; check the outline's Palette section first when recoloring.",
  "- Swapping a node's shape type: first find what carries its placement. Geometry props (x/y/cx/cy) are type-gated — silently ignored on a different type — so a rect placed by `x` loses it when it becomes a path. If @keyframes animate the node's `transform`, don't place the replacement via `transform` either (keyframes overwrite the whole transform each frame): wrap it — an outer group holds a static translate for placement, the inner shape authored in local coords with its pivot at the origin carries the animation and a numeric (px) transform-origin.",
  '- Keyword/percent transform-origin resolves to (0,0) on paths and groups (no intrinsic box) — use numeric px there. Keep every animation-* property intact, and check that apply_edit reports no "nodes moved" warning; if it does, your placement broke.',
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
      // Reasoning is off by default; absent stored value falls back to "off".
      reasoning: parsed.reasoning ?? "off",
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
      const key = `${c.name} ${c.args}`;
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
