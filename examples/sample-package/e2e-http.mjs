/**
 * Real end-to-end demo: harden the sample package, stand up an actual HTTP
 * server serving the generated handlers, and call the hardened client through
 * its DEFAULT fetch transport (no in-process wiring). Proves relocate + seal
 * work over the network and behavior is identical. No extra deps (node:http).
 *
 *   node examples/sample-package/e2e-http.mjs
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const PORT = Number(process.env.PORT || 8799);

const { runPipeline, normalizeConfig } = await import(
  pathToFileURL(path.join(repo, "dist", "index.js")).href
);
const orig = await import(pathToFileURL(path.join(here, "src", "index.js")).href);

const config = normalizeConfig({
  input: "src/index.js",
  output: "dist-http",
  preset: "balanced",
  protect: [
    { name: "licenseCheck", mode: "relocate" },
    { name: "sealedCalc", mode: "seal" },
    { name: "pricingLogic", mode: "wasm" },
    { name: "featureGate", mode: "obfuscate" },
  ],
  server: {
    out: "server-http",
    adapter: "generic",
    endpoint: `http://127.0.0.1:${PORT}/__s`,
    keyEndpoint: `http://127.0.0.1:${PORT}/__s/k`,
  },
  polymorphic: { enabled: true, seed: "http-demo" },
});

const art = await runPipeline({ config, cwd: here, seed: "http-demo" });
const clientPath = path.join(here, "dist-http", "index.js");
const serverDir = path.join(here, "server-http");
mkdirSync(path.dirname(clientPath), { recursive: true });
writeFileSync(clientPath, art.clientCode);
mkdirSync(serverDir, { recursive: true });
for (const [rel, content] of Object.entries(art.serverFiles))
  writeFileSync(path.join(serverDir, rel), content);

const { handle, getKey } = await import(
  pathToFileURL(path.join(serverDir, "handlers.js")).href
);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && u.pathname === "/__s") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      try {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await handle(JSON.parse(body))));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  } else if (req.method === "GET" && u.pathname === "/__s/k") {
    try {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ k: getKey(u.searchParams.get("op")) }));
    } catch (e) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: String(e) }));
    }
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, r));

const client = await import(pathToFileURL(clientPath).href);
let pass = 0,
  total = 0;
const check = async (label, got, exp) => {
  total++;
  const ok = JSON.stringify(await got) === JSON.stringify(await exp);
  if (ok) pass++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
};

console.log(`REAShield HTTP e2e on :${PORT} (default fetch transport)\n`);
await check("activate('REA-0001')", client.activate("REA-0001"), orig.activate("REA-0001"));
await check("activate('bad')", client.activate("bad"), orig.activate("bad"));
await check("price('pro',5,10,4)", client.price("pro", 5, 10, 4), orig.price("pro", 5, 10, 4));
await check("canUse('sso')", client.canUse("sso"), orig.canUse("sso"));

console.log(`\n  ${pass}/${total} passed — relocate + seal over real HTTP`);
server.close();
process.exit(pass === total ? 0 : 1);
