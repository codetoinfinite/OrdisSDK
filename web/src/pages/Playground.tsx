import { BadgeCheck, Ban, Bot, CircleAlert, KeyRound, Search, Wrench, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { getServer, getServers, listTools, type ServerLoad, search } from "../lib/api";
import { errorMessage, listNames, plural } from "../lib/format";
import { missingKeys, useAllEnvs } from "../lib/state";
import { useAsync, useDebounced } from "../lib/useAsync";
import { AgentChat } from "../ui/AgentChat";
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Empty,
  ErrorView,
  IconButton,
  Monogram,
  Section,
  Spinner,
} from "../ui/core";
import { EnvForm } from "../ui/EnvForm";
import { Segmented, TextInput } from "../ui/form";
import { ToolRunner } from "../ui/ToolRunner";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";
import { useRouteQuery, useWin } from "../wm/WindowManager";

type Mode = "tool" | "agent";

/** The chat endpoint takes at most three servers. */
const MAX_SERVERS = 3;

const LEAD: Record<Mode, string> = {
  tool: "Run any MCP tool without writing code.",
  agent: "Chat with a model that calls tools from up to three servers.",
};

const STARTERS = [
  "What can you do with these tools?",
  "Pick one of your tools and show me what it does.",
];

/** Servers from the query string: trimmed, unique, at most three. */
function parseServers(raw: string | null): string[] {
  const list: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const pkg = part.trim();
    if (pkg && !list.includes(pkg)) list.push(pkg);
  }
  return list.slice(0, MAX_SERVERS);
}

/** "A", "A and B", "A, B and C". */

interface PickOption {
  packageName: string;
  name: string;
  validated?: boolean;
  needsKeys?: boolean;
}

/**
 * Finds an MCP server to use. Before anything is typed it offers the servers behind the
 * curated tools, which are known to start.
 */
