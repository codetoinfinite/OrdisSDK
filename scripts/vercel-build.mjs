// Builds the Vercel deployment into .vercel/output (Vercel Build Output API v3). vercel.json runs it
// after `pnpm --dir web build`; run both locally to inspect the result.
//   static/              the web app (web/dist)
//   functions/api.func/  the registry API as one Node.js function: src/api/vercel.ts bundled by
//                        esbuild, the npm packages it imports, and the data files it reads at runtime
// The root node_modules isn't needed (it mostly holds MCP server packages, which can't run on
// Vercel): npm packages stay out of the bundle and are installed into the function at the versions
// pinned in pnpm-lock.yaml.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESBUILD_VERSION = "0.27.1";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, ".vercel/output");
const fn = path.join(output, "functions/api.func");
const webDist = path.join(root, "web/dist");
const nodeMajor = process.versions.node.split(".")[0];

/** What the API reads from disk at runtime, relative to the repo root and to the function root. */
const RUNTIME_FILES = [
  "packages",
  "indexes",
  "config",
  "agents",
  "tools",
  "src/domains/oauth/demo-oauth.html",
  "python-mcp/pyproject.toml",
];

/** Requests the API answers; everything else is the web app. Mirrors API_PATHS in src/api/web-app.ts. */
const API_ROUTE = "^/(?:api|mcp|swagger|demo)(?:/.*)?$";

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const npm = (cwd, args) =>
  execFileSync("npm", [...args, "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd,
    stdio: "inherit",
  });

/** Exact versions of the root package's direct dependencies, read from pnpm-lock.yaml (v9). */
function lockedVersions(lockfile) {
  const versions = new Map();
  let inImporters = false;
  let inRoot = false;
  let name = null;
  for (const line of readFileSync(lockfile, "utf8").split("\n")) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^\S/.test(line)) break;
    if (/^ {2}\S/.test(line)) {
      inRoot = line.trim() === ".:";
      continue;
    }
    if (!inRoot) continue;
    const dependency = line.match(/^ {6}(\S.*):$/);
    if (dependency) {
      name = dependency[1].replace(/^'|'$/g, "");
      continue;
    }
    const version = line.match(/^ {8}version: (.*)$/);
    if (version && name) versions.set(name, version[1].replace(/^'|'$/g, "").replace(/\(.*$/, ""));
  }
  return versions;
}

/**
 * A bundle has one import.meta.url, but modules under src/ resolve data files from their own
 * location (getDirname(import.meta.url)). Point each module's import.meta.url at where the module
 * would sit in the function, which mirrors the repo layout.
 */
const moduleUrlPlugin = {
  name: "module-import-meta-url",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!source.includes("import.meta.url")) return undefined;
      const fromRoot = path.relative(root, args.path).split(path.sep).join("/");
      return {
        contents: source.replaceAll(
          "import.meta.url",
          `new URL(${JSON.stringify(fromRoot)}, import.meta.url).href`,
        ),
        loader: "ts",
      };
    });
  },
};

function sizeOf(target) {
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(target).reduce((sum, entry) => sum + sizeOf(path.join(target, entry)), 0);
}

if (!existsSync(path.join(webDist, "index.html"))) {
  throw new Error("web/dist/index.html is missing: run `pnpm --dir web build` first.");
}
rmSync(output, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// esbuild comes from a scratch directory, so the build doesn't need the root dependencies installed.
const toolsDir = mkdtempSync(path.join(tmpdir(), "vercel-build-"));
try {
  writeJson(path.join(toolsDir, "package.json"), { private: true });
  npm(toolsDir, ["install", "--no-save", "--no-package-lock", `esbuild@${ESBUILD_VERSION}`]);
  const esbuild = createRequire(path.join(toolsDir, "package.json"))("esbuild");

  const result = await esbuild.build({
    entryPoints: [path.join(root, "src/api/vercel.ts")],
    outfile: path.join(fn, "index.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: `node${nodeMajor}`,
    packages: "external",
    metafile: true,
    logLevel: "warning",
    plugins: [moduleUrlPlugin],
  });

  const imported = new Set();
  for (const bundle of Object.values(result.metafile.outputs)) {
    for (const { path: specifier, external } of bundle.imports) {
      if (!external || specifier.startsWith("node:") || builtinModules.includes(specifier))
        continue;
      const parts = specifier.split("/");
      imported.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  }

  const locked = lockedVersions(path.join(root, "pnpm-lock.yaml"));
  const dependencies = {};
  for (const name of [...imported].sort()) {
    const version = locked.get(name);
    if (!version || !/^\d/.test(version)) {
      throw new Error(
        `${name} is imported by the API but has no pinned version in pnpm-lock.yaml.`,
      );
    }
    dependencies[name] = version;
  }

  // catalog-repository reads the version from the package.json at the function root.
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeJson(path.join(fn, "package.json"), {
    name: "alphesdk-api",
    version,
    private: true,
    type: "module",
    dependencies,
  });
  npm(fn, ["install", "--omit=dev", "--no-package-lock", "--ignore-scripts", "--no-bin-links"]);
} finally {
  rmSync(toolsDir, { recursive: true, force: true });
}

for (const file of RUNTIME_FILES) {
  cpSync(path.join(root, file), path.join(fn, file), { recursive: true });
}

writeJson(path.join(fn, ".vc-config.json"), {
  runtime: `nodejs${nodeMajor}.x`,
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  environment: { NODE_ENV: "production" },
});

cpSync(webDist, path.join(output, "static"), { recursive: true });

writeJson(path.join(output, "config.json"), {
  version: 3,
  routes: [
    { src: API_ROUTE, dest: "/api" },
    { handle: "filesystem" },
    // Like the local server: a missing build file is a 404, not the app's HTML.
    { src: "^/assets/", status: 404 },
    { src: "^/(.*)$", dest: "/index.html" },
  ],
});

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(
  `Vercel output ready: function ${mb(sizeOf(fn))} (limit 250 MB unzipped), ` +
    `static ${mb(sizeOf(path.join(output, "static")))}, runtime nodejs${nodeMajor}.x`,
);
