import { paths } from "../wm/routes";
import { STARTER_AGENT, STARTER_SERVER } from "./config";
import type { StepKey } from "./state";

export interface FlowStep {
  key: StepKey;
  label: string;
  /** What the step asks the user to do. */
  text: string;
  /** Where to do it; the starter server needs only the AlpheSDK API key. */
  href: string;
  action: string;
}

/** Discover → Inspect → Configure → Test → Connect → Run (docs/ALPHESDK-PLAN.md §2). */
export const FLOW: FlowStep[] = [
  {
    key: "discover",
    label: "Discover",
    text: "Search the catalog for a server or agent that does what you need.",
    href: paths.explore(),
    action: "Open Explore",
  },
  {
    key: "inspect",
    label: "Inspect",
    text: "Open a server to read its tools, runtime and the keys it asks for.",
    href: paths.server(STARTER_SERVER),
    action: "Inspect a server",
  },
  {
    key: "configure",
    label: "Configure",
    text: "Enter your AlpheSDK API key, plus any keys the server needs. They stay in this browser unless you connect a client.",
    href: paths.server(STARTER_SERVER, { tab: "setup", step: "configure" }),
    action: "Configure",
  },
  {
    key: "test",
    label: "Test",
    text: "Run one of its tools right here and check the output.",
    href: paths.server(STARTER_SERVER, { tab: "tools", tool: "add" }),
    action: "Run a tool",
  },
  {
    key: "connect",
    label: "Connect",
    text: "Copy a ready config for Claude Code, Cursor, VS Code or Claude Desktop.",
    href: paths.server(STARTER_SERVER, { tab: "setup", step: "connect" }),
    action: "Get a config",
  },
  {
    key: "run",
    label: "Run",
    text: "Chat with an agent that calls tools for you, and watch each call.",
    href: paths.agent(STARTER_AGENT),
    action: "Chat with an agent",
  },
];
