import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  Info,
  KeyRound,
  Lock,
  Plug,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useEffect } from "react";
import { getServer } from "../lib/api";
import { firstLine, httpUrl, isSecretKey, plural, slugify, truncate } from "../lib/format";
import { fromServer } from "../lib/items";
import { gatewayUrl } from "../lib/snippets";
import { envValues, markStep, missingKeys, useEnvValues } from "../lib/state";
import type { ServerDetail } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { ConnectPanel } from "../ui/ConnectPanel";
import {
  Badge,
  Button,
  ButtonLink,
  buttonClass,
  Callout,
  CopyButton,
  Section,
  Tabs,
} from "../ui/core";
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
import { ToolRunner } from "../ui/ToolRunner";
import { ExternalA, Link } from "../wm/Link";
import { paths, type ServerTab, type SetupStep } from "../wm/routes";
import { useRouteQuery, useWin, useWindowTitle } from "../wm/WindowManager";

const TABS: ServerTab[] = ["overview", "tools", "setup"];
const SETUP: SetupStep[] = ["configure", "test", "connect"];
const PREVIEW_TOOLS = 6;

const STEP: Record<SetupStep, { label: string; title: string; text: string }> = {
  configure: {
    label: "Configure",
    title: "Add the keys it needs",
    text: "Keys stay in this browser and go to the server only when it runs.",
  },
  test: {
    label: "Test",
    title: "Run a tool",
    text: "AlpheSDK starts the server and calls the tool, so you can check it works before connecting.",
  },
  connect: {
    label: "Connect",
    title: "Connect your MCP client",
    text: "Copy a config. Your client reaches the server through the AlpheSDK gateway.",
  },
};

/** Tab, step and tool live in the window URL, so every state can be linked to. */
type Go = (to: { tab?: ServerTab; step?: SetupStep; tool?: string }, replace?: boolean) => void;

function stepStatus(server: ServerDetail, missing: string[]): Record<SetupStep, string> {
  let configure = "All required keys set";
  if (!Object.keys(server.env).length) configure = "No keys needed";
  else if (missing.length) configure = `${plural(missing.length, "key")} missing`;
  return {
    configure,
    test: "Run a tool and check the output",
    connect: "Copy a config for your client",
  };
}

