import { OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { ErrorResponseSchema } from "../../shared/schemas";
import { createErrorResponse, formatZodIssues } from "../../shared/utils/response-util";
import { getCatalog } from "../catalog/catalog-repository";
import { getPackageTools, runPackageTool } from "../package/package-handler";
import { type AgentDeps, runAgentChat } from "./agent-runner";
import { AgentChatRequestSchema } from "./agent-schema";

export const agentRoutes = new OpenAPIHono();

const deps = (): AgentDeps => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultModel: process.env.OPENROUTER_MODEL,
  getCatalog,
  listTools: (server) => getPackageTools(server),
  runTool: (server, tool, args, envs) => runPackageTool(server, tool, args, envs),
});

// Streamed, so it is documented by hand instead of through createRoute.
agentRoutes.openAPIRegistry.registerPath({
  method: "post",
  path: "/chat",
  summary: "Chat with an agent (Server-Sent Events)",
  description:
    "Streams events named status, tool_call, tool_result, message, error and done; each data " +
    "line is JSON. Every accepted chat ends with done. An invalid body gets the JSON envelope " +
    "instead of a stream.",
  request: {
    body: { content: { "application/json": { schema: AgentChatRequestSchema } }, required: true },
  },
  responses: {
    200: {
      description: "text/event-stream of AgentEvents, or the error envelope for an invalid body",
      content: {
        "text/event-stream": { schema: z.string() },
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

agentRoutes.post("/chat", async (c) => {
  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return c.json(createErrorResponse("Request body must be JSON", 400), 200);
  }
  const parsed = AgentChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(createErrorResponse(`Invalid body: ${formatZodIssues(parsed.error)}`, 400), 200);
  }

  return streamSSE(c, async (stream) => {
    // Stop the upstream model call when the client goes away (request aborted or stream cancelled).
    const cancelled = new AbortController();
    stream.onAbort(() => cancelled.abort());
    const signal = AbortSignal.any([c.req.raw.signal, cancelled.signal]);
    await runAgentChat(
      parsed.data,
      (event) => stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) }),
      deps(),
      signal,
    );
  });
});
