import path from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { BlockedPackageError } from "../../shared/utils/blocklist-util";
import { getDirname } from "../../shared/utils/file-util";
import { createTtlCache } from "../../shared/utils/memo-util";
import { createErrorResponse, createResponse } from "../../shared/utils/response-util";
import { ExecutorFactory } from "../executor/executor-factory";
import type { MCPSandboxProvider } from "../sandbox/sandbox-types";
import { PackageRepository } from "./package-repository";
import { PackageSO } from "./package-so";

const __dirname = getDirname(import.meta.url);

const packagesDir = path.join(__dirname, "../../../packages");
export const repository = new PackageRepository(packagesDir);

const TOOLS_CACHE_TTL_MS = 10 * 60 * 1000;
const toolsCache = createTtlCache<Tool[]>(TOOLS_CACHE_TTL_MS);

/**
 * Live tool list of a package. Starting a server is slow, so results are cached for 10 minutes per
 * (packageName, sandboxProvider). Calls with an accessToken are never cached: the list can depend
 * on who is asking.
 */
export function getPackageTools(
  packageName: string,
  sandboxProvider?: MCPSandboxProvider,
  accessToken?: string,
): Promise<Tool[]> {
  const load = async () => {
    const executor = ExecutorFactory.create(sandboxProvider);
    const packageSO = await PackageSO.init(packageName, repository, executor);
    return packageSO.getTools(accessToken);
  };
  if (accessToken) return load();
  return toolsCache.get(`${packageName}|${sandboxProvider ?? ""}`, load);
}

export function clearPackageToolsCache() {
  toolsCache.clear();
}

/** Runs one tool and returns the raw MCP result. Throws on unknown or blocked packages. */
export async function runPackageTool(
  packageName: string,
  toolKey: string,
  inputData: Record<string, unknown>,
  envs?: Record<string, string>,
  sandboxProvider?: MCPSandboxProvider,
  accessToken?: string,
): Promise<unknown> {
  const executor = ExecutorFactory.create(sandboxProvider);
  const packageSO = await PackageSO.init(packageName, repository, executor);
  return packageSO.executeTool(toolKey, inputData, envs, accessToken);
}

export const packageHandler = {
  getPackageDetail: async (packageName: string, sandboxProvider?: MCPSandboxProvider) => {
    try {
      const executor = ExecutorFactory.create(sandboxProvider);
      const packageSO = await PackageSO.init(packageName, repository, executor);
      const result = await packageSO.getDetailWithTools();
      return createResponse(result);
    } catch (error) {
      if (error instanceof BlockedPackageError) {
        return createErrorResponse(error.message, 403);
      }
      if (error instanceof Error && error.message.includes("not found")) {
        return createErrorResponse(`Package '${packageName}' not found`, 404);
      }
      throw error;
    }
  },

  executeTool: async (
    packageName: string,
    toolKey: string,
    inputData: Record<string, unknown>,
    envs?: Record<string, string>,
    sandboxProvider?: MCPSandboxProvider,
    accessToken?: string,
  ) => {
    try {
      const result = await runPackageTool(
        packageName,
        toolKey,
        inputData,
        envs,
        sandboxProvider,
        accessToken,
      );
      return createResponse(result);
    } catch (error) {
      if (error instanceof BlockedPackageError) {
        return createErrorResponse(error.message, 403);
      }
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return createErrorResponse(`Package '${packageName}' not found`, 404);
        }
        if (error.message.includes("Unknown tool")) {
          return createErrorResponse(
            `Tool '${toolKey}' not found in package '${packageName}'`,
            404,
          );
        }
        return createErrorResponse(`Error: ${error.message}`, 500);
      }
      throw error;
    }
  },

  listTools: async (
    packageName: string,
    sandboxProvider?: MCPSandboxProvider,
    accessToken?: string,
  ) => {
    try {
      const tools = await getPackageTools(packageName, sandboxProvider, accessToken);
      return createResponse(tools);
    } catch (error) {
      if (error instanceof BlockedPackageError) {
        return createErrorResponse(error.message, 403);
      }
      if (error instanceof Error && error.message.includes("not found")) {
        return createErrorResponse(`Package '${packageName}' not found`, 404);
      }
      throw error;
    }
  },
};