function SetupSteps({
  status,
  current,
  onPick,
}: {
  status: Record<SetupStep, string>;
  current?: SetupStep;
  onPick(step: SetupStep): void;
}) {
  return (
    <ol className="wizard" aria-label="Setup steps">
      {SETUP.map((key, index) => (
        <li key={key}>
          <button
            type="button"
            className="wizard-step"
            aria-current={key === current ? "step" : undefined}
            onClick={() => onPick(key)}
          >
            <span className="wizard-num" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="wizard-label">{STEP[key].label}</span>
            <span className="wizard-text">{status[key]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function EnvList({ server }: { server: ServerDetail }) {
  const values = useEnvValues(server.packageName);
  return (
    <ul className="env-list">
      {Object.entries(server.env).map(([name, spec]) => {
        const saved = Boolean(values[name]?.trim());
        const needed = spec.required && !spec.default;
        return (
          <li key={name} className="env-item">
            <div className="env-item-head">
              <code className="env-name">{name}</code>
              <Badge>{spec.required ? "Required" : "Optional"}</Badge>
              {isSecretKey(name, spec) && <Badge icon={Lock}>Secret</Badge>}
              {saved && (
                <Badge tone="green" icon={ShieldCheck}>
                  Saved
                </Badge>
              )}
              {!saved && needed && (
                <Badge tone="yellow" icon={KeyRound}>
                  Missing
                </Badge>
              )}
            </div>
            {spec.description && <p className="env-desc">{spec.description}</p>}
            {spec.default && (
              <p className="env-desc">
                Default: <code>{spec.default}</code>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Overview({ server, go }: { server: ServerDetail; go: Go }) {
  const pkg = server.packageName;
  const values = useEnvValues(pkg);
  const missing = missingKeys(server.env, values);
  const hasEnv = Object.keys(server.env).length > 0;
  const preview = server.tools.slice(0, PREVIEW_TOOLS);
  const { config } = server;
  const readme = httpUrl(config.readme);
  const license = config.license && config.license !== "unknown" ? config.license : undefined;

  const facts: Fact[] = [{ label: "Package", value: <code>{pkg}</code> }];
  if (config.packageVersion) facts.push({ label: "Version", value: config.packageVersion });
  facts.push({ label: "Runtime", value: server.runtime });
  facts.push({
    label: "Category",
    value: (
      <Link href={paths.explore({ type: "mcp", category: server.category })} className="link">
        {server.categoryName || server.category}
      </Link>
    ),
  });
  if (server.author) facts.push({ label: "Author", value: server.author });
  if (license) facts.push({ label: "License", value: license });
  facts.push({
    label: "Transport",
    value: server.remote ? "Remote (HTTP)" : "Local process (stdio)",
  });
  facts.push({ label: "Gateway", value: <code>{server.connect.gatewayPath}</code> });
  if (readme) {
    facts.push({
      label: "README",
      value: (
        <ExternalA href={readme} className="link">
          Open README
          <ExternalLink size={12} aria-hidden="true" />
        </ExternalA>
      ),
    });
  }

  let toolsLink: { label: string; href: string } | undefined;
  if (!server.blocked) {
    toolsLink = {
      label: server.toolCount > PREVIEW_TOOLS ? `All ${server.toolCount} tools` : "Open the runner",
      href: paths.server(pkg, { tab: "tools" }),
    };
  }

  return (
    <div className="detail-body">
      <div className="detail-main">
        {server.blocked ? (
          <Callout kind="danger" title="Blocked on this host">
            {server.blockReason ?? "This server can't run here. You can still read about it."}
          </Callout>
        ) : (
          <Section title="Set up in three steps" sub="Add keys, run a tool, then connect a client.">
            <SetupSteps
              status={stepStatus(server, missing)}
              onPick={(step) => go({ tab: "setup", step })}
            />
          </Section>
        )}

        <Section title="Tools" link={toolsLink}>
          {preview.length ? (
            <ul className="tool-list">
              {preview.map((tool) => (
                <li key={tool.name}>
                  <Link
                    href={paths.server(pkg, { tab: "tools", tool: tool.name })}
                    className="tool-row"
                  >
                    <Wrench size={15} aria-hidden="true" />
                    <span className="tool-row-text">
                      <code className="tool-row-name">{tool.name}</code>
                      {tool.description && (
                        <span className="tool-row-desc">
                          {truncate(firstLine(tool.description), 140)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {server.blocked
                ? "No tool list is available for this server."
                : "No tool list is cached yet. Open the runner to start the server and list them."}
            </p>
          )}
        </Section>

        <Section
          title="Keys"
          sub={hasEnv ? "Environment variables the server reads when it starts." : undefined}
          link={
            hasEnv && !server.blocked
              ? {
                  label: missing.length ? "Add keys" : "Edit keys",
                  href: paths.server(pkg, { tab: "setup", step: "configure" }),
                }
              : undefined
          }
        >
          {hasEnv ? (
            <EnvList server={server} />
          ) : (
            <p className="muted">This server needs no keys.</p>
          )}
        </Section>
      </div>

      <aside className="detail-aside">
        <Facts items={facts} />
      </aside>
    </div>
  );
}

function Setup({
  server,
  step,
  tool,
  go,
}: {
  server: ServerDetail;
  step: SetupStep;
  tool?: string;
  go: Go;
}) {
  const pkg = server.packageName;
  const values = useEnvValues(pkg);
  const missing = missingKeys(server.env, values);
  const ready = !server.blocked && missing.length === 0;

  // Nothing left to fill in counts as configured (the starter server needs no keys).
  useEffect(() => {
    if (ready) markStep("configure");
  }, [ready]);

  if (server.blocked) {
    return (
      <Callout kind="danger" title="This server can't be set up">
        {server.blockReason ?? "It is blocked on this AlpheSDK host."}
      </Callout>
    );
  }

  const index = SETUP.indexOf(step);
  const prev = SETUP[index - 1];
  const next = SETUP[index + 1];
  const toStep = (target: SetupStep) => go({ tab: "setup", step: target, tool });
  const example = tool ?? server.tools[0]?.name;

  return (
    <div className="wizard-flow">
      <SetupSteps status={stepStatus(server, missing)} current={step} onPick={toStep} />

      <div className="wizard-panel">
        <div>
          <h2 className="section-title">{STEP[step].title}</h2>
          <p className="section-sub">{STEP[step].text}</p>
        </div>
        {step === "configure" && (
          <EnvForm
            packageName={pkg}
            env={server.env}
            onSaved={() => {
              if (!missingKeys(server.env, envValues(pkg)).length) toStep("test");
            }}
          />
        )}
        {step === "test" && (
          <ToolRunner
            server={server}
            selected={tool}
            onSelect={(name) => go({ tab: "setup", step: "test", tool: name }, true)}
            onNeedKeys={() => toStep("configure")}
          />
        )}
        {step === "connect" && (
          <ConnectPanel
            servers={[
              {
                name: slugify(pkg),
                packageName: pkg,
                url: gatewayUrl(server.connect.gatewayPath),
                env: server.env,
                values,
                stdio: server.connect.stdio,
                tool: example ? { name: example } : undefined,
              },
            ]}
          />
        )}
      </div>

      <div className="wizard-nav">
        {prev && (
          <Button icon={ArrowLeft} onClick={() => toStep(prev)}>
            Back
          </Button>
        )}
        {next ? (
          <Button variant="primary" iconRight={ArrowRight} onClick={() => toStep(next)}>
            Next: {STEP[next].label}
          </Button>
        ) : (
          <ButtonLink
            variant="primary"
            icon={Bot}
            href={paths.playground({ mode: "agent", servers: pkg })}
          >
            Try it with an agent
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

function ServerView({ server }: { server: ServerDetail }) {
  const win = useWin();
  const query = useRouteQuery();
  const pkg = server.packageName;
  const tab = TABS.find((key) => key === query.get("tab")) ?? "overview";
  const step = SETUP.find((key) => key === query.get("step")) ?? "configure";
  const tool = query.get("tool") || undefined;
  const source = httpUrl(server.config.url);

  const go: Go = (to, replace = false) =>
    win.navigate(paths.server(pkg, { ...to, tab: to.tab === "overview" ? undefined : to.tab }), {
      replace,
    });

  return (
    <div className="page detail">
      <DetailHead
        name={server.name}
        sub={
          <>
            <code className="truncate">{pkg}</code>
            <CopyButton text={pkg} label="Copy package name" />
          </>
        }
        actions={
          <>
            {!server.blocked && (
              <Button variant="primary" icon={Plug} onClick={() => go({ tab: "setup" })}>
                Set up
              </Button>
            )}
            <StackButton type="mcp" id={pkg} name={server.name} />
            {source && (
              <ExternalA href={source} className={buttonClass("ghost")}>
                <ExternalLink size={16} aria-hidden="true" />
                Source
              </ExternalA>
            )}
          </>
        }
      />

      <div className="detail-intro">
        {server.description && <p className="page-lead">{server.description}</p>}
        <div className="badge-row">
          {itemBadges(fromServer(server))}
          {server.oauth && (
            <Badge tone="purple" icon={KeyRound}>
              OAuth
            </Badge>
          )}
        </div>
      </div>

      <Tabs<ServerTab>
        label="Server sections"
        items={[
          { key: "overview", label: "Overview", icon: Info },
          { key: "tools", label: "Tools", icon: Wrench, count: server.toolCount || undefined },
          { key: "setup", label: "Set up", icon: Plug },
        ]}
        value={tab}
        onChange={(key) => go({ tab: key, tool: key === "overview" ? undefined : tool })}
      >
        {tab === "overview" && <Overview server={server} go={go} />}
        {tab === "tools" && (
          <ToolRunner
            server={server}
            selected={tool}
            onSelect={(name) => go({ tab: "tools", tool: name }, true)}
            onNeedKeys={() => go({ tab: "setup", step: "configure" })}
          />
        )}
        {tab === "setup" && <Setup server={server} step={step} tool={tool} go={go} />}
      </Tabs>
    </div>
  );
}

/** One MCP server: overview, a live tool runner and a Configure → Test → Connect wizard. */
export function ServerPage() {
  const { route } = useWin();
  const pkg = route.params.id ?? "";
  const server = useAsync((signal) => getServer(pkg, signal), [pkg]);
  const data = server.data;

  useWindowTitle(data?.name);
  useEffect(() => {
    if (data) markStep("inspect");
  }, [data]);

  if (server.error) {
    return (
      <DetailError
        what="Server"
        name={pkg}
        error={server.error}
        onRetry={server.reload}
        back={{ href: paths.explore({ type: "mcp" }), label: "Browse MCP servers" }}
      />
    );
  }
  if (!data) return <DetailSkeleton />;
  return <ServerView server={data} />;
}
