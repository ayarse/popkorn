import { afterEach, describe, expect, test } from "bun:test";
import { type AgentConfig, runAgent } from "./agent";

const CFG: AgentConfig = {
  baseUrl: "https://example.test/api/v1",
  apiKey: "sk-test",
  model: "openai/gpt-5.5",
};

// Build a mock streaming Response body from raw SSE `data:` frames.
function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function textFrames(chunks: string[]): string[] {
  return chunks.map((c) =>
    JSON.stringify({ choices: [{ delta: { content: c } }] }),
  );
}

// A tool_calls delta frame. `first` carries id + name; later fragments carry
// only the arguments substring.
function toolFrame(
  index: number,
  argChunk: string,
  first?: { id: string; name: string },
): string {
  const tc: Record<string, unknown> = {
    index,
    function: { arguments: argChunk },
  };
  if (first) {
    tc.id = first.id;
    (tc.function as Record<string, unknown>).name = first.name;
  }
  return JSON.stringify({ choices: [{ delta: { tool_calls: [tc] } }] });
}

type Call = { url: string; body: any };

// Install a fetch mock that returns `streams` in order; records every request.
function mockFetch(streams: ReadableStream<Uint8Array>[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    const body = streams[Math.min(i, streams.length - 1)];
    i++;
    return { ok: true, body } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const noopOpts = () => ({
  tools: [{ type: "function", function: { name: "search" } }],
  signal: new AbortController().signal,
  onToken: () => {},
  onToolEvent: () => {},
});

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("runAgent", () => {
  test("plain text reply streams tokens and returns text", async () => {
    mockFetch([sseStream(textFrames(["Hel", "lo ", "world"]))]);
    const tokens: string[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "hi" }], {
      ...noopOpts(),
      executeTool: () => "unused",
      onToken: (d) => tokens.push(d),
    });
    expect(tokens).toEqual(["Hel", "lo ", "world"]);
    expect(out).toBe("Hello world");
  });

  test("single tool call with fragmented arguments", async () => {
    const calls = mockFetch([
      sseStream([
        toolFrame(0, '{"que', { id: "call_1", name: "search" }),
        toolFrame(0, 'ry":"op'),
        toolFrame(0, 'acity"}'),
      ]),
      sseStream(textFrames(["done"])),
    ]);
    const executed: { name: string; args: Record<string, unknown> }[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "find it" }], {
      ...noopOpts(),
      executeTool: (name, args) => {
        executed.push({ name, args });
        return "line 3: opacity: 1;";
      },
    });

    expect(executed).toEqual([{ name: "search", args: { query: "opacity" } }]);
    expect(out).toBe("done");

    // Second request carries the assistant tool_calls turn + the tool result.
    const secondMsgs = calls[1].body.messages;
    const assistant = secondMsgs.find((m: any) => m.role === "assistant");
    expect(assistant.tool_calls[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "search", arguments: '{"query":"opacity"}' },
    });
    const toolMsg = secondMsgs.find((m: any) => m.role === "tool");
    expect(toolMsg).toMatchObject({
      tool_call_id: "call_1",
      content: "line 3: opacity: 1;",
    });
  });

  test("two tool calls in one turn (distinct index)", async () => {
    mockFetch([
      sseStream([
        toolFrame(0, '{"selectors":["#a"]}', { id: "c1", name: "read_rules" }),
        toolFrame(1, '{"start":1,', { id: "c2", name: "read_lines" }),
        toolFrame(1, '"end":9}'),
      ]),
      sseStream(textFrames(["ok"])),
    ]);
    const events: { name: string; args: Record<string, unknown> }[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "read" }], {
      ...noopOpts(),
      executeTool: (name, args) => {
        events.push({ name, args });
        return `${name} ok`;
      },
    });
    expect(events).toEqual([
      { name: "read_rules", args: { selectors: ["#a"] } },
      { name: "read_lines", args: { start: 1, end: 9 } },
    ]);
    expect(out).toBe("ok");
  });

  test("malformed arguments JSON does not invoke executeTool", async () => {
    const calls = mockFetch([
      sseStream([toolFrame(0, "{not json", { id: "bad", name: "search" })]),
      sseStream(textFrames(["recovered"])),
    ]);
    let executed = false;
    const out = await runAgent(CFG, [{ role: "user", content: "x" }], {
      ...noopOpts(),
      executeTool: () => {
        executed = true;
        return "should not run";
      },
    });
    expect(executed).toBe(false);
    expect(out).toBe("recovered");
    const toolMsg = calls[1].body.messages.find((m: any) => m.role === "tool");
    expect(toolMsg.content).toStartWith("Invalid tool arguments:");
  });

  test("iteration cap: 12 requests, 12th forces tool_choice none", async () => {
    // Every response is a tool call → the loop must hit its hard cap.
    const always = () =>
      sseStream([toolFrame(0, "{}", { id: "loop", name: "search" })]);
    const calls = mockFetch(Array.from({ length: 12 }, always));
    await runAgent(CFG, [{ role: "user", content: "loop" }], {
      ...noopOpts(),
      executeTool: () => "again",
    });
    expect(calls).toHaveLength(12);
    expect(calls.slice(0, 11).every((c) => c.body.tool_choice === "auto")).toBe(
      true,
    );
    expect(calls[11].body.tool_choice).toBe("none");
  });

  test("anthropic model sends cache_control system array; others plain string", async () => {
    const sys = { role: "system", content: "system rules" };

    const anthCalls = mockFetch([sseStream(textFrames(["hi"]))]);
    await runAgent(
      { ...CFG, model: "anthropic/claude-opus-4.8" },
      [sys, { role: "user", content: "q" }],
      { ...noopOpts(), executeTool: () => "" },
    );
    expect(anthCalls[0].body.messages[0]).toEqual({
      role: "system",
      content: [
        {
          type: "text",
          text: "system rules",
          cache_control: { type: "ephemeral" },
        },
      ],
    });

    const openCalls = mockFetch([sseStream(textFrames(["hi"]))]);
    await runAgent(CFG, [sys, { role: "user", content: "q" }], {
      ...noopOpts(),
      executeTool: () => "",
    });
    expect(openCalls[0].body.messages[0]).toEqual({
      role: "system",
      content: "system rules",
    });
  });
});
