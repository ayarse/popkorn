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

function reasoningFrames(chunks: string[], field = "reasoning"): string[] {
  return chunks.map((c) =>
    JSON.stringify({ choices: [{ delta: { [field]: c } }] }),
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

  test("iteration cap: 12th request carries an honest-summary nudge", async () => {
    const always = () =>
      sseStream([toolFrame(0, "{}", { id: "loop", name: "search" })]);
    const calls = mockFetch(Array.from({ length: 12 }, always));
    await runAgent(CFG, [{ role: "user", content: "loop" }], {
      ...noopOpts(),
      executeTool: () => "again", // never an error → breaker stays quiet
    });
    const lastMsgs = calls[11].body.messages;
    const nudge = lastMsgs[lastMsgs.length - 1];
    expect(nudge.role).toBe("user");
    expect(nudge.content).toContain("hit the tool-call limit");
  });

  test("repeat-call breaker: identical failing call is not re-executed", async () => {
    const fail = () =>
      sseStream([
        toolFrame(0, '{"search":"x","replace":"y"}', {
          id: "c",
          name: "apply_edit",
        }),
      ]);
    mockFetch([fail(), fail(), sseStream(textFrames(["done"]))]);
    let calls = 0;
    const out = await runAgent(CFG, [{ role: "user", content: "edit" }], {
      ...noopOpts(),
      executeTool: () => {
        calls++;
        return "Search text didn't match, and no similar region was found.";
      },
    });
    expect(calls).toBe(1); // second identical call short-circuited
    expect(out).toBe("done");
  });

  test("repeat-call breaker: a distinct call after a failure still executes", async () => {
    mockFetch([
      sseStream([
        toolFrame(0, '{"search":"x","replace":"y"}', {
          id: "c1",
          name: "apply_edit",
        }),
      ]),
      sseStream([
        toolFrame(0, '{"search":"z","replace":"y"}', {
          id: "c2",
          name: "apply_edit",
        }),
      ]),
      sseStream(textFrames(["done"])),
    ]);
    const seen: string[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "edit" }], {
      ...noopOpts(),
      executeTool: (_name, args) => {
        seen.push(String(args.search));
        return "Search text didn't match, and no similar region was found.";
      },
    });
    expect(seen).toEqual(["x", "z"]);
    expect(out).toBe("done");
  });

  test("repeat-call breaker: identical successful read re-executes", async () => {
    const read = () =>
      sseStream([
        toolFrame(0, '{"start":1,"end":9}', { id: "c", name: "read_lines" }),
      ]);
    mockFetch([read(), read(), sseStream(textFrames(["done"]))]);
    let calls = 0;
    await runAgent(CFG, [{ role: "user", content: "read" }], {
      ...noopOpts(),
      executeTool: () => {
        calls++;
        return "1\t#ball {"; // success (line-numbered), never gated
      },
    });
    expect(calls).toBe(2);
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

  test("reasoning effort sends unified reasoning param", async () => {
    const calls = mockFetch([sseStream(textFrames(["hi"]))]);
    await runAgent(
      { ...CFG, reasoning: "high" },
      [{ role: "user", content: "q" }],
      { ...noopOpts(), executeTool: () => "" },
    );
    expect(calls[0].body.reasoning).toEqual({ effort: "high" });
  });

  test('reasoning "off" disables reasoning', async () => {
    const calls = mockFetch([sseStream(textFrames(["hi"]))]);
    await runAgent(
      { ...CFG, reasoning: "off" },
      [{ role: "user", content: "q" }],
      { ...noopOpts(), executeTool: () => "" },
    );
    expect(calls[0].body.reasoning).toEqual({ enabled: false });
  });

  test("no reasoning key when unset", async () => {
    const calls = mockFetch([sseStream(textFrames(["hi"]))]);
    await runAgent(CFG, [{ role: "user", content: "q" }], {
      ...noopOpts(),
      executeTool: () => "",
    });
    expect("reasoning" in calls[0].body).toBe(false);
  });

  test("delta.reasoning fires onReasoning and stays out of the text", async () => {
    mockFetch([
      sseStream([
        ...reasoningFrames(["let me ", "think"]),
        ...textFrames(["answer"]),
      ]),
    ]);
    const reasoning: string[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "q" }], {
      ...noopOpts(),
      executeTool: () => "",
      onReasoning: (d) => reasoning.push(d),
    });
    expect(reasoning).toEqual(["let me ", "think"]);
    expect(out).toBe("answer");
  });

  test("delta.reasoning_content variant fires onReasoning too", async () => {
    mockFetch([
      sseStream([
        ...reasoningFrames(["hmm"], "reasoning_content"),
        ...textFrames(["answer"]),
      ]),
    ]);
    const reasoning: string[] = [];
    const out = await runAgent(CFG, [{ role: "user", content: "q" }], {
      ...noopOpts(),
      executeTool: () => "",
      onReasoning: (d) => reasoning.push(d),
    });
    expect(reasoning).toEqual(["hmm"]);
    expect(out).toBe("answer");
  });
});
