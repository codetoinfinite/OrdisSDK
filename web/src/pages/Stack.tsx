import {
  Ban,
  Bot,
  CircleAlert,
  CircleCheck,
  Compass,
  KeyRound,
  Layers,
  Trash,
  Unplug,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, getServers, listAgents, listTools, type ServerLoad } from "../lib/api";
import { cx, errorMessage, listNames, plural, uniqueSlugs } from "../lib/format";
import { type CardItem, fromAgent, fromServer, fromTool } from "../lib/items";
import { gatewayUrl, type SnippetServer, STACK_CLIENTS } from "../lib/snippets";
import {
  clearStack,
  missingKeys,
  type StackItem,
  toast,
  toggleStack,
  useAllEnvs,
  useStack,
} from "../lib/state";
import type { AgentSummary, ItemType, ToolSummary } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { ConnectPanel } from "../ui/ConnectPanel";
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Empty,
  ErrorView,
  Monogram,
  Section,
} from "../ui/core";
import { EnvForm } from "../ui/EnvForm";
import { CardSkeletons, ItemCard, TYPE_META } from "../ui/ItemCard";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";

/** The agent playground chats with at most three servers. */
const CHAT_MAX = 3;

/** Servers first, then tools, then agents; saved order within each. */
const ORDER: ItemType[] = ["mcp", "tool", "agent"];
const NOUN: Record<ItemType, string> = { mcp: "server", tool: "tool", agent: "agent" };

interface Loaded {
  tools: Map<string, ToolSummary>;
  agents: Map<string, AgentSummary>;
  servers: ServerLoad[];
}

const itemKey = (item: StackItem) => `${item.type}:${item.id}`;

/** Every server the stack runs on: saved servers plus those behind saved tools and agents. */
function stackPackages(
  items: StackItem[],
  tools: Map<string, ToolSummary>,
  agents: Map<string, AgentSummary>,
): string[] {
  const pkgs = new Set<string>();
  for (const item of items) {
    if (item.type === "mcp") pkgs.add(item.id);
    else if (item.type === "tool") {
      const tool = tools.get(item.id);
      if (tool) pkgs.add(tool.mcp.server);
    } else for (const server of agents.get(item.id)?.servers ?? []) pkgs.add(server);
  }
  return [...pkgs];
}

async function loadStack(items: StackItem[], signal: AbortSignal): Promise<Loaded> {
  const wants = (type: ItemType) => items.some((item) => item.type === type);
  const [toolList, agentList] = await Promise.all([
    wants("tool") ? listTools() : Promise.resolve<ToolSummary[]>([]),
    wants("agent") ? listAgents() : Promise.resolve<AgentSummary[]>([]),
  ]);
  const tools = new Map(toolList.map((tool) => [tool.key, tool]));
  const agents = new Map(agentList.map((agent) => [agent.key, agent]));
  const servers = await getServers(stackPackages(items, tools, agents), signal);
  return { tools, agents, servers };
}

/** Which saved items bring a server into the stack. */
function usedBy(pkg: string, items: StackItem[], data: Loaded): string {
  const saved = items.some((item) => item.type === "mcp" && item.id === pkg);
  const users = items.flatMap((item) => {
    if (item.type === "tool") {
      const tool = data.tools.get(item.id);
      return tool?.mcp.server === pkg ? [tool.name] : [];
    }
    if (item.type === "agent") {
      const agent = data.agents.get(item.id);
      return agent?.servers.includes(pkg) ? [agent.name] : [];
    }
    return [];
  });
  if (!users.length) return "Saved to your stack.";
  return `${saved ? "Saved, and used by" : "Used by"} ${listNames(users)}.`;
}

function remove(item: StackItem) {
  toggleStack(item);
  toast("Removed from My stack", { body: item.name });
}

/** A saved item the catalog no longer has, or that failed to load. */
function MissingCard({ item, error }: { item: StackItem; error?: Error }) {
  const meta = TYPE_META[item.type];
  const gone = !error || (error instanceof ApiError && error.code === 404);
  return (
    <article className="card is-missing">
      <div className="card-head">
        <Monogram name={item.name} size={40} icon={item.type === "mcp" ? undefined : meta.icon} />
        <div className="card-titles">
          <h3 className="card-title">{item.name}</h3>
          <p className="card-meta">
            <span className={cx("card-type", `tone-${meta.tone}`)}>{meta.label}</span>
            <code className="truncate">{item.id}</code>
          </p>
        </div>
      </div>
      <p className="card-desc">{gone ? "It's no longer in the catalog." : errorMessage(error)}</p>
      <div>
        <Button size="sm" icon={Trash} onClick={() => remove(item)}>
          Remove
        </Button>
      </div>
    </article>
  );
}

