import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(exampleDir, "..", "..");

const { rollup } = await import(pathToFileURL(path.join(repoRoot, "node_modules/rollup/dist/rollup.js")).href);
const { reashieldRollup } = await import(pathToFileURL(path.join(repoRoot, "dist", "plugins.js")).href);
const { makeInProcessTransport } = await import(pathToFileURL(path.join(repoRoot, "dist", "index.js")).href);
const original = await import(pathToFileURL(path.join(exampleDir, "src", "index.js")).href);

const outDir = path.join(exampleDir, "dist-rollup");
const serverDir = path.join(exampleDir, "rollup-server");
let hardened, clientCode;

before(async () => {
  const bundle = await rollup({
    input: path.join(exampleDir, "src", "index.js"),
    plugins: [
      reashieldRollup({
        cwd: exampleDir,
        seed: "rollup-seed",
        config: {
          input: "src/index.js",
          preset: "balanced",
          protect: [
            { name: "licenseCheck", mode: "relocate" },
            { name: "sealedCalc", mode: "seal" },
            { name: "pricingLogic", mode: "wasm" },
            { name: "featureGate", mode: "obfuscate" },
          ],
          server: { out: "rollup-server", adapter: "generic", endpoint: "/__s", keyEndpoint: "/__s/k" },
          polymorphic: { enabled: true, seed: "rollup-seed" },
        },
      }),
    ],
  });
  await bundle.write({ dir: outDir, format: "esm", entryFileNames: "index.js" });
  await bundle.close();

  const clientPath = path.join(outDir, "index.js");
  clientCode = readFileSync(clientPath, "utf8");
  hardened = await import(pathToFileURL(clientPath).href + "?t=" + Date.now());
  const { transport, keyTransport } = await makeInProcessTransport(serverDir);
  globalThis.__configureShield({ transport, keyTransport });
});

test("rollup plugin: behavior preserved end to end", async () => {
  for (const key of ["REA-0001", "bad"])
    assert.deepEqual(await hardened.activate(key), await original.activate(key));
  assert.equal(await hardened.price("pro", 5, 10, 4), await original.price("pro", 5, 10, 4));
  for (const f of ["export", "sso", "nope"])
    assert.equal(hardened.canUse(f), original.canUse(f));
});

test("rollup plugin: secrets left the client", () => {
  assert.ok(!clientCode.includes("RSHLD-PRIVATE-ALGO-7731"), "relocated secret gone");
  assert.ok(!clientCode.includes("0.6177:0.3823"), "sealed weights gone");
  assert.ok(!/sourceMappingURL/.test(clientCode), "no source maps");
});
