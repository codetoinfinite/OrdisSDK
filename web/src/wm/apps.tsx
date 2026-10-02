import type { ComponentType } from "react";
import { AboutPage } from "../pages/About";
import { AgentPage } from "../pages/Agent";
import { DocsPage } from "../pages/Docs";
import { Explore } from "../pages/Explore";
import { Home } from "../pages/Home";
import { NotFound } from "../pages/NotFound";
import { PlaygroundPage } from "../pages/Playground";
import { ServerPage } from "../pages/Server";
import { SettingsPage } from "../pages/Settings";
import { StackPage } from "../pages/Stack";
import { StartPage } from "../pages/Start";
import { ToolPage } from "../pages/Tool";
import type { AppId } from "./routes";

/** The page component rendered inside each app's window. */
export const APPS: Record<AppId, ComponentType> = {
  home: Home,
  explore: Explore,
  server: ServerPage,
  tool: ToolPage,
  agent: AgentPage,
  playground: PlaygroundPage,
  stack: StackPage,
  start: StartPage,
  docs: DocsPage,
  settings: SettingsPage,
  about: AboutPage,
  notfound: NotFound,
};
