import { requestListener } from "./app";

// The guard that stops local MCP servers from spawning keys off VERCEL. Set it here so the guard
// doesn't depend on the project exposing system environment variables.
process.env.VERCEL ??= "1";

// Vercel function entry (see scripts/vercel-build.mjs): the whole API as a Node request handler.
export default requestListener;
