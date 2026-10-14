// Used by the Dockerfile: rewrites package.json so `dependencies` keeps only the packages src/
// imports. The ~680 MCP server packages it also lists (≈ 9 GB installed) are left out; servers that
// aren't installed are fetched on demand with npx, in a sandbox or, when allowed, on the host.
import fs from "node:fs";
import path from "node:path";

const IMPORT = /(?:from|import\()\s*["']([^"'./][^"']*)["']/g;

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(file);
    else if (/\.[cm]?tsx?$/.test(entry.name)) yield file;
  }
}

const used = new Set();
for (const file of sourceFiles("src")) {
  for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(IMPORT)) {
    if (spec.startsWith("node:")) continue;
    used.add(
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    );
  }
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const before = Object.keys(pkg.dependencies).length;
pkg.dependencies = Object.fromEntries(
  Object.entries(pkg.dependencies).filter(([name]) => used.has(name)),
);
fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`dependencies: kept ${Object.keys(pkg.dependencies).length} of ${before}`);
