import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(exampleDir, "..", "..");

const { resolveConfig, runPipeline, makeInProcessTransport } = await import(
  pathToFileURL(path.join(repoRoot, "dist", "index.js")).href
);

// Original (un-hardened) module — the behavioral oracle.
const original = await import(
  pathToFileURL(path.join(exampleDir, "src", "index.js")).href
);

let hardened;
let clientCode;
const clientPath = path.join(exampleDir, "dist-shielded", "index.js");
const serverDir = path.join(exampleDir, "server-shielded");

before(async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { config, cwd } = await resolveConfig({
    configPath: path.join(exampleDir, "shield.config.cjs"),
    cwd: exampleDir,
  });
  const artifacts = await runPipeline({ config, cwd, seed: "test-seed-A" });

  mkdirSync(path.dirname(clientPath), { recursive: true });
  writeFileSync(clientPath, artifacts.clientCode);
  mkdirSync(serverDir, { recursive: true });
  for (const [rel, content] of Object.entries(artifacts.serverFiles)) {
    writeFileSync(path.join(serverDir, rel), content);
  }
  clientCode = artifacts.clientCode;

  // Load the hardened client and wire the server in-process (no HTTP needed).
  hardened = await import(pathToFileURL(clientPath).href + "?t=" + Date.now());
  const { transport, keyTransport } = await makeInProcessTransport(serverDir);
  hardened.__configureShield({ transport, keyTransport });
});

test("behavior preserved: activate (relocated licenseCheck)", async () => {
  for (const key of ["REA-0001", "REA-ZZZ", "bad-key", "REA-abcdef"]) {
    const exp = await original.activate(key);
    const got = await hardened.activate(key);
    assert.deepEqual(got, exp, `activate(${key})`);
  }
});

test("behavior preserved: price (sealed sealedCalc + wasm-fallback pricingLogic)", async () => {
  const cases = [
    ["free", 1, 2, 3],
    ["pro", 5, 10, 4],
    ["team", 20, 0, 0],
  ];
  for (const [tier, seats, a, b] of cases) {
    const exp = await original.price(tier, seats, a, b);
    const got = await hardened.price(tier, seats, a, b);
    assert.equal(got, exp, `price(${tier},${seats},${a},${b})`);
  }
});

test("behavior preserved: canUse (obfuscated featureGate)", () => {
  for (const flag of ["export", "api", "sso", "nope"]) {
    assert.equal(hardened.canUse(flag), original.canUse(flag), `canUse(${flag})`);
  }
});

test("secrets left the client entirely", () => {
  assert.ok(!clientCode.includes("RSHLD-PRIVATE-ALGO-7731"), "relocated secret must be gone");
  assert.ok(!clientCode.includes("0.6177:0.3823"), "sealed weights must be gone");
});

test("no source maps shipped", () => {
  assert.ok(!/sourceMappingURL/.test(clientCode), "no sourceMappingURL");
  assert.ok(!clientCode.includes("//# source"), "no inline map comment");
});

test("decoys are inert (never executed)", () => {
  const tripwire = globalThis.__REASHIELD_DECOY_TRIPWIRE__ | 0;
  assert.equal(tripwire, 0, "no decoy may ever run");
});
