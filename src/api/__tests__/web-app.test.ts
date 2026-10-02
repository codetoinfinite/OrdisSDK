import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountWebApp } from "../web-app";

const INDEX_HTML = "<!doctype html><title>AlpheSDK</title>";
// What a browser sends when it opens a page.
const NAV = "text/html,application/xhtml+xml,*/*;q=0.8";

describe("mountWebApp", () => {
  let dist: string;
  let app: Hono;

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "alphesdk-web-"));
    app = new Hono();
    app.get("/api/v1/ping", (c) => c.text("pong"));
    mountWebApp(app, dist, "<p>fallback</p>");
    app.notFound((c) => c.json({ success: false, code: 404 }, 404));
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  const get = async (url: string, accept?: string) => {
    const res = await app.request(url, accept ? { headers: { accept } } : undefined);
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };

  it("serves the fallback page at / while web/dist has no build", async () => {
    expect(await get("/")).toMatchObject({ status: 200, body: "<p>fallback</p>" });
    expect((await get("/")).type).toContain("text/html");
    expect((await get("/servers/x")).status).toBe(404);
    expect(await get("/api/v1/ping")).toMatchObject({ status: 200, body: "pong" });
  });

  it("serves files and falls back to index.html for app routes once built", async () => {
    fs.mkdirSync(path.join(dist, "assets"));
    fs.writeFileSync(path.join(dist, "index.html"), INDEX_HTML);
    fs.writeFileSync(path.join(dist, "assets/app.js"), "console.log(1)");

    for (const url of ["/", "/servers/x", "/agents/math-helper?tab=chat", "/apis"]) {
      const page = await get(url);
      expect(page, url).toMatchObject({ status: 200, body: INDEX_HTML });
      expect(page.type, url).toContain("text/html");
    }
    const script = await get("/assets/app.js");
    expect(script).toMatchObject({ status: 200, body: "console.log(1)" });
    expect(script.type).toContain("javascript");
    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/assets/missing.js", "*/*")).status).toBe(404);

    // Some package names look like file names; opening one in a browser still loads the app.
    for (const url of ["/servers/data.gov.my", "/servers/awslabs.cdk-mcp-server?tab=tools"]) {
      expect(await get(url, NAV), url).toMatchObject({ status: 200, body: INDEX_HTML });
    }
  });

  it("never answers API paths with the web app", async () => {
    fs.writeFileSync(path.join(dist, "index.html"), INDEX_HTML);

    expect((await get("/api/v1/ping")).body).toBe("pong");
    for (const url of ["/api", "/api/v1/unknown", "/mcp/foo", "/swagger", "/demo/x"]) {
      const res = await get(url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain("AlpheSDK");
      expect((await get(url, NAV)).status, url).toBe(404);
    }
  });
});
