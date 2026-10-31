import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * In-process transport for the generated server skeleton. Used by `reashield
 * test` and by host test suites to exercise relocated/sealed code without
 * standing up a real HTTP server — behavior must be identical either way.
 */
export interface InProcessTransport {
  transport: (payload: { op: string; d: string }) => Promise<{ d: string }>;
  keyTransport: (op: string) => Promise<string> | string;
}

export async function makeInProcessTransport(
  serverDir: string,
): Promise<InProcessTransport> {
  const mod = (await import(
    pathToFileURL(path.join(serverDir, "handlers.js")).href
  )) as {
    handle: (p: { op: string; d: string }) => Promise<{ d: string }>;
    getKey: (op: string) => string;
  };
  return {
    transport: (payload) => mod.handle(payload),
    keyTransport: (op) => mod.getKey(op),
  };
}
