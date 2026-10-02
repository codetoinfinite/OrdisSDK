import { z } from "@hono/zod-openapi";
import { AgentServerRefSchema } from "../catalog/catalog-schema";

/** Servers an ad-hoc chat (no agentKey) may use. */
export const MAX_ADHOC_SERVERS = 3;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

export const AgentChatRequestSchema = z
  .object({
    agentKey: z.string().min(1).optional().openapi({
      description: "Key of a catalog agent; its servers, prompt and model are used",
      example: "everything-tester",
    }),
    servers: z
      .array(AgentServerRefSchema)
      .min(1)
      .max(MAX_ADHOC_SERVERS)
      .refine((refs) => new Set(refs.map((r) => r.server)).size === refs.length, {
        message: "each server may be listed only once",
      })
      .optional()
      .openapi({
        description: "Ad-hoc chat without agentKey: servers and optional tool allow-lists",
      }),
    messages: z
      .array(ChatMessageSchema)
      .min(1)
      .max(50)
      .openapi({
        description: "Conversation so far, oldest first",
        example: [{ role: "user", content: "Add 2 and 3" }],
      }),
    envs: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional()
      .openapi({ description: "Env vars by server registry key, passed to that server's tools" }),
    model: z.string().min(1).max(100).optional().openapi({
      description: "OpenRouter model id; an agent's own model takes precedence",
    }),
  })
  .refine((request) => request.agentKey || request.servers?.length, {
    message: "Provide agentKey or servers",
  })
  .openapi("AgentChatRequest");
