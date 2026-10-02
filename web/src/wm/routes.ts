import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  CircleAlert,
  Compass,
  Flag,
  FlaskConical,
  House,
  Info,
  Layers,
  Server,
  Settings,
  Wrench,
} from "lucide-react";
import type { Tone } from "../lib/categories";
import type { ItemType } from "../lib/types";

export type AppId =
  | "home"
  | "explore"
  | "server"
  | "tool"
  | "agent"
  | "playground"
  | "stack"
  | "start"
  | "docs"
  | "settings"
  | "about"
  | "notfound";

export type ExploreType = "all" | ItemType;

export interface Route {
  app: AppId;
  /** Page identity: a new key remounts the page and resets the window title. */
  key: string;
  /** pathname + search + hash, as it appears in the address bar. */
  href: string;
  pathname: string;
  search: string;
  params: { id?: string; slug?: string; type?: ExploreType };
}

const EXPLORE_TYPES: Record<string, ExploreType> = {
  explore: "all",
  servers: "mcp",
  tools: "tool",
  agents: "agent",
};

const TYPE_SEGMENT: Record<ItemType, string> = { mcp: "servers", tool: "tools", agent: "agents" };

const SINGLE: AppId[] = ["playground", "stack", "start", "settings", "about"];

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseRoute(href: string): Route {
  const url = new URL(href, "http://alphesdk.local");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const search = url.search;
  const base = { href: pathname + search + url.hash, pathname, search };
  const segs = pathname.split("/").filter(Boolean).map(decode);
  const [head, ...rest] = segs;

  if (!head) return { ...base, app: "home", key: "home", params: {} };
  if (Object.hasOwn(EXPLORE_TYPES, head) && !rest.length) {
    return { ...base, app: "explore", key: "explore", params: { type: EXPLORE_TYPES[head] } };
  }
  if (head === "servers" && rest.length) {
    const id = rest.join("/");
    return { ...base, app: "server", key: `server:${id}`, params: { id } };
  }
  if ((head === "tools" || head === "agents") && rest.length === 1) {
    const app = head === "tools" ? "tool" : "agent";
    return { ...base, app, key: `${app}:${rest[0]}`, params: { id: rest[0] } };
  }
  if (head === "docs" && rest.length <= 1) {
    return { ...base, app: "docs", key: "docs", params: { slug: rest[0] } };
  }
  const single = SINGLE.find((app) => app === head);
  if (single && !rest.length) return { ...base, app: single, key: single, params: {} };
  return { ...base, app: "notfound", key: "notfound", params: {} };
}

/** Encodes each path segment but keeps "@" readable (npm scopes). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%40/g, "@"))
    .join("/");
}

function query(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) sp.set(key, value);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type ServerTab = "overview" | "tools" | "setup";
export type SetupStep = "configure" | "test" | "connect";

export const paths = {
  home: () => "/",
  explore: (opts: { type?: ExploreType; q?: string; category?: string } = {}) =>
    `/${opts.type && opts.type !== "all" ? TYPE_SEGMENT[opts.type] : "explore"}${query({ q: opts.q, category: opts.category })}`,
  server: (packageName: string, opts: { tab?: ServerTab; tool?: string; step?: SetupStep } = {}) =>
    `/servers/${encodePath(packageName)}${query(opts)}`,
  tool: (key: string) => `/tools/${encodeURIComponent(key)}`,
  agent: (key: string) => `/agents/${encodeURIComponent(key)}`,
  playground: (opts: { mode?: "agent"; server?: string; tool?: string; servers?: string } = {}) =>
    `/playground${query(opts)}`,
  docs: (slug?: string) => (slug ? `/docs/${encodeURIComponent(slug)}` : "/docs"),
};

export interface AppMeta {
  title: string;
  icon: LucideIcon;
  tone: Tone | "muted";
  /** Size [width, height] of the app's own window. Apps without one share the main window. */
  window?: [number, number];
}

/** Default size of the main window, where every app without its own window opens. */
export const MAIN_WINDOW: [number, number] = [1140, 800];

export const APP_META: Record<AppId, AppMeta> = {
  home: { title: "Home", icon: House, tone: "orange" },
  explore: { title: "Explore", icon: Compass, tone: "blue" },
  server: { title: "MCP server", icon: Server, tone: "green" },
  tool: { title: "Tool", icon: Wrench, tone: "teal" },
  agent: { title: "Agent", icon: Bot, tone: "purple" },
  /* A workbench beside the catalog: browsing never replaces a running tool or chat. */
  playground: { title: "Playground", icon: FlaskConical, tone: "red", window: [1140, 780] },
  stack: { title: "My stack", icon: Layers, tone: "yellow" },
  start: { title: "Get started", icon: Flag, tone: "orange" },
  docs: { title: "Docs", icon: BookOpen, tone: "blue" },
  /* Utility panels: opening them never replaces the page being worked on. */
  settings: { title: "Settings", icon: Settings, tone: "muted", window: [720, 760] },
  about: { title: "About", icon: Info, tone: "muted", window: [820, 760] },
  notfound: { title: "Not found", icon: CircleAlert, tone: "red" },
};
