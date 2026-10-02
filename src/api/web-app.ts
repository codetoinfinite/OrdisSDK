import fs from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Env, Hono } from "hono";

/** Path prefixes owned by the API; the web app never answers them. */
const API_PATHS = /^\/(api|mcp|swagger|demo)(\/|$)/;

/**
 * Serves the built web app (web/dist) for GET requests outside the API: files as they are, and
 * index.html for app routes so client-side routes survive a reload. A path that looks like a file
 * ("/servers/data.gov.my") gets index.html only when a browser asks for a page, so a missing
 * script or image stays a 404. Without a build, "/" serves `fallbackHtml`. Register it after
 * every other route.
 */
export function mountWebApp<E extends Env>(app: Hono<E>, distDir: string, fallbackHtml: string) {
  const indexFile = path.join(distDir, "index.html");
  // serveStatic only takes roots relative to the working directory.
  const assets = serveStatic({ root: path.relative(process.cwd(), distDir) });
  const isPage = (c: Context) => !API_PATHS.test(c.req.path);
  const wantsHtml = (c: Context) => c.req.header("accept")?.includes("text/html") ?? false;

  app.get("*", async (c, next) => {
    if (!isPage(c) || !fs.existsSync(indexFile)) return next();
    return assets(c, next);
  });

  app.get("*", async (c, next) => {
    if (!isPage(c)) return next();
    if (fs.existsSync(indexFile)) {
      if (path.extname(c.req.path) && !wantsHtml(c)) return next();
      return c.html(fs.readFileSync(indexFile, "utf-8"));
    }
    return c.req.path === "/" ? c.html(fallbackHtml) : next();
  });
}
