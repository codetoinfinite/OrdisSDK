import { Ban, Bot, CircleAlert, Hash, KeyRound } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { getAgent } from "../lib/api";
import { plural } from "../lib/format";
import { fromAgent } from "../lib/items";
import { type AgentLang, agentSnippet } from "../lib/snippets";
import { markStep, missingKeys, useAllEnvs } from "../lib/state";
import type { AgentDetail, AgentResolvedServer } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { AgentChat } from "../ui/AgentChat";
import { CodeBlock } from "../ui/CodeBlock";
import { Badge, Button, Callout, Monogram, Section, Tabs } from "../ui/core";
import {
  DetailError,
  DetailHead,
  DetailSkeleton,
  type Fact,
  Facts,
  StackButton,
} from "../ui/Detail";
import { EnvForm } from "../ui/EnvForm";
import { itemBadges } from "../ui/ItemCard";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";
import { useWin, useWindowTitle } from "../wm/WindowManager";

const serverName = (server: AgentResolvedServer) => server.summary?.name ?? server.server;

/** Servers the chat can start: listed in the catalog and not blocked. */
const usable = (server: AgentResolvedServer) => server.found && !server.summary?.blocked;

const HOW: Record<AgentLang, string> = {
  rest: "Post the conversation so far; the agent keeps no memory between calls. -N prints each event as it arrives.",
  typescript: "Post the conversation so far and print the reply as it streams in.",
};