function SavedCard({ item, data, loading }: { item: StackItem; data: Loaded; loading: boolean }) {
  let card: CardItem | undefined;
  let error: Error | undefined;
  if (item.type === "tool") {
    const tool = data.tools.get(item.id);
    card = tool && fromTool(tool);
  } else if (item.type === "agent") {
    const agent = data.agents.get(item.id);
    card = agent && fromAgent(agent);
  } else {
    const server = data.servers.find((row) => row.pkg === item.id);
    card = server?.detail && fromServer(server.detail);
    error = server?.error;
  }
  if (card) return <ItemCard item={card} />;
  // Saved from another window a moment ago: its details are still on the way.
  if (loading && !error) return <CardSkeletons count={1} />;
  return <MissingCard item={item} error={error} />;
}

function ServerRow({
  row,
  name,
  values,
  note,
}: {
  row: ServerLoad;
  name: string;
  values: Record<string, string>;
  note: string;
}) {
  const { pkg, detail } = row;
  const env = detail?.env ?? {};
  const keyed = Object.keys(env).length > 0;
  const runs = detail !== undefined && !detail.blocked;
  const missing = runs ? missingKeys(env, values) : [];

  let status: ReactNode;
  let problem: string | undefined;
  if (!detail) {
    status = (
      <Badge tone="red" icon={CircleAlert}>
        Can't load
      </Badge>
    );
    problem = errorMessage(row.error);
  } else if (detail.blocked) {
    status = (
      <Badge tone="red" icon={Ban}>
        Blocked
      </Badge>
    );
    problem = detail.blockReason ?? "Blocked on this AlpheSDK host.";
  } else if (missing.length) {
    status = (
      <Badge tone="yellow" icon={KeyRound}>
        {missing.length === 1 ? "Needs a key" : `Needs ${missing.length} keys`}
      </Badge>
    );
  } else if (keyed && !Object.values(values).some((value) => value.trim())) {
    status = (
      <Badge tone="muted" icon={KeyRound}>
        Keys optional
      </Badge>
    );
  } else {
    status = (
      <Badge tone="green" icon={CircleCheck}>
        {keyed ? "Keys set" : "No keys needed"}
      </Badge>
    );
  }

  return (
    <li className="stack-server">
      <div className="stack-server-head">
        <Monogram name={name} size={36} />
        <div className="stack-server-text">
          {detail ? (
            <Link href={paths.server(pkg)} className="link stack-server-name">
              {name}
            </Link>
          ) : (
            <span className="stack-server-name">{name}</span>
          )}
          <code className="stack-server-pkg">{pkg}</code>
        </div>
        {status}
      </div>
      <p className="stack-server-note">{note}</p>
      {problem && <p className="stack-server-problem">{problem}</p>}
      {runs && keyed && (
        // Opens while keys are missing and folds away once they're saved.
        <details className="stack-keys" open={missing.length > 0 || undefined}>
          <summary>{missing.length ? "Add keys" : "Edit keys"}</summary>
          <EnvForm packageName={pkg} env={env} />
        </details>
      )}
    </li>
  );
}

