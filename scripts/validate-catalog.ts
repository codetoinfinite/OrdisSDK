// Validates the curated catalog: agents/<category>/<key>.json and tools/<category>/<key>.json.
// Errors: invalid JSON, schema errors, a key that differs from the file name, unknown categories,
// duplicate keys, invalid package configs, and agents or tools that reference a server missing from
// the registry, a blocked server, or a tool the server does not list. A folder name that differs
// from the category is a warning. Exits with code 1 when there are errors.

import { Catalog, readCatalogInput } from "../src/domains/catalog/catalog-repository";

const catalog = new Catalog(await readCatalogInput());

const errors = catalog.errors.map((e) => `${e.file}: ${e.message}`);
for (const tool of catalog.tools) {
  for (const issue of tool.issues) errors.push(`tool '${tool.key}': ${issue}`);
}
for (const agent of catalog.agents) {
  for (const issue of agent.issues) errors.push(`agent '${agent.key}': ${issue}`);
}
const warnings = catalog.warnings.map((w) => `${w.file}: ${w.message}`);

for (const message of errors) console.log(`ERROR ${message}`);
for (const message of warnings) console.log(`WARNING ${message}`);
console.log(
  `Catalog validation checked ${catalog.agents.length} agent(s), ${catalog.tools.length} tool(s) ` +
    `and ${catalog.servers.length} server(s): ${errors.length} error(s), ${warnings.length} warning(s).`,
);
if (errors.length) process.exitCode = 1;
