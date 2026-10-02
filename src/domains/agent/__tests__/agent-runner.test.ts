import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHostingBlacklist } from "../../../shared/utils/blocklist-util";
import { catalogInput } from "../../catalog/__tests__/catalog-fixture";
import { Catalog } from "../../catalog/catalog-repository";
import type { AgentChatRequest, AgentEvent } from "../../catalog/catalog-types";
import {
  type AgentDeps,
  buildToolMap,
  DEFAULT_MODEL,
  NOT_CONFIGURED,
  resolveModel,
  runAgentChat,
  sanitizeToolName,
  toolResultText,
  truncate,
} from "../agent-runner";

describe("agent runner helpers", () => {
  it("makes unique, valid function names", () => {
    expect(sanitizeToolName("s0__read file.v2", new Set())).toBe("s0__read_file_v2");
    expect(sanitizeToolName("", new Set())).toBe("tool");
    expect(sanitizeToolName("x", new Set(["x"]))).toBe("x_2");
    expect(sanitizeToolName("x", new Set(["x", "x_2"]))).toBe("x_3");
    const long = "a".repeat(70);
    expect(sanitizeToolName(long, new Set())).toHaveLength(64);
    const taken = new Set(["a".repeat(64)]);
    expect(sanitizeToolName(long, taken)).toBe(`${"a".repeat(62)}_2`);
  });

  it("prefixes tool names per server and always offers an object schema", () => {
    const map = buildToolMap([
      {
        server: "a/b",
        serverName: "A",
        tools: [{ name: "do.it", inputSchema: { type: "object" } }],
      },
      {
        server: "c",
        serverName: "C",
        tools: [
          {
            name: "do.it",
            description: "Does it",
            inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
          },
        ],
      },
    ]);
    expect([...map.keys()]).toEqual(["s0__do_it", "s1__do_it"]);
    expect(map.get("s0__do_it")).toEqual({
      name: "s0__do_it",
      server: "a/b",
      tool: "do.it",
      definition: {
        type: "function",
        function: {
          name: "s0__do_it",
          description: "[A] do.it",
          parameters: { type: "object", properties: {} },
        },
      },
    });
    expect(map.get("s1__do_it")?.definition.function).toMatchObject({
      description: "[C] Does it",
      parameters: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
    });
  });

  it("truncates long text with a marker", () => {
    expect(truncate("abcdef", 10)).toBe("abcdef");
    const cut = truncate("x".repeat(30), 20);
    expect(cut).toHaveLength(20);
    expect(cut).toBe(`${"x".repeat(7)}… [truncated]`);
  });

  it("turns MCP results into text", () => {
    expect(
      toolResultText({
        content: [
          { type: "text", text: "a" },
          { type: "image", mimeType: "image/png", data: "AAAA" },
          { type: "resource", resource: { uri: "file:///r", text: "r" } },
          { type: "audio" },
        ],
      }),
    ).toBe("a\n[image content (image/png) omitted]\nr\n[audio content omitted]");
    expect(toolResultText({ content: [] })).toBe("(no output)");
    expect(toolResultText("plain")).toBe("plain");
    expect(toolResultText({ ok: 1 })).toBe('{"ok":1}');
  });

  it("prefers the agent's model, then the request's, then OPENROUTER_MODEL", () => {
    expect(resolveModel("a/agent", "b/request", "c/env")).toBe("a/agent");
    expect(resolveModel(undefined, "b/request", "c/env")).toBe("b/request");
    expect(resolveModel(undefined, "", "c/env")).toBe("c/env");
    expect(resolveModel()).toBe(DEFAULT_MODEL);
  });
});

const addTool: Tool = {
  name: "add",
  description: "Add two numbers",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
};
const echoTool: Tool = { name: "echo", inputSchema: { type: "object" } };

type Reply = Record<string, unknown> | Response;

const toolCall = (id: string, name: string, args: unknown) => ({
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

/** Fake deps: the model answers with `replies` in order; `add` sums a and b. */
function setup(replies: Reply[], overrides: Partial<AgentDeps> = {}) {
  const events: AgentEvent[] = [];
  const bodies: { model: string; messages: Record<string, unknown>[]; tools?: unknown[] }[] = [];
  const catalog = new Catalog(catalogInput());
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies.shift() ?? { content: "ok" };
    if (reply instanceof Response) return reply;
    return Response.json({ choices: [{ message: { role: "assistant", ...reply } }] });
  });
  const runTool = vi.fn(async (_server: string, _tool: string, args: Record<string, unknown>) => ({
    content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }],
  }));
  const deps: AgentDeps = {
    apiKey: "test-key",
    getCatalog: async () => catalog,
    listTools: async () => [addTool, echoTool],
    runTool,
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  };
  const run = (request: Partial<AgentChatRequest>, signal = new AbortController().signal) =>
    runAgentChat(
      { messages: [{ role: "user", content: "Add 2 and 3" }], ...request },
      (event) => {
        events.push(event);
      },
      deps,
      signal,
    );
  return { events, bodies, fetchMock, runTool, run };
}

