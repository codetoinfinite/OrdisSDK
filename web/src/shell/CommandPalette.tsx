import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bot, Moon, Search, Server, Sun, Wrench, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { suggest } from "../lib/api";
import { toggleTheme, useIsDark } from "../lib/settings";
import { closePalette, openPalette, paletteStore, usePaletteOpen } from "../lib/state";
import type { Suggestion } from "../lib/types";
import { useAsync, useDebounced } from "../lib/useAsync";
import { useModalDialog } from "../lib/useModalDialog";
import { Kbd, Spinner, type ToneName } from "../ui/core";
import { paths } from "../wm/routes";
import { useWm, useWmState } from "../wm/WindowManager";
import { LAUNCHERS, openExternal } from "./launchers";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  tone: ToneName;
  run(): void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function resultItem(s: Suggestion, open: (href: string) => void): PaletteItem | null {
  const base = { id: `result:${s.id}`, group: "Catalog", label: s.name };
  if (s.type === "mcp" && s.packageName) {
    const pkg = s.packageName;
    return {
      ...base,
      sub: `MCP server · ${pkg}`,
      icon: Server,
      tone: "green",
      run: () => open(paths.server(pkg)),
    };
  }
  if (s.type === "tool") {
    const href = s.key
      ? paths.tool(s.key)
      : s.server && paths.server(s.server, { tab: "tools", tool: s.toolName });
    if (!href) return null;
    return {
      ...base,
      sub: `Tool · ${s.server ?? s.category}`,
      icon: Wrench,
      tone: "teal",
      run: () => open(href),
    };
  }
  if (s.type === "agent" && s.key) {
    const key = s.key;
    return {
      ...base,
      sub: `Agent · ${s.category}`,
      icon: Bot,
      tone: "purple",
      run: () => open(paths.agent(key)),
    };
  }
  return null;
}

/** ⌘K search across apps, actions and the catalog. */
export function CommandPalette() {
  const open = usePaletteOpen();
  const wm = useWm();
  const { wins } = useWmState();
  const dark = useIsDark();
  const dialogRef = useModalDialog(open, closePalette);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const needle = q.trim();
  const debounced = useDebounced(needle, 150);
  const searching = needle.length >= 2;
  const { data, loading } = useAsync((signal) => suggest(debounced, signal), [debounced], {
    skip: debounced.length < 2,
    keep: true,
  });

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        paletteStore.set(!paletteStore.get());
        return;
      }
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTyping(event.target)
      ) {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { items, results } = useMemo(() => {
    const lower = needle.toLowerCase();
    const matches = (text: string) => !lower || text.toLowerCase().includes(lower);
    const openHref = (href: string) => wm.open(href);

    const results = searching
      ? (data ?? []).flatMap((s) => {
          const item = resultItem(s, openHref);
          return item ? [item] : [];
        })
      : [];
    const apps = LAUNCHERS.filter((app) => matches(app.label)).map(
      (app): PaletteItem => ({
        id: `app:${app.id}`,
        group: "Apps",
        label: app.label,
        sub: app.external ? "Opens in a new tab" : undefined,
        icon: app.icon,
        tone: app.tone,
        run: () => (app.external ? openExternal(app.href) : openHref(app.href)),
      }),
    );
    const actions: PaletteItem[] = [
      {
        id: "action:theme",
        group: "Actions",
        label: dark ? "Switch to light mode" : "Switch to dark mode",
        icon: dark ? Sun : Moon,
        tone: "muted",
        run: toggleTheme,
      },
    ];
    if (wins.length) {
      actions.push({
        id: "action:close-all",
        group: "Actions",
        label: "Close all windows",
        icon: X,
        tone: "muted",
        run: wm.closeAll,
      });
    }
    const explore: PaletteItem[] = lower
      ? [
          {
            id: "action:explore",
            group: "Search",
            label: `Search “${needle}” in Explore`,
            icon: Search,
            tone: "blue",
            run: () => openHref(paths.explore({ q: needle })),
          },
        ]
      : [];

    return {
      results,
      items: [...results, ...apps, ...actions.filter((a) => matches(a.label)), ...explore],
    };
  }, [needle, searching, data, dark, wins.length, wm]);

  const current = Math.min(active, items.length - 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the highlighted row changes
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (item: PaletteItem) => {
    closePalette();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!items.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + delta + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (item) run(item);
    }
  };

  const settled = searching && debounced === needle && !loading;

  return (
    <dialog ref={dialogRef} className="palette" aria-label="Search AlpheSDK">
      <div className="palette-search">
        <Search size={18} />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search servers, tools, agents or apps"
          aria-label="Search servers, tools, agents or apps"
          autoComplete="off"
          spellCheck={false}
        />
        {searching && loading && <Spinner label="Searching" />}
      </div>
      <div ref={listRef} className="palette-list">
        {settled && results.length === 0 && (
          <p className="palette-empty">No catalog matches. Press Enter to search Explore.</p>
        )}
        {items.map((item, index) => {
          const Icon = item.icon;
          const heading = index === 0 || items[index - 1].group !== item.group;
          return (
            <div key={item.id}>
              {heading && <p className="palette-group">{item.group}</p>}
              <button
                type="button"
                className="palette-item"
                data-active={index === current}
                onMouseMove={() => index !== current && setActive(index)}
                onClick={() => run(item)}
              >
                <span className={`palette-icon tone-${item.tone}`}>
                  <Icon size={16} />
                </span>
                <span className="palette-text">
                  <span className="palette-label">{item.label}</span>
                  {item.sub && <span className="palette-sub">{item.sub}</span>}
                </span>
                <ArrowRight size={15} className="palette-go" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="palette-foot">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
        <span>
          <Kbd>Esc</Kbd> close
        </span>
      </div>
    </dialog>
  );
}
