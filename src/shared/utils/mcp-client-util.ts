import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerPackageConfig } from "../../domains/package/package-types";
import { BlockedPackageError, isBlocked } from "./blocklist-util";
import { getDirname } from "./file-util";

const __dirname = getDirname(import.meta.url);

function isInstalled(packageName: string) {
  return fs.existsSync(path.join(__dirname, "../../../node_modules", packageName, "package.json"));
}

export function getPackageJSON(packageName: string) {
  const packageJSONFilePath = path.join(
    __dirname,
    "../../../node_modules",
    packageName,
    "package.json",
  );

  if (!fs.existsSync(packageJSONFilePath)) {
    throw new Error(
      `Package '${packageName}' not found in node_modules. Install it first with: pnpm add ${packageName}`,
    );
  }

  const packageJSONStr = fs.readFileSync(packageJSONFilePath, "utf8");
  const packageJSON = JSON.parse(packageJSONStr);
  return packageJSON;
}

type LaunchConfig = Pick<
  MCPServerPackageConfig,
  "packageName" | "packageVersion" | "bin" | "binArgs" | "withPackages"
>;

/** `npx` args that fetch and run a node package on demand (`bin` = command inside the package). */
export function getNpxArgs(config: LaunchConfig): string[] {
  const { packageName, packageVersion, bin } = config;
  const spec = packageVersion ? `${packageName}@${packageVersion}` : packageName;
  return ["-y", ...(bin ? ["-p", spec, bin] : [spec]), ...(config.binArgs || [])];
}

/** `uvx` (= `uv tool run`) args; `bin` = console script name when it differs from the package. */
export function getUvxArgs(config: LaunchConfig): string[] {
  const { packageName, packageVersion, bin } = config;
  const from = packageVersion ? `${packageName}==${packageVersion}` : packageName;
  const withArgs = (config.withPackages || []).flatMap((req) => ["--with", req]);
  return [...withArgs, "--from", from, bin || packageName, ...(config.binArgs || [])];
}

/** How much of a local server's stderr a failed start keeps for its error message. */
const STDERR_TAIL = 2000;

/** Starts a local server over stdio, with stderr piped so createMcpClient can report it. */
function stdio(params: StdioServerParameters) {
  return new StdioClientTransport({ ...params, stderr: "pipe" });
}

