import { Bot, Hash, Wrench } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { getServer, getTool } from "../lib/api";
import { slugify } from "../lib/format";
import { fromServer, fromTool } from "../lib/items";
import { type ClientId, gatewayUrl } from "../lib/snippets";
import { markStep, useEnvValues } from "../lib/state";
import type { ToolDetail } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { ConnectPanel } from "../ui/ConnectPanel";
import { Badge, ButtonLink, Callout, ErrorView, Section, Spinner } from "../ui/core";
import {
  DetailError,
  DetailHead,
  DetailSkeleton,
  type Fact,
  Facts,
  StackButton,
} from "../ui/Detail";
import { EnvForm } from "../ui/EnvForm";
import { ItemCard, itemBadges } from "../ui/ItemCard";
import { ToolRunner } from "../ui/ToolRunner";
import { Link } from "../wm/Link";
import { paths } from "../wm/routes";
import { useWin, useWindowTitle } from "../wm/WindowManager";

/** A tool page is about calling one tool, so the code snippets come first. */
const CLIENTS: ClientId[] = [
  "rest",
  "typescript",
  "claude-code",
  "cursor",
  "vscode",
  "claude-desktop",
];

function ToolView({ tool }: { tool: ToolDetail }) {
  const pkg = tool.mcp.server;
  const server = useAsync((signal) => getServer(pkg, signal), [pkg], { skip: !tool.server });
  const values = useEnvValues(pkg);
  const keys = useRef<HTMLDivElement>(null);
  const detail = server.data;
  const usable = detail && !detail.blocked;

  const facts: Fact[] = [
    { label: "MCP tool", value: <code>{tool.mcp.tool}</code> },
    {
      label: "Server",
      value: tool.server ? (
        <Link href={paths.server(pkg)} className="link">
          {tool.serverName}
        </Link>
      ) : (
        <code>{pkg}</code>
      ),
    },
  ];
  if (tool.server) facts.push({ label: "Runtime", value: tool.server.runtime });
  facts.push(
    {
      label: "Category",
      value: (
        <Link href={paths.explore({ type: "tool", category: tool.category })} className="link">
          {tool.categoryName || tool.category}
        </Link>
      ),
    },
    { label: "Catalog key", value: <code>{tool.key}</code> },
  );

  // Focusing the first key input also scrolls the form into view.
  const focusKeys = () => keys.current?.querySelector("input")?.focus();

  let runner: ReactNode = null;
  if (server.error) {
    runner = (
      <ErrorView title="Couldn't load the server" error={server.error} onRetry={server.reload} />
    );
  } else if (tool.server && !detail) {
    runner = (
      <div className="loading-block">
        <Spinner showLabel label="Loading the server…" />
      </div>
    );
  } else if (detail) {
    runner = <ToolRunner server={detail} selected={tool.mcp.tool} single onNeedKeys={focusKeys} />;
  }

  return (
    <div className="page detail">
      <DetailHead
        name={tool.name}
        icon={Wrench}
        sub={
          <>
            <code className="truncate">{tool.mcp.tool}</code>
            <span>on</span>
            {tool.server ? (
              <Link href={paths.server(pkg)} className="link truncate">
                {tool.serverName}
              </Link>
            ) : (
              <code className="truncate">{pkg}</code>
            )}
          </>
        }
        actions={
          <>
            <StackButton type="tool" id={tool.key} name={tool.name} />
            {tool.runnable && (
              <ButtonLink icon={Bot} href={paths.playground({ mode: "agent", servers: pkg })}>
                Use with an agent
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="detail-intro">
        {tool.description && <p className="page-lead">{tool.description}</p>}
        <div className="badge-row">
          {itemBadges(fromTool(tool))}
          {tool.tags.map((tag) => (
            <Badge key={tag} tone="muted" icon={Hash}>
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-main">
          {(tool.issues.length > 0 || !tool.runnable) && (
            <Callout
              kind={tool.runnable ? "warn" : "danger"}
              title={tool.runnable ? "Heads up" : "This tool can't run here"}
            >
              {tool.issues.length > 0 ? (
                <ul className="issue-list">
                  {tool.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                "Its server isn't available on this AlpheSDK host."
              )}
            </Callout>
          )}

          {usable && Object.keys(detail.env).length > 0 && (
            <div ref={keys}>
              <Section title="Keys" sub="The server needs these to run. They stay in this browser.">
                <EnvForm packageName={pkg} env={detail.env} />
              </Section>
            </div>
          )}

          {runner && (
            <Section title="Try it" sub="AlpheSDK starts the server and calls this tool for you.">
              {runner}
            </Section>
          )}

          {usable && (
            <Section title="Use it from code" sub="Call the tool over REST, or connect a client.">
              <ConnectPanel
                clients={CLIENTS}
                servers={[
                  {
                    name: slugify(pkg),
                    packageName: pkg,
                    url: gatewayUrl(detail.connect.gatewayPath),
                    env: detail.env,
                    values,
                    stdio: detail.connect.stdio,
                    tool: { name: tool.mcp.tool },
                  },
                ]}
              />
            </Section>
          )}
        </div>

        <aside className="detail-aside">
          <Facts items={facts} />
          {tool.server && (
            <section className="detail-aside-card">
              <h2 className="facts-title">Provided by</h2>
              <ItemCard item={fromServer(tool.server)} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export function ToolPage() {
  const { route } = useWin();
  const key = route.params.id ?? "";
  const tool = useAsync((signal) => getTool(key, signal), [key]);
  const data = tool.data;
  useWindowTitle(data?.name);

  useEffect(() => {
    if (data) markStep("inspect");
  }, [data]);

  if (tool.error) {
    return (
      <DetailError
        what="Tool"
        name={key}
        error={tool.error}
        onRetry={tool.reload}
        back={{ href: paths.explore({ type: "tool" }), label: "Browse tools" }}
      />
    );
  }
  if (!data) return <DetailSkeleton />;
  return <ToolView tool={data} />;
}