function ServerPicker({
  onPick,
  exclude = [],
  max = 8,
}: {
  onPick(packageName: string): void;
  /** Already picked; shown but disabled. */
  exclude?: string[];
  max?: number;
}) {
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim(), 200);
  const searching = needle.length >= 2;
  // Results remember their query: with `keep`, the last results stay up while the next search runs.
  const found = useAsync(
    async (signal) => {
      const result = await search({ q: needle, type: "mcp", blocked: false, limit: max }, signal);
      return { needle, hits: result.hits };
    },
    [needle, max],
    { skip: !searching, keep: true },
  );
  const current = searching && found.data?.needle === needle;
  const tools = useAsync(() => listTools(), []);

  let options: PickOption[] = [];
  if (searching) {
    const hits = found.error ? [] : (found.data?.hits ?? []);
    options = hits.flatMap((hit) =>
      hit.type === "mcp"
        ? [
            {
              packageName: hit.packageName,
              name: hit.name,
              validated: hit.validated,
              needsKeys: hit.needsKeys,
            },
          ]
        : [],
    );
  } else {
    const servers = new Map<string, PickOption>();
    for (const tool of tools.data ?? []) {
      const pkg = tool.mcp.server;
      if (tool.runnable && !servers.has(pkg)) {
        servers.set(pkg, { packageName: pkg, name: tool.serverName || pkg });
      }
    }
    // Picked servers stay in search results (disabled) but drop out of the quick picks.
    options = [...servers.values()]
      .filter((option) => !exclude.includes(option.packageName))
      .slice(0, max);
  }

  const pick = (pkg: string) => {
    setQ("");
    onPick(pkg);
  };

  // Enter takes the top result, once the results match what was typed.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (!current || q.trim() !== needle) return;
    const first = options.find((option) => !exclude.includes(option.packageName));
    if (!first) return;
    event.preventDefault();
    pick(first.packageName);
  };

  let label = "Quick picks";
  if (searching && found.error) label = "Search failed";
  else if (current) label = `Servers matching “${needle}”`;
  else if (searching) label = "Searching…";

  return (
    <div className="picker">
      <TextInput
        icon={Search}
        type="search"
        aria-label="Search MCP servers"
        placeholder="Search servers, e.g. weather"
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="picker-label">{label}</p>
      {options.length > 0 && (
        <ul className="picker-list">
          {options.map((option) => (
            <li key={option.packageName}>
              <button
                type="button"
                className="picker-item"
                disabled={exclude.includes(option.packageName)}
                onClick={() => pick(option.packageName)}
              >
                <Monogram name={option.name} size={30} />
                <span className="picker-text">
                  <span className="picker-name">{option.name}</span>
                  <code className="picker-pkg">{option.packageName}</code>
                  {(option.validated || option.needsKeys) && (
                    <span className="badge-row">
                      {option.validated && (
                        <Badge tone="green" icon={BadgeCheck}>
                          Verified
                        </Badge>
                      )}
                      {option.needsKeys && (
                        <Badge tone="yellow" icon={KeyRound}>
                          Needs keys
                        </Badge>
                      )}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searching && found.error && <p className="picker-note">{errorMessage(found.error)}</p>}
      {current && !found.error && !options.length && (
        <p className="picker-note">
          No runnable servers match “{needle}”.{" "}
          <Link href={paths.explore({ type: "mcp", q: needle })} className="link">
            Search the whole catalog
          </Link>
        </p>
      )}
    </div>
  );
}

/* ---------- Tool mode ---------- */

type GoTool = (to: { server?: string; tool?: string }, replace?: boolean) => void;

function ToolServer({ pkg, tool, go }: { pkg: string; tool?: string; go: GoTool }) {
  const server = useAsync((signal) => getServer(pkg, signal), [pkg]);
  const keys = useRef<HTMLDivElement>(null);
  const detail = server.data;
  const name = detail?.name ?? pkg;

  // Focusing the first key input also scrolls the form into view.
  const focusKeys = () => keys.current?.querySelector("input")?.focus();

  let body: ReactNode;
  if (server.error) {
    body = (
      <ErrorView title="Couldn't load the server" error={server.error} onRetry={server.reload} />
    );
  } else if (!detail) {
    body = (
      <div className="loading-block">
        <Spinner showLabel label="Loading the server…" />
      </div>
    );
  } else {
    body = (
      <>
        {!detail.blocked && Object.keys(detail.env).length > 0 && (
          <div ref={keys}>
            <Section title="Keys" sub="The server needs these to run. They stay in this browser.">
              <EnvForm packageName={pkg} env={detail.env} />
            </Section>
          </div>
        )}
        <Section title="Tools" sub="Pick a tool, fill in its inputs and run it.">
          <ToolRunner
            server={detail}
            selected={tool}
            onSelect={(next) => go({ server: pkg, tool: next }, true)}
            onNeedKeys={focusKeys}
          />
        </Section>
      </>
    );
  }

  return (
    <>
      <div className="playground-server">
        <Monogram name={name} size={40} />
        <div className="playground-server-text">
          <h2 className="playground-server-name">
            {detail ? (
              <Link href={paths.server(pkg)} className="link">
                {detail.name}
              </Link>
            ) : (
              name
            )}
          </h2>
          <code className="playground-server-pkg">{pkg}</code>
        </div>
        <div className="playground-server-actions">
          <Button size="sm" icon={Search} onClick={() => go({})}>
            Change server
          </Button>
          {detail && !detail.blocked && (
            <ButtonLink
              size="sm"
              icon={Bot}
              href={paths.playground({ mode: "agent", servers: pkg })}
            >
              Chat with it
            </ButtonLink>
          )}
        </div>
      </div>
      {body}
    </>
  );
}

function ToolMode({ pkg, tool, go }: { pkg?: string; tool?: string; go: GoTool }) {
  if (pkg) return <ToolServer pkg={pkg} tool={tool} go={go} />;
  return (
    <Section title="Pick a server" sub="AlpheSDK starts it here and lists its tools, ready to run.">
      <ServerPicker onPick={(server) => go({ server })} />
    </Section>
  );
}

/* ---------- Agent mode ---------- */

/** A picked server: loading (neither field), loaded, or failed. */

function PickedRow({
  row,
  needsKeys,
  onRemove,
}: {
  row: ServerLoad;
  needsKeys: boolean;
  onRemove(pkg: string): void;
}) {
  const { pkg, detail, error } = row;
  const name = detail?.name ?? pkg;

  let badge: ReactNode = null;
  if (error) {
    badge = (
      <Badge tone="red" icon={CircleAlert}>
        Can't load
      </Badge>
    );
  } else if (detail?.blocked) {
    badge = (
      <Badge tone="red" icon={Ban}>
        Blocked
      </Badge>
    );
  } else if (needsKeys) {
    badge = (
      <Badge tone="yellow" icon={KeyRound}>
        Needs keys
      </Badge>
    );
  }

  let note = "Loading…";
  if (error || detail?.blocked) note = "Left out of the chat";
  else if (detail)
    note = detail.toolCount ? `All ${plural(detail.toolCount, "tool")}` : "All its tools";

  return (
    <div className="agent-server is-removable">
      <Monogram name={name} size={28} />
      <div className="agent-server-text">
        {detail ? (
          <Link href={paths.server(pkg)} className="link agent-server-name">
            {name}
          </Link>
        ) : (
          <code className="agent-server-name">{pkg}</code>
        )}
        {badge}
        <div className="agent-server-tools">{note}</div>
      </div>
      <IconButton icon={X} label={`Remove ${name}`} size="sm" onClick={() => onRemove(pkg)} />
    </div>
  );
}

function AgentMode({ list, setList }: { list: string[]; setList(list: string[]): void }) {
  const allEnvs = useAllEnvs();
  const keysCard = useRef<HTMLElement>(null);
  const loaded = useAsync((signal) => getServers(list, signal), [list], {
    keep: true,
    skip: !list.length,
  });

  const byPkg = new Map((loaded.data ?? []).map((row) => [row.pkg, row]));
  const rows = list.map((pkg): ServerLoad => byPkg.get(pkg) ?? { pkg });
  const ready = rows.flatMap((row) => (row.detail && !row.detail.blocked ? [row.detail] : []));
  const left = rows.filter((row) => row.error || row.detail?.blocked);
  const keyed = ready.filter((server) => Object.keys(server.env).length > 0);
  const needKeys = keyed.filter(
    (server) => missingKeys(server.env, allEnvs[server.packageName] ?? {}).length > 0,
  );
  const needPkgs = new Set(needKeys.map((server) => server.packageName));

  // Focusing the first key input also scrolls the card into view.
  const focusKeys = () => keysCard.current?.querySelector("input")?.focus();
  const add = (pkg: string) => setList([...list, pkg]);
  const remove = (pkg: string) => setList(list.filter((item) => item !== pkg));

  if (!list.length) {
    return (
      <Section
        title="Pick up to three servers"
        sub="The model can call every tool they offer. Keys stay in this browser."
      >
        <ServerPicker onPick={add} />
      </Section>
    );
  }

  let chat: ReactNode;
  if (ready.length) {
    chat = (
      <div className="agent-chat">
        <AgentChat
          servers={ready.map((server) => ({ server: server.packageName }))}
          packages={ready.map((server) => server.packageName)}
          starters={STARTERS}
          intro={`Ask anything. The model can call the tools of ${listNames(ready.map((server) => server.name))}.`}
        />
      </div>
    );
  } else if (loaded.loading) {
    chat = (
      <div className="loading-block">
        <Spinner showLabel label="Loading the servers…" />
      </div>
    );
  } else {
    chat = (
      <Empty icon={Bot} title="None of these servers can run here">
        Remove them and pick others.
      </Empty>
    );
  }

  return (
    <div className="detail-body">
      <div className="detail-main">
        {left.length > 0 && (
          <Callout kind="warn" title="Left out of the chat">
            <ul className="issue-list">
              {left.map((row) => (
                <li key={row.pkg}>
                  <code>{row.pkg}</code>:{" "}
                  {row.error
                    ? errorMessage(row.error)
                    : (row.detail?.blockReason ?? "blocked on this AlpheSDK host")}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {needKeys.length > 0 && (
          <Callout
            kind="warn"
            title="Add keys before you chat"
            action={
              <Button size="sm" icon={KeyRound} onClick={focusKeys}>
                Add keys
              </Button>
            }
          >
            {listNames(needKeys.map((server) => server.name))}{" "}
            {needKeys.length === 1 ? "needs" : "need"} keys to run. They stay in this browser.
          </Callout>
        )}

        {chat}
      </div>

      <aside className="detail-aside">
        <section className="detail-aside-card playground-picked">
          <h2 className="facts-title">Servers</h2>
          <ul className="tool-list">
            {rows.map((row) => (
              <li key={row.pkg}>
                <PickedRow row={row} needsKeys={needPkgs.has(row.pkg)} onRemove={remove} />
              </li>
            ))}
          </ul>
          {list.length < MAX_SERVERS ? (
            <ServerPicker onPick={add} exclude={list} max={4} />
          ) : (
            <p className="playground-limit">Three is the limit. Remove one to add another.</p>
          )}
        </section>

        {keyed.length > 0 && (
          <section className="facts-card agent-keys" ref={keysCard}>
            <h2 className="facts-title">Keys</h2>
            {keyed.map((server) => (
              <div key={server.packageName} className="agent-keys-server">
                <h3 className="agent-keys-name">{server.name}</h3>
                <EnvForm packageName={server.packageName} env={server.env} />
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}

/* ---------- Page ---------- */

/** Try servers without code: run one tool, or chat with a model that can call their tools. */
export function PlaygroundPage() {
  const win = useWin();
  const query = useRouteQuery();
  const mode: Mode = query.get("mode") === "agent" ? "agent" : "tool";
  const server = query.get("server") || undefined;
  const tool = query.get("tool") || undefined;
  const servers = parseServers(query.get("servers"));

  const goTool: GoTool = (to, replace = false) => win.navigate(paths.playground(to), { replace });
  const setServers = (list: string[]) =>
    win.navigate(paths.playground({ mode: "agent", servers: list.join(",") }), { replace: true });

  // Carry the server over when switching modes.
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    win.navigate(
      next === "agent"
        ? paths.playground({ mode: "agent", servers: server })
        : paths.playground({ server: servers[0] }),
    );
  };

  return (
    <div className="page playground">
      <header className="page-head playground-head">
        <div className="playground-head-text">
          <h1 className="page-title">Playground</h1>
          <p className="page-lead">{LEAD[mode]}</p>
        </div>
        <Segmented<Mode>
          className="playground-mode"
          label="Playground mode"
          options={[
            { key: "tool", label: "Run a tool", icon: Wrench },
            { key: "agent", label: "Chat with an agent", icon: Bot },
          ]}
          value={mode}
          onChange={switchMode}
        />
      </header>

      {mode === "tool" ? (
        <ToolMode pkg={server} tool={tool} go={goTool} />
      ) : (
        <AgentMode list={servers} setList={setServers} />
      )}
    </div>
  );
}
