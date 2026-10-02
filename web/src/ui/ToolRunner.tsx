import { KeyRound, Play, RotateCcw, Search, Square, Wrench } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { liveTools, runTool } from "../lib/api";
import { MOD_LABEL } from "../lib/config";
import { errorMessage, firstLine, isAbort, plural, truncate } from "../lib/format";
import { envValues, markStep, missingKeys, useEnvValues } from "../lib/state";
import type { ServerDetail, ToolInfo, ToolRunResult } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { Button, Callout, Empty, Kbd, Spinner } from "./core";
import { TextInput } from "./form";
import { Markdown } from "./Markdown";
import { SchemaForm, useArgsEditor } from "./SchemaForm";
import { ToolOutput } from "./ToolOutput";

type Outcome =
  | { kind: "result"; result: ToolRunResult; ms: number }
  | { kind: "failed"; message: string }
  | { kind: "stopped" };

function ToolPanel({
  server,
  tool,
  onNeedKeys,
}: {
  server: ServerDetail;
  tool: ToolInfo;
  onNeedKeys?: () => void;
}) {
  const editor = useArgsEditor(tool.inputSchema);
  const values = useEnvValues(server.packageName);
  const missing = missingKeys(server.env, values);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    if (running) return;
    const args = editor.collect();
    if (!args) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setOutcome(undefined);
    const envs = envValues(server.packageName);
    const started = performance.now();
    try {
      const result = await runTool(
        {
          packageName: server.packageName,
          toolKey: tool.name,
          inputData: args,
          envs: Object.keys(envs).length ? envs : undefined,
        },
        abort.signal,
      );
      setOutcome({ kind: "result", result, ms: performance.now() - started });
      if (!result.isError) markStep("test");
    } catch (err) {
      if (isAbort(err)) setOutcome({ kind: "stopped" });
      else setOutcome({ kind: "failed", message: errorMessage(err) });
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void run();
    }
  };

  const status = running
    ? `Running ${tool.name}`
    : outcome?.kind === "result"
      ? outcome.result.isError
        ? `${tool.name} returned an error`
        : `${tool.name} finished`
      : outcome?.kind === "failed"
        ? "Run failed"
        : "";

  return (
    <div className="runner-panel">
      <header className="runner-panel-head">
        <h3 className="runner-panel-title">
          <Wrench size={16} aria-hidden="true" />
          <code>{tool.name}</code>
        </h3>
        {tool.description && <Markdown source={tool.description} className="runner-panel-desc" />}
      </header>

      {missing.length > 0 && (
        <Callout
          kind="warn"
          title={`${plural(missing.length, "required key")} not set`}
          action={
            onNeedKeys && (
              <Button size="sm" icon={KeyRound} onClick={onNeedKeys}>
                Add keys
              </Button>
            )
          }
        >
          This server needs <code>{missing.join(", ")}</code>. You can still try the tool, but it
          will probably fail.
        </Callout>
      )}

      <form className="runner-form" noValidate onSubmit={onSubmit} onKeyDown={onKeyDown}>
        <SchemaForm editor={editor} />
        <div className="runner-actions">
          <Button type="submit" variant="primary" icon={Play} loading={running}>
            {running ? "Running…" : "Run tool"}
          </Button>
          {running ? (
            <Button icon={Square} onClick={() => controller.current?.abort()}>
              Stop waiting
            </Button>
          ) : (
            <Button variant="ghost" icon={RotateCcw} onClick={editor.reset}>
              Reset
            </Button>
          )}
          <span className="runner-hint">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>Enter</Kbd> runs
          </span>
        </div>
      </form>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      {outcome?.kind === "result" && <ToolOutput result={outcome.result} ms={outcome.ms} />}
      {outcome?.kind === "failed" && (
        <Callout kind="danger" title="Run failed">
          <pre className="out-text">{outcome.message}</pre>
        </Callout>
      )}
      {outcome?.kind === "stopped" && (
        <p className="runner-note">Stopped waiting. The server may still finish the call.</p>
      )}
    </div>
  );
}

