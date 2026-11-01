import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const api = await import(pathToFileURL(path.join(repoRoot, "dist", "index.js")).href);
const { normalizeConfig, createPolymorph, compareStatic, runPipeline } = api;

function fixture(code) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reashield-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "index.js"), code);
  return dir;
}

test("config: string protect entries default to obfuscate; preset defaults", () => {
  const c = normalizeConfig({ protect: ["a", { name: "b", mode: "relocate" }] });
  assert.equal(c.preset, "balanced");
  assert.deepEqual(c.protect[0], { name: "a", mode: "obfuscate" });
  assert.equal(c.protect[1].mode, "relocate");
  assert.equal(c.layers.stripSourceMaps, true);
});

test("polymorph: same seed is deterministic, different seeds diverge", () => {
  const a = createPolymorph("seed-1");
  const b = createPolymorph("seed-1");
  const c = createPolymorph("seed-2");
  assert.equal(a.opId("x"), b.opId("x"));
  assert.notEqual(a.opId("x"), c.opId("x"));
  const auto1 = createPolymorph("auto").seed;
  const auto2 = createPolymorph("auto").seed;
  assert.notEqual(auto1, auto2, "auto draws a fresh seed each build");
});

test("strip source maps: output never carries sourceMappingURL", async () => {
  const dir = fixture("export const x = 1;\n//# sourceMappingURL=index.js.map\n");
  const cfg = normalizeConfig({ input: "src/index.js", preset: "low" });
  const art = await runPipeline({ config: cfg, cwd: dir, seed: "s" });
  assert.ok(!/sourceMappingURL/.test(art.clientCode));
});

test("dynamicChannels: literal route is made runtime-computed", async () => {
  const dir = fixture('export function r(){ return "/api/v1/users"; }\n');
  const cfg = normalizeConfig({
    input: "src/index.js",
    preset: "low",
    layers: {
      obfuscate: false,
      stringIndirection: false,
      dynamicChannels: true,
      flattenBundle: true,
      decoys: { enabled: false, count: 0 },
    },
  });
  const art = await runPipeline({ config: cfg, cwd: dir, seed: "s" });
  assert.ok(!art.clientCode.includes('"/api/v1/users"'), "literal route removed");
  assert.ok(art.clientCode.includes("fromCharCode"), "route is now computed");
});

test("compareStatic: string leakage drops after obfuscation", async () => {
  const dir = fixture('export const msg = "VERY_SECRET_MARKER_STRING";\n');
  const before = 'export const msg = "VERY_SECRET_MARKER_STRING";\n';
  const cfg = normalizeConfig({ input: "src/index.js", preset: "balanced" });
  const art = await runPipeline({ config: cfg, cwd: dir, seed: "s" });
  const cmp = compareStatic(before, art.clientCode, []);
  assert.ok(!art.clientCode.includes("VERY_SECRET_MARKER_STRING"), "marker encoded away");
  assert.ok(cmp.stringLeakRatio < 1, "string leak ratio below 1");
});

test("decoys: summary-tuned clusters are injected, inert, and add fake edges", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const dir = mkdtempSync(path.join(os.tmpdir(), "reashield-dec-"));
  try {
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "index.js"), "export const ping = () => 1;\n");
    const cfg = normalizeConfig({
      input: "src/index.js",
      preset: "low",
      layers: { obfuscate: false, decoys: { enabled: true, count: 8 } },
    });
    const art = await runPipeline({ config: cfg, cwd: dir, seed: "dec" });

    // Centrality signals present for REA's summary to latch onto.
    assert.ok(art.clientCode.includes("__REASHIELD_DECOY_NEVER__"), "inert guard present");
    assert.ok(/route:\/api\//.test(art.clientCode), "decoy route strings present");
    assert.ok(/ipc:/.test(art.clientCode), "decoy ipc strings present");
    assert.ok(/_featureEntry_/.test(art.clientCode), "fake feature entry (fan-in) present");
    assert.ok(art.decoyNames.length >= 8, "at least `count` decoy functions");

    // Inert: evaluating the module must never run a decoy.
    const clientPath = path.join(dir, "client.js");
    writeFileSync(clientPath, art.clientCode);
    globalThis.__REASHIELD_DECOY_TRIPWIRE__ = 0;
    const m = await import(pathToFileURL(clientPath).href);
    assert.equal(m.ping(), 1, "real export still works");
    assert.equal(globalThis.__REASHIELD_DECOY_TRIPWIRE__ | 0, 0, "no decoy ran");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