/** Clearing asks first, in place. Focus lands on Cancel so a stray Enter keeps the stack. */
function ClearStack({ count }: { count: number }) {
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const questionId = useId();

  const ask = (next: boolean) => {
    flushSync(() => setAsking(next));
    box.current?.querySelector<HTMLButtonElement>("button:last-child")?.focus();
  };

  const clear = () => {
    clearStack();
    toast("My stack is empty", { body: "Saved keys stay until you clear them in Settings." });
  };

  return (
    <div className="stack-clear" ref={box}>
      {asking ? (
        <>
          <span id={questionId} className="stack-clear-q">
            Remove all {plural(count, "item")}?
          </span>
          <Button
            variant="danger"
            size="sm"
            icon={Trash}
            aria-describedby={questionId}
            onClick={clear}
          >
            Remove all
          </Button>
          <Button size="sm" aria-describedby={questionId} onClick={() => ask(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="ghost" icon={Trash} onClick={() => ask(true)}>
          Clear stack
        </Button>
      )}
    </div>
  );
}

export function StackPage() {
  const items = useStack();
  const allEnvs = useAllEnvs();
  const ordered = ORDER.flatMap((type) => items.filter((item) => item.type === type));
  const loaded = useAsync((signal) => loadStack(ordered, signal), [ordered.map(itemKey)], {
    keep: true,
    skip: !ordered.length,
  });
  const data = loaded.data;

  if (!ordered.length) {
    return (
      <div className="page page-narrow">
        <Empty
          icon={Layers}
          title="Your stack is empty"
          action={
            <ButtonLink variant="primary" icon={Compass} href={paths.explore()}>
              Explore the catalog
            </ButtonLink>
          }
        >
          Save servers, tools and agents with the bookmark on any card. They gather here with their
          keys, ready to connect to your MCP client in one go.
        </Empty>
      </div>
    );
  }

  const counts = ORDER.flatMap((type) => {
    const n = ordered.filter((item) => item.type === type).length;
    return n ? [plural(n, NOUN[type])] : [];
  });

  // Stale results can hold servers of items removed since; show only the ones still needed.
  const needed = data ? stackPackages(ordered, data.tools, data.agents) : [];
  const rows = needed.flatMap((pkg) => data?.servers.filter((row) => row.pkg === pkg) ?? []);
  const usable = rows.flatMap((row) => (row.detail && !row.detail.blocked ? [row.detail] : []));
  // A server that failed to load still shows the name it was saved under.
  const nameOf = (row: ServerLoad) =>
    row.detail?.name ??
    ordered.find((item) => item.type === "mcp" && item.id === row.pkg)?.name ??
    row.pkg;
  const blocked = rows.filter((row) => row.detail?.blocked).map(nameOf);
  const failed = rows.filter((row) => !row.detail).map(nameOf);
  const slugs = uniqueSlugs(usable.map((server) => server.packageName));
  const snippetServers: SnippetServer[] = usable.map((server, i) => ({
    name: slugs[i],
    packageName: server.packageName,
    url: gatewayUrl(server.connect.gatewayPath),
    env: server.env,
    values: allEnvs[server.packageName] ?? {},
    stdio: server.connect.stdio,
  }));
  const chat = usable.slice(0, CHAT_MAX).map((server) => server.packageName);

  return (
    <div className="page stack">
      <header className="page-head">
        <h1 className="page-title">My stack</h1>
        <p className="page-lead">
          {listNames(counts)} saved. Add keys once, then connect everything to your MCP client with
          a single config.
        </p>
        <div className="page-actions">
          {chat.length > 0 && (
            <ButtonLink
              variant="primary"
              icon={Bot}
              href={paths.playground({ mode: "agent", servers: chat.join(",") })}
            >
              Chat with your stack
            </ButtonLink>
          )}
          <ButtonLink icon={Compass} href={paths.explore()}>
            Add more
          </ButtonLink>
          <ClearStack count={ordered.length} />
        </div>
      </header>

      {loaded.error && (
        <ErrorView title="Couldn't load your stack" error={loaded.error} onRetry={loaded.reload} />
      )}

      {(data || !loaded.error) && (
        <Section title="Saved" sub="The bookmark on a card takes it out of your stack.">
          <div className="card-grid">
            {data ? (
              ordered.map((item) => (
                <SavedCard key={itemKey(item)} item={item} data={data} loading={loaded.loading} />
              ))
            ) : (
              <CardSkeletons count={Math.min(ordered.length, 6)} />
            )}
          </div>
        </Section>
      )}

      {data && rows.length > 0 && (
        <Section title="Servers" sub="Everything your stack runs on. Keys stay in this browser.">
          <ul className="tool-list stack-servers">
            {rows.map((row) => (
              <ServerRow
                key={row.pkg}
                row={row}
                name={nameOf(row)}
                values={allEnvs[row.pkg] ?? {}}
                note={usedBy(row.pkg, ordered, data)}
              />
            ))}
          </ul>
        </Section>
      )}

      {data && rows.length > 0 && (
        <Section
          title="Connect everything"
          sub="One config with every server above. Paste it into your MCP client."
        >
          {(blocked.length > 0 || failed.length > 0) && (
            <Callout kind="warn" title="Left out of the config">
              {blocked.length > 0 &&
                `${listNames(blocked)} ${blocked.length === 1 ? "is" : "are"} blocked on this host. `}
              {failed.length > 0 && `${listNames(failed)} couldn't load.`}
            </Callout>
          )}
          {usable.length > 0 ? (
            <ConnectPanel clients={STACK_CLIENTS} servers={snippetServers} />
          ) : (
            <Empty icon={Unplug} title="Nothing to connect">
              None of these servers can run on this AlpheSDK host.
            </Empty>
          )}
        </Section>
      )}
    </div>
  );
}