/**
 * Lists a server's tools (starting the server to get input schemas) and runs the selected one.
 * The selection lives in the caller (the window URL), so links can point at a tool.
 * `single` shows only the selected tool, without the list (tool pages).
 */
export function ToolRunner({
  server,
  selected,
  onSelect,
  onNeedKeys,
  single = false,
}: {
  server: ServerDetail;
  selected?: string;
  onSelect?: (name: string) => void;
  onNeedKeys?: () => void;
  single?: boolean;
}) {
  const live = useAsync((signal) => liveTools(server.packageName, signal), [server.packageName], {
    skip: server.blocked,
  });
  const [filter, setFilter] = useState("");

  if (server.blocked) {
    return (
      <Callout kind="danger" title="This server is blocked">
        {server.blockReason ?? "It can't run on this AlpheSDK host."}
      </Callout>
    );
  }

  if (live.loading && !live.data) {
    return (
      <div className="loading-block">
        <Spinner showLabel label="Starting the server… the first start can take up to a minute." />
      </div>
    );
  }

  // Without a live list, fall back to the cached names (no input schemas, so JSON input).
  const tools = live.data ?? server.tools;
  if (!tools.length) {
    if (!live.error) return <Empty icon={Wrench} title="This server lists no tools" />;
    // Listing starts the server with placeholder keys, and many servers stop on a fake key.
    const keyed = Object.keys(server.env).length > 0;
    return (
      <Callout
        kind="danger"
        title="Couldn't start the server"
        action={
          <>
            {keyed && onNeedKeys && (
              <Button size="sm" icon={KeyRound} onClick={onNeedKeys}>
                Add keys
              </Button>
            )}
            <Button size="sm" icon={RotateCcw} onClick={live.reload}>
              Retry
            </Button>
          </>
        }
      >
        {keyed && (
          <p>
            To list tools, AlpheSDK starts the server with placeholder keys. If the message below is
            about a key, the server may still work with your real ones: add them, then connect a
            client.
          </p>
        )}
        <pre className="out-text">{errorMessage(live.error)}</pre>
      </Callout>
    );
  }

  const warning = live.error && (
    <Callout
      kind="warn"
      title="Couldn't start the server"
      className="runner-warning"
      action={
        <Button size="sm" icon={RotateCcw} onClick={live.reload}>
          Retry
        </Button>
      }
    >
      Showing the cached tool list, without input forms. Enter arguments as JSON.{" "}
      {truncate(errorMessage(live.error), 300)}
    </Callout>
  );

  if (single) {
    const tool = tools.find((item) => item.name === selected);
    return (
      <div className="runner is-single">
        {warning}
        {tool ? (
          <ToolPanel
            key={live.data ? "live" : "cached"}
            server={server}
            tool={tool}
            onNeedKeys={onNeedKeys}
          />
        ) : (
          <Callout kind="warn" title="The server doesn't offer this tool">
            {server.name} lists no tool called <code>{selected}</code>. It may have been renamed or
            removed.
          </Callout>
        )}
      </div>
    );
  }

  const query = filter.trim().toLowerCase();
  const shown = query
    ? tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          tool.description?.toLowerCase().includes(query),
      )
    : tools;
  const current = tools.find((tool) => tool.name === selected) ?? tools[0];

  return (
    <div className="runner">
      {warning}

      <nav className="runner-list" aria-label="Tools">
        {tools.length > 8 && (
          <TextInput
            icon={Search}
            placeholder={`Filter ${tools.length} tools`}
            aria-label="Filter tools"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}
        <ul>
          {shown.map((tool) => (
            <li key={tool.name}>
              <button
                type="button"
                className="runner-tool"
                aria-current={tool.name === current.name ? "true" : undefined}
                onClick={() => onSelect?.(tool.name)}
              >
                <span className="runner-tool-name">{tool.name}</span>
                {tool.description && (
                  <span className="runner-tool-desc">
                    {truncate(firstLine(tool.description), 90)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!shown.length && <p className="runner-note">No tools match “{filter.trim()}”.</p>}
      </nav>

      <ToolPanel
        key={`${current.name}:${live.data ? "live" : "cached"}`}
        server={server}
        tool={current}
        onNeedKeys={onNeedKeys}
      />
    </div>
  );
}