function ServerRow({ server, needsKeys }: { server: AgentResolvedServer; needsKeys: boolean }) {
  const name = serverName(server);
  const count = server.summary?.toolCount ?? 0;

  let badge: ReactNode = null;
  if (!server.found) {
    badge = (
      <Badge tone="red" icon={CircleAlert}>
        Missing
      </Badge>
    );
  } else if (server.summary?.blocked) {
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

  let tools: ReactNode;
  if (!server.found) tools = "Not in the catalog";
  else if (server.tools?.length) {
    tools = server.tools.map((tool) => (
      <Link
        key={tool}
        href={paths.server(server.server, { tab: "tools", tool })}
        className="agent-server-tool"
      >
        <code>{tool}</code>
      </Link>
    ));
  } else tools = count ? `All ${plural(count, "tool")}` : "All its tools";

  return (
    <div className="agent-server">
      <Monogram name={name} size={28} />
      <div className="agent-server-text">
        {server.found ? (
          <Link href={paths.server(server.server)} className="link agent-server-name">
            {name}
          </Link>
        ) : (
          <code className="agent-server-name">{server.server}</code>
        )}
        {badge}
        <div className="agent-server-tools">{tools}</div>
      </div>
    </div>
  );
}

/** REST and TypeScript calls to the chat endpoint. Keys are always placeholders here. */
function AgentCode({ agent }: { agent: AgentDetail }) {
  const [lang, setLang] = useState<AgentLang>("rest");
  const keys = Object.fromEntries(
    agent.resolvedServers
      .filter(usable)
      .map((server) => [server.server, missingKeys(server.env ?? {}, {})]),
  );
  const snippet = agentSnippet(lang, {
    agentKey: agent.key,
    message: agent.starterPrompts[0] ?? "Hello!",
    keys,
  });

  return (
    <div className="connect">
      <Tabs<AgentLang>
        label="Language"
        items={[
          { key: "rest", label: "REST" },
          { key: "typescript", label: "TypeScript" },
        ]}
        value={lang}
        onChange={setLang}
      >
        <div className="connect-body">
          <p className="connect-how">{HOW[lang]}</p>
          <CodeBlock
            code={snippet.code}
            lang={snippet.lang}
            title={lang === "rest" ? "curl" : "chat.ts"}
            maxHeight={420}
          />
          {snippet.note && <p className="code-note">{snippet.note}</p>}
        </div>
      </Tabs>
    </div>
  );
}

function AgentView({ agent }: { agent: AgentDetail }) {
  const allEnvs = useAllEnvs();
  const keysCard = useRef<HTMLElement>(null);
  const ready = agent.resolvedServers.filter(usable);
  const packages = ready.map((server) => server.server);
  const keyed = ready.filter((server) => Object.keys(server.env ?? {}).length > 0);
  const needKeys = new Set(
    keyed
      .filter((server) => missingKeys(server.env ?? {}, allEnvs[server.server] ?? {}).length)
      .map((server) => server.server),
  );
  const needNames = keyed.filter((server) => needKeys.has(server.server)).map(serverName);

  // Focusing the first key input also scrolls the card into view.
  const focusKeys = () => keysCard.current?.querySelector("input")?.focus();

  const facts: Fact[] = [
    { label: "Model", value: agent.model ? <code>{agent.model}</code> : "Host default" },
    { label: "Step limit", value: `${plural(agent.maxSteps, "step")} per reply` },
    {
      label: "Category",
      value: (
        <Link href={paths.explore({ type: "agent", category: agent.category })} className="link">
          {agent.categoryName || agent.category}
        </Link>
      ),
    },
  ];
  if (agent.tags.length) {
    facts.push({
      label: "Tags",
      value: (
        <div className="badge-row">
          {agent.tags.map((tag) => (
            <Badge key={tag} tone="muted" icon={Hash}>
              {tag}
            </Badge>
          ))}
        </div>
      ),
    });
  }
  facts.push({ label: "Catalog key", value: <code>{agent.key}</code> });

  return (
    <div className="page detail">
      <DetailHead
        name={agent.name}
        icon={Bot}
        sub={
          <>
            <span>by {agent.author ?? "AlpheSDK"}</span>
            {itemBadges(fromAgent(agent))}
          </>
        }
        actions={<StackButton type="agent" id={agent.key} name={agent.name} />}
      />

      <div className="detail-body">
        <div className="detail-main">
          {(agent.issues.length > 0 || !agent.runnable) && (
            <Callout
              kind={agent.runnable ? "warn" : "danger"}
              title={agent.runnable ? "Heads up" : "This agent can't run here"}
            >
              {agent.issues.length > 0 ? (
                <ul className="issue-list">
                  {agent.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                "A server it needs isn't available on this AlpheSDK host."
              )}
            </Callout>
          )}

          {agent.runnable && needNames.length > 0 && (
            <Callout
              kind="warn"
              title="Add keys before you chat"
              action={
                <Button size="sm" icon={KeyRound} onClick={focusKeys}>
                  Add keys
                </Button>
              }
            >
              {needNames.join(", ")} {needNames.length === 1 ? "needs" : "need"} keys to run. They
              stay in this browser.
            </Callout>
          )}

          {agent.runnable && (
            <>
              <div className="agent-chat">
                <AgentChat
                  key={agent.key}
                  agentKey={agent.key}
                  packages={packages}
                  starters={agent.starterPrompts}
                  intro={agent.description}
                />
              </div>
              <Section
                title="Use it from code"
                sub="Call this agent from your app. Replies stream back as server-sent events."
              >
                <AgentCode agent={agent} />
              </Section>
            </>
          )}
        </div>

        <aside className="detail-aside">
          <section className="detail-aside-card">
            <h2 className="facts-title">Servers</h2>
            <ul className="tool-list">
              {agent.resolvedServers.map((server) => (
                <li key={server.server}>
                  <ServerRow server={server} needsKeys={needKeys.has(server.server)} />
                </li>
              ))}
            </ul>
          </section>

          {keyed.length > 0 && (
            <section className="facts-card agent-keys" ref={keysCard}>
              <h2 className="facts-title">Keys</h2>
              {keyed.map((server) => (
                <div key={server.server} className="agent-keys-server">
                  <h3 className="agent-keys-name">{serverName(server)}</h3>
                  <EnvForm packageName={server.server} env={server.env ?? {}} />
                </div>
              ))}
            </section>
          )}

          <Facts items={facts}>
            {agent.systemPrompt && (
              <details className="agent-prompt">
                <summary>System prompt</summary>
                <p className="agent-prompt-text">{agent.systemPrompt}</p>
              </details>
            )}
          </Facts>
        </aside>
      </div>
    </div>
  );
}

export function AgentPage() {
  const { route } = useWin();
  const key = route.params.id ?? "";
  const agent = useAsync((signal) => getAgent(key, signal), [key]);
  const data = agent.data;
  useWindowTitle(data?.name);

  useEffect(() => {
    if (data) markStep("inspect");
  }, [data]);

  if (agent.error) {
    return (
      <DetailError
        what="Agent"
        name={key}
        error={agent.error}
        onRetry={agent.reload}
        back={{ href: paths.explore({ type: "agent" }), label: "Browse agents" }}
      />
    );
  }
  if (!data) return <DetailSkeleton />;
  return <AgentView agent={data} />;
}
