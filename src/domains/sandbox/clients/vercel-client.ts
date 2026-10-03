import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Sandbox } from "@vercel/sandbox";
import { getDirname } from "../../../shared/utils/file-util";
import { extractLastOuterJSON } from "../../../shared/utils/string-util";
import { PackageRepository } from "../../package/package-repository";
import type { MCPServerPackageConfig } from "../../package/package-types";
import type {
  MCPExecuteResult,
  MCPToolResult,
  SandboxClient,
  SandboxExecuteResult,
} from "../sandbox-types";
import { generateMCPTestCode } from "../sandbox-utils";

/** Where the generated client scripts run; it holds the MCP SDK they import. */
const WORKDIR = "/vercel/sandbox";
/** Same version as the API's own dependency. */
const MCP_SDK = "@modelcontextprotocol/sdk@1.21.1";

/**
 * Vercel Sandbox Client
 * Implements SandboxClient interface for Vercel Sandbox microVMs. It authenticates with the
 * deployment's OIDC token, so it needs no API key on Vercel; locally, `vercel link` and
 * `vercel env pull` put a token in .env.local.
 */
export class VercelSandboxClient implements SandboxClient {
  private sandbox: Sandbox | null = null;
  private initializing: Promise<void> | null = null;
  private readonly packageRepository: PackageRepository;

  constructor() {
    const __dirname = getDirname(import.meta.url);
    const packagesDir = path.join(__dirname, "../../../../packages");
    this.packageRepository = new PackageRepository(packagesDir);
  }

  async initialize(): Promise<void> {
    if (this.sandbox) {
      return;
    }
    if (this.initializing) {
      await this.initializing;
      return;
    }
    // Without a token, the SDK signs in by itself in a dev terminal (CLI login or a device code it
    // waits up to 5 minutes for) and may create a "vercel-sandbox-default-project".
    if (!process.env.VERCEL && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error(
        "Vercel Sandbox needs VERCEL_OIDC_TOKEN outside Vercel: run `vercel link` and `vercel env pull`.",
      );
    }

    this.initializing = (async () => {
      try {
        // Not persistent: stopping discards the VM instead of snapshotting it. No `env`, so none of
        // the registry's own environment reaches the sandbox. The default 5-minute timeout stops a
        // sandbox whose request died before destroy().
        const sandbox = await Sandbox.create({ persistent: false });
        try {
          const install = await sandbox.runCommand({
            cmd: "npm",
            args: ["install", "--no-audit", "--no-fund", "--ignore-scripts", MCP_SDK],
            cwd: WORKDIR,
          });
          if (install.exitCode !== 0) {
            throw new Error(`Failed to install ${MCP_SDK}: ${await install.output("both")}`);
          }
        } catch (error) {
          await sandbox.stop().catch(() => undefined);
          throw error;
        }

        this.sandbox = sandbox;
        console.log(`[VercelSandboxClient] Sandbox ${sandbox.name} created successfully`);
      } finally {
        this.initializing = null;
      }
    })();

    await this.initializing;
  }

  private async executeCode(code: string): Promise<SandboxExecuteResult> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized. Call initialize() first.");
    }

    const file = `${WORKDIR}/mcp_test_${randomUUID()}.mjs`;
    await this.sandbox.writeFiles([{ path: file, content: code }]);
    // As root: the generated script points PNPM_HOME at /root. The VM is thrown away afterwards.
    const command = await this.sandbox.runCommand({
      cmd: "node",
      args: [file],
      cwd: WORKDIR,
      sudo: true,
    });
    const [stdout, stderr] = await Promise.all([command.stdout(), command.stderr()]);

    return {
      exitCode: command.exitCode,
      result: stdout || stderr,
    };
  }

  async listTools(packageKey: string): Promise<Tool[]> {
    const mcpServerConfig: MCPServerPackageConfig =
      this.packageRepository.getPackageConfig(packageKey);
    const testCode: string = generateMCPTestCode(mcpServerConfig, "listTools");

    const response = await this.executeCode(testCode);

    if (response.exitCode !== 0) {
      throw new Error(`Failed to list tools: ${response.result}`);
    }

    const parsedResultStr = extractLastOuterJSON(response.result);
    const result: MCPToolResult = JSON.parse(parsedResultStr);

    return result.tools;
  }

  async executeTool(
    packageKey: string,
    toolName: string,
    argumentsObj: Record<string, unknown>,
    envs?: Record<string, string>,
  ): Promise<unknown> {
    const mcpServerConfig: MCPServerPackageConfig =
      this.packageRepository.getPackageConfig(packageKey);
    const testCode: string = generateMCPTestCode(
      mcpServerConfig,
      "executeTool",
      toolName,
      argumentsObj,
      envs,
    );

    const response = await this.executeCode(testCode);

    if (response.exitCode !== 0) {
      throw new Error(`Failed to execute tool: ${response.result}`);
    }

    const parsedResultStr = extractLastOuterJSON(response.result);
    const result: MCPExecuteResult = JSON.parse(parsedResultStr);

    if (result.isError) {
      console.error("[VercelSandboxClient] Tool execution error:", result.errorMessage);
      throw new Error(result.errorMessage);
    }

    return result;
  }

  async destroy(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    const sandbox = this.sandbox;
    this.sandbox = null; // Clear immediately to avoid duplicate calls

    // Awaited: Vercel can freeze the function once the response is sent, which would leave the VM
    // running (and billed) until its timeout.
    try {
      await sandbox.stop();
      console.log("[VercelSandboxClient] Sandbox stopped");
    } catch (error) {
      console.warn(
        "[VercelSandboxClient] Warning: Could not stop sandbox:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}