async function createMcpClient(mcpServerConfig: MCPServerPackageConfig, transport: Transport) {
  const { packageName, name } = mcpServerConfig;

  // A local server's stderr still goes to the log. If the server exits while starting, the end
  // of it joins the error, since it usually says why (a yanked package, a rejected key).
  let stderrTail = "";
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
    });
  }

  const client = new Client(
    {
      name: `mcp-server-${name}-client`,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  try {
    await client.connect(transport);
  } catch (error) {
    const reason = stderrTail.trim();
    if (reason && error instanceof Error) error.message += `\n${reason}`;
    throw error;
  }

  const closeConnection = async () => {
    try {
      await client.close();
    } catch (e) {
      console.warn(`${packageName} mcp client close failure.`, e);
    }

    // Close transport to release child process and file descriptors
    try {
      await transport.close();
    } catch (e) {
      console.warn(`${packageName} mcp transport close failure.`, e);
    }
  };

  return { client, transport, closeConnection };
}

async function getNodeMcpClient(
  mcpServerConfig: MCPServerPackageConfig,
  env?: Record<string, string>,
) {
  const { packageName } = mcpServerConfig;
  const binArgs = mcpServerConfig.binArgs || [];

  // Not preinstalled: fetch and run on demand from npm (`bin` = command name inside the package)
  if (!isInstalled(packageName)) {
    const transport = stdio({
      command: "npx",
      args: getNpxArgs(mcpServerConfig),
      env: env || {},
    });
    return createMcpClient(mcpServerConfig, transport);
  }

  const packageJSON = getPackageJSON(packageName);
  let binFilePath = "";
  let binPath: string | undefined;

  if (typeof packageJSON.bin === "string") {
    binPath = packageJSON.bin;
  } else if (typeof packageJSON.bin === "object") {
    binPath = Object.values(packageJSON.bin)[0] as string | undefined;
  } else {
    binPath = packageJSON.main;
  }
  assert(binPath, `Package ${packageName} does not have a valid bin path in package.json.`);

  binFilePath = path.join(__dirname, "../../../node_modules", packageName, binPath);

  const mcpServerBinPath = mcpServerConfig.bin || binFilePath;
  const transport = stdio({
    args: [mcpServerBinPath, ...binArgs],
    command: process.execPath,
    env: env || {},
  });

  return createMcpClient(mcpServerConfig, transport);
}

async function getDockerMcpClient(
  mcpServerConfig: MCPServerPackageConfig,
  env?: Record<string, string>,
) {
  const { binArgs } = mcpServerConfig;

  const args = binArgs || [];
  const transport = stdio({
    command: "docker",
    args,
    // Only caller envs; the SDK adds PATH/HOME etc. Never forward the registry's own secrets.
    env: env || {},
  });

  return createMcpClient(mcpServerConfig, transport);
}

async function getPyMcpClient(
  mcpServerConfig: MCPServerPackageConfig,
  env?: Record<string, string>,
) {
  // Run each package in its own isolated env via uvx: the shared python-mcp project
  // can't resolve (it pins a yanked PyPI release), so `uv run --directory python-mcp` fails.
  const transport = stdio({
    command: "uv",
    args: ["tool", "run", ...getUvxArgs(mcpServerConfig)],
    // Only caller envs; the SDK adds PATH/HOME etc. Never forward the registry's own secrets.
    env: env || {},
  });

  return createMcpClient(mcpServerConfig, transport);
}

async function getGoMcpClient(
  mcpServerConfig: MCPServerPackageConfig,
  env?: Record<string, string>,
) {
  const { packageName, packageVersion } = mcpServerConfig;
  // `go run pkg@version` builds once into the Go cache, then starts fast
  const transport = stdio({
    command: "go",
    args: [
      "run",
      `${packageName}@${packageVersion || "latest"}`,
      ...(mcpServerConfig.binArgs || []),
    ],
    env: env || {},
  });
  return createMcpClient(mcpServerConfig, transport);
}

async function getRemoteMcpClient(
  url: string,
  mcpServerConfig: MCPServerPackageConfig,
  accessToken?: string,
) {
  const opts: { requestInit?: RequestInit } = {};

  // Add OAuth access token to Authorization header if provided
  if (accessToken) {
    opts.requestInit = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), opts);
  return createMcpClient(mcpServerConfig, transport);
}

export async function getMcpClient(
  mcpServerConfig: MCPServerPackageConfig,
  env?: Record<string, string>,
  accessToken?: string,
) {
  if (await isBlocked(mcpServerConfig)) {
    throw new BlockedPackageError(mcpServerConfig.key || mcpServerConfig.packageName);
  }

  // Check for remotes first
  if (mcpServerConfig.remotes && mcpServerConfig.remotes.length > 0) {
    const remote = mcpServerConfig.remotes.find((r) => r.type === "streamable-http");
    if (remote) {
      return getRemoteMcpClient(remote.url, mcpServerConfig, accessToken);
    }
  }

  // A Vercel function can't keep a spawned server alive, and the server would run next to the
  // deployment's secrets. Remote servers above still work there; the rest need a real host.
  if (process.env.VERCEL) {
    throw new Error(
      `Vercel can't start local MCP servers (${mcpServerConfig.packageName}). ` +
        "Node packages can run in a sandbox: set MCP_SANDBOX_PROVIDER to SANDOCK, E2B or DAYTONA.",
    );
  }

  const { runtime } = mcpServerConfig;
  if (runtime === "python") {
    return getPyMcpClient(mcpServerConfig, env);
  }
  if (runtime === "docker") {
    return getDockerMcpClient(mcpServerConfig, env);
  }
  if (runtime === "go") {
    return getGoMcpClient(mcpServerConfig, env);
  }
  if (runtime !== "node") {
    // e.g. java: no launcher; falling back to npx would run an unrelated npm package of the same name
    throw new Error(`Runtime "${runtime}" is not supported for ${mcpServerConfig.packageName}`);
  }
  return getNodeMcpClient(mcpServerConfig, env);
}
