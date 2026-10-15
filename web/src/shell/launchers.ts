import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Braces,
  Compass,
  Flag,
  FlaskConical,
  House,
  Info,
  Layers,
  Server,
  Settings,
} from "lucide-react";
import { API_ORIGIN } from "../lib/config";
import type { ToneName } from "../ui/core";
import { paths } from "../wm/routes";

/** An entry point shown on the desktop, in the mobile menu and in the command palette. */
export interface Launcher {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  tone: ToneName;
  /** Opens in a new browser tab instead of an app window. */
  external?: boolean;
}

/** The discover-to-run flow, top to bottom. */
export const LAUNCHERS_LEFT: Launcher[] = [
  { id: "home", label: "Home", href: paths.home(), icon: House, tone: "orange" },
  { id: "explore", label: "Explore", href: paths.explore(), icon: Compass, tone: "blue" },
  {
    id: "servers",
    label: "MCP servers",
    href: paths.explore({ type: "mcp" }),
    icon: Server,
    tone: "green",
  },
  {
    id: "agents",
    label: "Agents",
    href: paths.explore({ type: "agent" }),
    icon: Bot,
    tone: "purple",
  },
  {
    id: "playground",
    label: "Playground",
    href: paths.playground(),
    icon: FlaskConical,
    tone: "red",
  },
  { id: "docs", label: "Docs", href: paths.docs(), icon: BookOpen, tone: "blue" },
];

export const LAUNCHERS_RIGHT: Launcher[] = [
  { id: "stack", label: "My stack", href: "/stack", icon: Layers, tone: "yellow" },
  { id: "start", label: "Get started", href: "/start", icon: Flag, tone: "orange" },
  {
    id: "api",
    label: "API reference",
    href: `${API_ORIGIN}/swagger`,
    icon: Braces,
    tone: "teal",
    external: true,
  },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings, tone: "muted" },
  { id: "about", label: "About", href: "/about", icon: Info, tone: "muted" },
];

export const LAUNCHERS: Launcher[] = [...LAUNCHERS_LEFT, ...LAUNCHERS_RIGHT];

export function openExternal(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
