import { Cloud, SquareTerminal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { API_ORIGIN } from "../lib/config";
import { isSecretKey } from "../lib/format";
import { buildSnippet, CLIENTS, type ClientId, type SnippetServer } from "../lib/snippets";
import { markStep } from "../lib/state";
import { CodeBlock } from "./CodeBlock";
import { Callout, Tabs } from "./core";
import { Checkbox, Segmented } from "./form";

type DesktopMode = "gateway" | "stdio";

const LABEL = Object.fromEntries(CLIENTS.map((client) => [client.id, client.label])) as Record<
  ClientId,
  string
>;

/** How to use each client's snippet; `many` when it holds more than one server. */
const HOW: Record<ClientId, (many: boolean) => ReactNode> = {
  "claude-code": (many) => (
    <>
      Run this in a terminal. {many ? "Each server is" : "The server is"} added for the current
      project; add <code>--scope user</code> to use {many ? "them" : "it"} in every project.
    </>
  ),
  cursor: (many) => (
    <>
      Save this as <code>.cursor/mcp.json</code> in your project, or <code>~/.cursor/mcp.json</code>{" "}
      for every project, then check {many ? "the servers are" : "the server is"} enabled in Cursor's
      MCP settings.
    </>
  ),
  vscode: () => (
    <>
      Save this as <code>.vscode/mcp.json</code> in your workspace. VS Code shows a Start button
      above each server.
    </>
  ),
  "claude-desktop": () => (
    <>
      In Claude Desktop open Settings → Developer → Edit Config and merge this into{" "}
      <code>claude_desktop_config.json</code>.
    </>
  ),
  rest: () => <>Call AlpheSDK straight from a terminal or any HTTP client.</>,
  typescript: () => <>Connect from your own code with the official MCP TypeScript SDK.</>,
};

function hasSavedSecret(server: SnippetServer): boolean {
  return Object.entries(server.values).some(
    ([name, value]) => value.trim() !== "" && isSecretKey(name, server.env[name]),
  );
}

/** Copy-paste configs that connect MCP clients to one or more servers through the gateway. */
export function ConnectPanel({
  servers,
  clients = CLIENTS.map((client) => client.id),
  onCopied,
}: {
  servers: SnippetServer[];
  clients?: ClientId[];
  onCopied?: () => void;
}) {
  const [client, setClient] = useState<ClientId>(clients[0]);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [desktopMode, setDesktopMode] = useState<DesktopMode>("gateway");

  const secrets = servers.some(hasSavedSecret);
  const canStdio = servers.some((server) => server.stdio);
  const snippet = buildSnippet(client, servers, {
    includeSecrets: secrets && includeSecrets,
    desktopMode: canStdio ? desktopMode : "gateway",
  });

  const copied = () => {
    markStep("connect");
    onCopied?.();
  };

  return (
    <div className="connect">
      <Tabs<ClientId>
        label="MCP client"
        items={clients.map((id) => ({ key: id, label: LABEL[id] }))}
        value={client}
        onChange={setClient}
      >
        <div className="connect-body">
          <p className="connect-how">{HOW[client](servers.length > 1)}</p>
          {client === "claude-desktop" && canStdio && (
            <Segmented<DesktopMode>
              label={`How Claude Desktop reaches ${servers.length > 1 ? "the servers" : "the server"}`}
              options={[
                { key: "gateway", label: "Via AlpheSDK gateway", icon: Cloud },
                { key: "stdio", label: "Run locally (stdio)", icon: SquareTerminal },
              ]}
              value={desktopMode}
              onChange={setDesktopMode}
            />
          )}
          <CodeBlock
            code={snippet.code}
            lang={snippet.lang}
            title={snippet.file ?? LABEL[client]}
            onCopy={copied}
            maxHeight={420}
          />
          {snippet.note && <p className="code-note">{snippet.note}</p>}
          {secrets && (
            <Checkbox
              label="Include my keys in the config"
              hint="Off: keys appear as placeholders you fill in yourself."
              checked={includeSecrets}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
            />
          )}
          {secrets && includeSecrets && (
            <Callout kind="warn" title="This config contains your keys">
              Don't commit it or paste it anywhere public.
            </Callout>
          )}
        </div>
      </Tabs>
      <p className="connect-foot">
        Clients connect to the gateway at <code>{API_ORIGIN}</code>. Keep AlpheSDK running while you
        use them.
      </p>
    </div>
  );
}
