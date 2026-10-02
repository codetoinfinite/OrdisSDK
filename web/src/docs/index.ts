import {
  Bot,
  Braces,
  Flag,
  KeyRound,
  type LucideIcon,
  Plug,
  Server,
  SquarePlus,
} from "lucide-react";
import addToCatalog from "./add-to-catalog.md?raw";
import agents from "./agents.md?raw";
import connectClients from "./connect-clients.md?raw";
import keys from "./keys.md?raw";
import quickstart from "./quickstart.md?raw";
import restApi from "./rest-api.md?raw";
import servers from "./servers.md?raw";

/*
 * Each page is a markdown file that opens with a lead paragraph and uses `#` for its sections,
 * which become the "On this page" entries. Titles and summaries live here, not in the files.
 * `{{origin}}` stands for the address this app is served from.
 */

export interface Doc {
  slug: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  source: string;
}

export const DOCS: Doc[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    summary: "Run AlpheSDK and go from finding a server to a working connection.",
    icon: Flag,
    source: quickstart,
  },
  {
    slug: "connect-clients",
    title: "Connect an MCP client",
    summary: "Point Claude Code, Cursor, VS Code or Claude Desktop at the gateway.",
    icon: Plug,
    source: connectClients,
  },
  {
    slug: "keys",
    title: "Keys and privacy",
    summary: "Where your API keys are kept and when they leave the browser.",
    icon: KeyRound,
    source: keys,
  },
  {
    slug: "rest-api",
    title: "REST API",
    summary: "Search the catalog and run tools over plain HTTP.",
    icon: Braces,
    source: restApi,
  },
  {
    slug: "agents",
    title: "Agent chat",
    summary: "Stream a conversation with an agent that calls MCP tools.",
    icon: Bot,
    source: agents,
  },
  {
    slug: "add-to-catalog",
    title: "Add tools and agents",
    summary: "Curate a tool or build an agent with one JSON file.",
    icon: SquarePlus,
    source: addToCatalog,
  },
  {
    slug: "servers",
    title: "How servers run",
    summary: "What the labels mean, where servers run and what gets blocked.",
    icon: Server,
    source: servers,
  },
];

export function findDoc(slug: string | undefined): Doc | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}
