// Generates docs/ALL-MCP-SERVERS.md, the full catalog listing.
// 1. Read the category and package indexes (indexes/categories-list.json, indexes/packages-list.json)
// 2. For each category, read its package JSON files under packages/ and validate them with MCPServerPackageConfigSchema
// 3. Render docs/_templates/ALL-MCP-SERVERS.tpl.md with the result
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import _ from "lodash";
import categoriesList from "../indexes/categories-list.json";
import allPackagesList from "../indexes/packages-list.json";
import type { PackagesList } from "../src/shared/scripts-helpers";
import { getDirname, MCPServerPackageConfigSchema } from "../src/shared/scripts-helpers";

const __dirname = getDirname(import.meta.url);

let TOC = "";
let FULL_CATALOG = "";

const COUNT = Object.keys(allPackagesList).length;
const VALIDATED_COUNT = Object.values(allPackagesList as PackagesList).filter(
  (pkg) => pkg.validated,
).length;

for (const [_key, categoryList] of Object.entries(categoriesList)) {
  const packagesList = categoryList.packagesList;

  if (!packagesList || packagesList.length === 0) continue;

  TOC += `  - [${categoryList.config.name}](#${categoryList.config.key})\n`;

  // Sort packages: validated first, then by name (stable sort)
  const sortedPackagesList = [...packagesList].sort((a, b) => {
    const pkgA = (allPackagesList as PackagesList)[a];
    const pkgB = (allPackagesList as PackagesList)[b];

    // First sort by validation status (validated first)
    // Treat undefined as false for consistent comparison
    const validatedA = pkgA.validated === true;
    const validatedB = pkgB.validated === true;

    if (validatedA !== validatedB) {
      return validatedA ? -1 : 1;
    }

    // Then sort by package key (name) - direct comparison for stable ordering
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });

  const totalInCategory = sortedPackagesList.length;
  let categoryFullContent = "";

  for (const packageKey of sortedPackagesList) {
    const packageInfo = (allPackagesList as PackagesList)[packageKey];

    const filePath = join(__dirname, `../packages/`, packageInfo.path);
    const fileContent = readFileSync(filePath, "utf-8");
    const parsedContent = MCPServerPackageConfigSchema.parse(JSON.parse(fileContent));
    const validated = packageInfo.validated ? "✅" : "❌";
    const toolsCount = packageInfo.tools === undefined ? 0 : Object.keys(packageInfo.tools).length;
    const toolsCountLabel = toolsCount > 0 ? ` (${toolsCount} tools)` : "";
    categoryFullContent += `- [${validated} ${parsedContent.key || parsedContent.packageName}](${parsedContent.url || "#"}): ${parsedContent.description} ${toolsCountLabel} (${parsedContent.runtime}) \n`;
  }

  // Full catalog: all servers expanded for better searchability (Ctrl+F)
  FULL_CATALOG += `\n\n<a id="${categoryList.config.key}"></a>\n`;
  FULL_CATALOG += `### ${categoryList.config.name} <small>(${totalInCategory} servers)</small>\n\n`;
  FULL_CATALOG += `> ${categoryList.config.description}\n\n`;
  FULL_CATALOG += categoryFullContent;
  FULL_CATALOG += `\n---\n`;
}

const allServersTemplatePath = join(__dirname, "../docs/_templates/ALL-MCP-SERVERS.tpl.md");
const allServersTemplateContent = readFileSync(allServersTemplatePath, "utf-8");
const compiledAllServers = _.template(allServersTemplateContent);
const finalAllServers = compiledAllServers({
  CONTENT: FULL_CATALOG,
  TOC,
  COUNT,
  VALIDATED_COUNT,
});
writeFileSync(join(__dirname, "../docs/ALL-MCP-SERVERS.md"), finalAllServers, "utf-8");
console.log("docs/ALL-MCP-SERVERS.md has been generated successfully.");
