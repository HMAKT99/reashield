import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(exampleDir, "..", "..");

const { resolveConfig, runPipeline } = await import(pathToFileURL(path.join(repoRoot, "dist", "index.js")).href);
const original = await import(pathToFileURL(path.join(exampleDir, "src", "index.js")).href);

let hardened, serverMod, endpoint, keyEndpoint;

before(async () => {
  const { config, cwd } = await resolveConfig({
    configPath: path.join(exampleDir, "shield.config.cjs"),
    cwd: exampleDir,
  });
  endpoint = config.server.endpoint;
  keyEndpoint = config.server.keyEndpoint;
  const art = await runPipeline({ config, cwd, seed: "auth-seed" });

  const clientPath = path.join(exampleDir, "dist-auth", "index.js");
  const serverDir = path.join(exampleDir, "auth-server");
  mkdirSync(path.dirname(clientPath), { recursive: true });
  writeFileSync(clientPath, art.clientCode);
  mkdirSync(serverDir, { recursive: true });
  for (const [rel, content] of Object.entries(art.serverFiles))
    writeFileSync(path.join(serverDir, rel), content);

  hardened = await import(pathToFileURL(clientPath).href + "?t=" + Date.now());
  serverMod = await import(pathToFileURL(path.join(serverDir, "handlers.js")).href);
});

function webTransport() {
  const base = "http://shield.local";
  return {
    transport: async (payload) => {
      const req = new Request(base + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = await serverMod.webHandler(req);
      if (!res.ok) throw new Error("status " + res.status);
      return res.json();
    },
    keyTransport: async (op) => {
      const req = new Request(base + keyEndpoint + "?op=" + encodeURIComponent(op));
      const res = await serverMod.webHandler(req);
      if (!res.ok) throw new Error("key status " + res.status);
      return (await res.json()).k;
    },
  };
}

test("web adapter: relocate + seal work through a Request/Response handler", async () => {
  serverMod.setAuthVerifier(null);
  const { transport, keyTransport } = webTransport();
  hardened.__configureShield({ transport, keyTransport });
  assert.deepEqual(await hardened.activate("REA-0001"), await original.activate("REA-0001"));
  assert.equal(await hardened.price("pro", 5, 10, 4), await original.price("pro", 5, 10, 4));
});

test("auth seam: good token accepted, bad token rejected (401)", async () => {
  serverMod.setAuthVerifier((t) => t === "good");
  const { transport, keyTransport } = webTransport();

  hardened.__configureShield({ transport, keyTransport, authToken: () => "good" });
  assert.deepEqual(await hardened.activate("REA-0001"), await original.activate("REA-0001"));

  hardened.__configureShield({ transport, keyTransport, authToken: () => "bad" });
  await assert.rejects(() => hardened.activate("REA-0001"), /status 401/);
});

test("web adapter: unknown path is 404", async () => {
  const res = await serverMod.webHandler(new Request("http://shield.local/nope"));
  assert.equal(res.status, 404);
});
