import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { normalizeConfig, runPipeline } = await import(
  pathToFileURL(path.join(repoRoot, "dist", "index.js")).href
);

const SRC = `
function scoreCalc(a, b, c) {
  const base = a * 2 + b;
  return base > 10 ? base - c * 0.5 : base + c;
}
function labelize(n) {            // non-numeric -> must fall back to obfuscate
  return "tier:" + (n > 5 ? "high" : "low");
}
export function score(a, b, c) { return scoreCalc(a, b, c); }
export function label(n) { return labelize(n); }
`;
const oracle = {
  score: (a, b, c) => { const base = a * 2 + b; return base > 10 ? base - c * 0.5 : base + c; },
  label: (n) => "tier:" + (n > 5 ? "high" : "low"),
};

test("wasm: numeric fn compiles to WebAssembly, non-numeric falls back, behavior preserved", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reashield-wasm-"));
  try {
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "index.js"), SRC);
    const cfg = normalizeConfig({
      input: "src/index.js",
      preset: "balanced",
      protect: [
        { name: "scoreCalc", mode: "wasm" },
        { name: "labelize", mode: "wasm" },
      ],
      polymorphic: { enabled: true, seed: "wasm-seed" },
    });
    const art = await runPipeline({ config: cfg, cwd: dir, seed: "wasm-seed" });

    assert.deepEqual(art.wasmCompiled, ["scoreCalc"], "only the numeric fn compiled to wasm");
    assert.ok(/WebAssembly/.test(art.clientCode), "client contains a WebAssembly module");

    const clientPath = path.join(dir, "client.js");
    writeFileSync(clientPath, art.clientCode);
    const h = await import(pathToFileURL(clientPath).href);

    for (const a of [[6, 1, 4], [1, 1, 3], [10, 0, 2], [3, 3, 1]])
      assert.equal(h.score(...a), oracle.score(...a), `score(${a})`);
    for (const n of [2, 6, 10, 0])
      assert.equal(h.label(n), oracle.label(n), `label(${n})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
