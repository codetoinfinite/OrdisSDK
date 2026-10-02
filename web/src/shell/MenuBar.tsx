import {
  Braces,
  ChevronDown,
  Flag,
  FlaskConical,
  Info,
  Layers,
  Menu as MenuIcon,
  Moon,
  Search,
  Settings,
  SquarePlus,
  Sun,
  X,
} from "lucide-react";
import { useState } from "react";
import { API_ORIGIN, MOD_LABEL } from "../lib/config";
import { cx } from "../lib/format";
import { toggleTheme, useIsDark } from "../lib/settings";
import { openPalette } from "../lib/state";
import { useModalDialog } from "../lib/useModalDialog";
import { ButtonLink, IconButton, Kbd } from "../ui/core";
import { Menu, type MenuEntry } from "../ui/Menu";
import { ExternalA, Link } from "../wm/Link";
import { paths, type Route } from "../wm/routes";
import { useWm, useWmState } from "../wm/WindowManager";
import { Logo } from "./Logo";
import { LAUNCHERS } from "./launchers";
import { WindowSwitcher } from "./WindowSwitcher";

interface NavItem {
  label: string;
  href: string;
  /** Hidden on narrower screens (still on the desktop and in the palette). */
  optional?: boolean;
  match(route: Route): boolean;
}

const isExplore = (route: Route, type: string) =>
  route.app === "explore" && (route.params.type ?? "all") === type;

const NAV: NavItem[] = [
  { label: "Explore", href: paths.explore(), match: (r) => isExplore(r, "all") },
  {
    label: "Servers",
    href: paths.explore({ type: "mcp" }),
    match: (r) => isExplore(r, "mcp") || r.app === "server",
  },
  {
    label: "Tools",
    href: paths.explore({ type: "tool" }),
    match: (r) => isExplore(r, "tool") || r.app === "tool",
  },
  {
    label: "Agents",
    href: paths.explore({ type: "agent" }),
    match: (r) => isExplore(r, "agent") || r.app === "agent",
  },
  {
    label: "Playground",
    href: paths.playground(),
    optional: true,
    match: (r) => r.app === "playground",
  },
  { label: "Docs", href: paths.docs(), optional: true, match: (r) => r.app === "docs" },
];

function Brand({ size }: { size?: number }) {
  return (
    <>
      <Logo size={size} />
      <span>
        Alphe<span className="brand-sdk">SDK</span>
      </span>
    </>
  );
}

export function MenuBar() {
  const wm = useWm();
  const { wins, focusId } = useWmState();
  const route = wins.find((win) => win.id === focusId && !win.minimized)?.route;
  const dark = useIsDark();

  const more: MenuEntry[] = [
    {
      key: "playground",
      label: "Playground",
      icon: FlaskConical,
      onSelect: () => wm.open(paths.playground()),
    },
    { key: "stack", label: "My stack", icon: Layers, onSelect: () => wm.open("/stack") },
    { key: "start", label: "Get started", icon: Flag, onSelect: () => wm.open("/start") },
    { type: "separator", key: "sep" },
    { key: "api", label: "API reference", icon: Braces, href: `${API_ORIGIN}/swagger` },
    {
      key: "add",
      label: "Add to catalog",
      icon: SquarePlus,
      onSelect: () => wm.open(paths.docs("add-to-catalog")),
    },
    { key: "settings", label: "Settings", icon: Settings, onSelect: () => wm.open("/settings") },
    { key: "about", label: "About", icon: Info, onSelect: () => wm.open("/about") },
  ];

  return (
    <header className="menubar">
      <Link className="brand" href={paths.home()}>
        <Brand />
      </Link>
      <nav className="menubar-nav" aria-label="Main">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cx("menubar-link", item.optional && "is-optional")}
            aria-current={route && item.match(route) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
        <Menu
          label="More"
          text={
            <>
              More <ChevronDown size={14} />
            </>
          }
          triggerClassName="menubar-link"
          align="start"
          items={more}
        />
      </nav>
      <div className="menubar-spacer" />
      <button
        type="button"
        className="menubar-search"
        onClick={openPalette}
        aria-label="Search servers, tools and agents"
      >
        <Search size={16} />
        <span className="menubar-search-label">Search servers, tools, agents</span>
        <span className="kbd-group">
          <Kbd>{MOD_LABEL}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="menubar-actions">
        <IconButton
          icon={dark ? Sun : Moon}
          label={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
        />
        <WindowSwitcher />
        <MobileMenu />
      </div>
      <ButtonLink className="menubar-cta" href="/start" variant="primary" size="sm">
        Get started
      </ButtonLink>
    </header>
  );
}

/** Slide-in list of every app for small screens. */
function MobileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useModalDialog(open, () => setOpen(false));
  const close = () => setOpen(false);

  return (
    <>
      <IconButton
        className="menubar-menu-btn"
        icon={MenuIcon}
        label="Open menu"
        onClick={() => setOpen(true)}
      />
      <dialog ref={ref} className="sheet" aria-label="Menu">
        <div className="sheet-head">
          <span className="brand">
            <Brand size={24} />
          </span>
          <IconButton icon={X} label="Close menu" onClick={close} />
        </div>
        <nav className="sheet-nav" aria-label="All apps">
          {LAUNCHERS.map((app) => {
            const Icon = app.icon;
            const content = (
              <>
                <Icon size={16} />
                <span className="menu-label">{app.label}</span>
              </>
            );
            return app.external ? (
              <ExternalA key={app.id} href={app.href} className="menu-item" onClick={close}>
                {content}
              </ExternalA>
            ) : (
              <Link key={app.id} href={app.href} className="menu-item" onClick={close}>
                {content}
              </Link>
            );
          })}
        </nav>
      </dialog>
    </>
  );
}
