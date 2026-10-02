/**
 * Origin shown in copyable snippets. The app always calls relative paths; in dev Vite proxies
 * /api, /mcp and /swagger to the API, so the page's own origin works from any machine that can
 * open the page.
 */
export const API_ORIGIN = window.location.origin;

/** Demo server that needs no keys; the Get started flow uses it. */
export const STARTER_SERVER = "@modelcontextprotocol/server-everything";
export const STARTER_AGENT = "everything-tester";

/** Modifier key shown in shortcut hints. */
export const MOD_LABEL = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