const errorAndDone = (message: string, steps = 0, model = DEFAULT_MODEL) => [
  { event: "error", data: { message } },
  { event: "done", data: { steps, model } },
];

describe("runAgentChat", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("ends with an error when no API key is configured", async () => {
    const { events, fetchMock, run } = setup([], { apiKey: undefined, defaultModel: "env/model" });
    await run({ agentKey: "math-helper" });
    expect(events).toEqual(errorAndDone(NOT_CONFIGURED, 0, "env/model"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs an agent: tool call, tool result, answer", async () => {
    const { events, bodies, fetchMock, runTool, run } = setup([
      { content: "", ...toolCall("call_1", "s0__add", '{"a":2,"b":3}') },
      { content: "2 + 3 = 5" },
    ]);
    await run({
      agentKey: "math-helper",
      messages: [
        { role: "user", content: "  " },
        { role: "user", content: "Add 2 and 3" },
      ],
      envs: { "srv-math": { LOG_LEVEL: "debug" } },
    });

    expect(events).toEqual([
      { event: "status", data: { message: "Loading tools from Math Server" } },
      { event: "status", data: { message: "1 tool(s) ready" } },
      {
        event: "tool_call",
        data: { id: "call_1", server: "srv-math", tool: "add", args: { a: 2, b: 3 } },
      },
      {
        event: "tool_result",
        data: { id: "call_1", ok: true, ms: expect.any(Number), preview: "5" },
      },
      { event: "message", data: { content: "2 + 3 = 5" } },
      { event: "done", data: { steps: 2, model: DEFAULT_MODEL } },
    ]);
    expect(runTool).toHaveBeenCalledWith("srv-math", "add", { a: 2, b: 3 }, { LOG_LEVEL: "debug" });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(bodies[0].model).toBe(DEFAULT_MODEL);
    expect(bodies[0].messages).toEqual([
      { role: "system", content: "Add numbers with the tools." },
      { role: "user", content: "Add 2 and 3" },
    ]);
    expect(bodies[0].tools).toEqual([
      {
        type: "function",
        function: {
          name: "s0__add",
          description: "[Math Server] Add two numbers",
          parameters: addTool.inputSchema,
        },
      },
    ]);
    expect(bodies[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "5",
    });
  });

  it("runs ad-hoc servers with every tool and the request's model", async () => {
    const { events, bodies, run } = setup([{ content: "Hi" }], { defaultModel: "env/model" });
    await run({ servers: [{ server: "srv-math" }], model: "request/model" });
    expect(events.map((e) => e.event)).toEqual(["status", "status", "message", "done"]);
    expect(events[1]).toEqual({ event: "status", data: { message: "2 tool(s) ready" } });
    expect(events.at(-1)).toEqual({ event: "done", data: { steps: 1, model: "request/model" } });
    expect(bodies[0].model).toBe("request/model");
    expect(bodies[0].tools).toHaveLength(2);
  });

  it("reports allowed tools the server does not offer and answers without tools", async () => {
    const { events, bodies, run } = setup([{ content: "Cannot add" }], {
      listTools: async () => [echoTool],
    });
    await run({ agentKey: "math-helper" });
    expect(events.slice(1, 3)).toEqual([
      { event: "status", data: { message: "'srv-math' does not offer: add" } },
      { event: "status", data: { message: "No tools available; answering without tools" } },
    ]);
    expect(bodies[0]).not.toHaveProperty("tools");
  });

  it("refuses blocked servers before loading tools", async () => {
    const [blacklisted] = await loadHostingBlacklist();
    for (const server of ["srv-blocked", blacklisted]) {
      const { events, fetchMock, run } = setup([], { listTools: vi.fn() });
      await run({ servers: [{ server }] });
      expect(events).toEqual(errorAndDone(`Server '${server}' is blocked (hosting blacklist)`));
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("refuses unknown servers and agents", async () => {
    const cases: [Partial<AgentChatRequest>, string][] = [
      [{ agentKey: "broken-agent" }, "Server 'srv-nope' is not in the registry"],
      [{ servers: [{ server: "srv-nope" }] }, "Server 'srv-nope' is not in the registry"],
      [{ agentKey: "nope" }, "Agent 'nope' not found"],
      [{}, "Provide agentKey or servers"],
      [
        { agentKey: "math-helper", messages: [{ role: "user", content: " " }] },
        "Send a message first",
      ],
    ];
    for (const [request, message] of cases) {
      const { events, run } = setup([]);
      await run(request);
      expect(events).toEqual(errorAndDone(message));
    }
  });

  it("reports unknown tools, bad arguments and failing tools back to the model", async () => {
    const { events, bodies, run } = setup([
      toolCall("c1", "s9__nope", "{}"),
      toolCall("c2", "s0__add", "{not json"),
      toolCall("c3", "s0__add", "[1]"),
    ]);
    const { events: failed, run: runFailing } = setup([toolCall("c4", "s0__add", { a: 1, b: 1 })], {
      runTool: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await run({ agentKey: "math-helper" });
    await runFailing({ agentKey: "math-helper" });

    const results = events.filter((e) => e.event === "tool_result").map((e) => e.data);
    expect(results.map((r) => ("ok" in r ? r.ok : null))).toEqual([false, false, false]);
    expect(results.map((r) => ("preview" in r ? r.preview : null))).toEqual([
      "Unknown tool 's9__nope'",
      expect.stringMatching(/^Invalid tool arguments: /),
      "Invalid tool arguments: arguments must be a JSON object",
    ]);
    expect(events.find((e) => e.event === "tool_call")?.data).toEqual({
      id: "c1",
      server: "",
      tool: "s9__nope",
      args: {},
    });
    expect(events.filter((e) => e.event === "tool_call")[1].data).toMatchObject({
      args: "{not json",
    });
    expect(bodies[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: "Unknown tool 's9__nope'",
    });
    expect(failed.find((e) => e.event === "tool_result")?.data).toMatchObject({
      ok: false,
      preview: "Tool failed: boom",
    });
  });

  it("marks isError results as failed", async () => {
    const { events, run } = setup([toolCall("c1", "s0__add", "{}")], {
      runTool: async () => ({ content: [{ type: "text", text: "bad input" }], isError: true }),
    });
    await run({ agentKey: "math-helper" });
    expect(events.find((e) => e.event === "tool_result")?.data).toMatchObject({
      ok: false,
      preview: "bad input",
    });
  });

  it("stops at the agent's step limit", async () => {
    const call = () => toolCall("c", "s0__add", '{"a":1,"b":1}');
    const { events, fetchMock, run } = setup([call(), call(), call(), call()]);
    await run({ agentKey: "math-helper" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.slice(-2)).toEqual([
      { event: "status", data: { message: "Stopped after 3 steps (step limit)" } },
      { event: "done", data: { steps: 3, model: DEFAULT_MODEL } },
    ]);
  });

  it("reports model failures", async () => {
    const cases: [Response, string][] = [
      [
        Response.json({ error: { message: "No auth" } }, { status: 401 }),
        "Model request failed (401): No auth",
      ],
      [Response.json({ choices: [] }), "Model returned no message"],
      [
        new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
        "Model request failed (502): Bad Gateway",
      ],
    ];
    for (const [response, message] of cases) {
      const { events, run } = setup([response]);
      await run({ agentKey: "math-helper" });
      expect(events.slice(-2)).toEqual(errorAndDone(message, 1));
    }
  });

  it("reports servers whose tools cannot be listed", async () => {
    const { events, run } = setup([], {
      listTools: vi.fn().mockRejectedValue(new Error("spawn failed")),
    });
    await run({ agentKey: "math-helper" });
    expect(events.slice(-2)).toEqual(
      errorAndDone("Could not list tools of 'srv-math': spawn failed"),
    );
  });

  it("goes quiet once the client disconnects", async () => {
    const controller = new AbortController();
    const { events, run } = setup([toolCall("c1", "s0__add", "{}"), { content: "never" }], {
      runTool: async () => {
        controller.abort();
        return { content: [] };
      },
    });
    await run({ agentKey: "math-helper" }, controller.signal);
    expect(events.map((e) => e.event)).toEqual(["status", "status", "tool_call"]);
  });
});
