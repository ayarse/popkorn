import referenceMd from "../../../../.claude/skills/creating-popcorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popcorn-animations/SKILL.md?raw";

export type Role = "user" | "agent";

export type Message = {
  id: number;
  role: Role;
  text: string;
  parseError?: string;
  applied?: boolean;
};

export type AgentConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = "popcorn.agent.config";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "anthropic/claude-opus-4.8";

export const MODEL_PRESETS = [
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.5",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "minimax/m3",
  "xiaomi/mimo-v2.5",
];

export const SYSTEM_PROMPT = [
  "You are Popcorn Copilot, embedded in the Popcorn demo editor. Popcorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Output contract:",
  "- For a NEW animation or a full rewrite, reply with exactly ONE fenced ```css block containing the COMPLETE scene. It replaces the entire editor contents.",
  "- For a MODIFICATION to the existing scene, do NOT resend the whole scene. Instead reply with one or more fenced ```edit blocks, each an exact search/replace in this form:",
  "  ```edit",
  "  <<<<<<<",
  "  [text copied verbatim from the current scene]",
  "  =======",
  "  [replacement text]",
  "  >>>>>>>",
  "  ```",
  "  The search text (between <<<<<<< and =======) must match the current scene character-for-character, including whitespace and indentation, and must be unique in the scene. Keep it minimal — just enough lines to be unique. Never emit the whole scene for a small change. To delete, leave the replacement empty.",
  "- Prose: at most one or two short sentences before the block(s). For a pure question that changes nothing, reply with prose only and no blocks.",
  "",
  "The following is your authoritative knowledge of the Popcorn language. Follow it exactly.",
  "",
  "=== SKILL.md ===",
  skillMd,
  "",
  "=== reference.md ===",
  referenceMd,
].join("\n");

export const GREETING: Message = {
  id: 0,
  role: "agent",
  text: "I'm your Popcorn Copilot. Describe a new animation and I'll build it from scratch, or ask for a change and I'll edit the live scene. Questions about the DSL welcome too.",
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
    };
  } catch {
    return null;
  }
}

export function saveConfig(cfg: AgentConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function wrapScene(source: string, request: string): string {
  return `Current scene:\n\`\`\`css\n${source}\n\`\`\`\n\nRequest: ${request}`;
}

export function extractCss(text: string): string | null {
  const re = /```css\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    last = match[1];
  }
  return last ? last.trim() : null;
}

export async function streamLLM(
  cfg: AgentConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onToken: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.slice(0, 200)}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
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
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // keepalive or partial frame — ignore
      }
    }
  }
  return full;
}
