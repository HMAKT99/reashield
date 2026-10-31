import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const el = await import(pathToFileURL(path.join(repoRoot, "dist", "electron.js")).href);
const require = createRequire(import.meta.url);

test("ipc: literal channels become computed and main/renderer still match", () => {
  const main = `const { ipcMain } = require("electron");
ipcMain.handle("do-thing", async (e, x) => x + 1);
emitter.on("click", () => {}); // unrelated — must NOT be touched`;
  const renderer = `const { ipcRenderer } = require("electron");
export const run = (x) => ipcRenderer.invoke("do-thing", x);`;

  const m = el.rewriteIpcChannels(main);
  const r = el.rewriteIpcChannels(renderer);

  assert.equal(m.rewritten, 1, "only the IPC channel rewritten in main");
  assert.equal(r.rewritten, 1);
  assert.ok(!m.code.includes('"do-thing"'), "main literal channel gone");
  assert.ok(!r.code.includes('"do-thing"'), "renderer literal channel gone");
  assert.ok(m.code.includes('"click"'), "unrelated emitter.on('click') untouched");

  // Both sides must compute the IDENTICAL string, or IPC would break.
  const grab = (code) => code.match(/String\.fromCharCode\([^)]*\)/)[0];
  const mExpr = grab(m.code), rExpr = grab(r.code);
  assert.equal(mExpr, rExpr, "channel computes identically on both sides");
  // eslint-disable-next-line no-eval
  assert.equal(eval(mExpr), "do-thing", "computed value equals original channel");
});

test("bytecode: compiles to .jsc and the loader runs it (behavior preserved)", async () => {
  // Build inside the repo so the generated loader's require("bytenode") resolves.
  const dir = mkdtempSync(path.join(repoRoot, ".bc-tmp-"));
  try {
    const input = path.join(dir, "mod.cjs");
    writeFileSync(input, "module.exports = (a, b) => a * 10 + b;\n");
    const out = path.join(dir, "mod.jsc");
    const r = await el.compileToBytecode(input, out);
    const fn = require(r.loaderPath);
    assert.equal(typeof fn, "function");
    assert.equal(fn(4, 2), 42, "bytecode-loaded module behaves identically");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fuses: recommended defensive settings are correct", () => {
  const f = el.recommendedFuses();
  assert.equal(f.RunAsNode, false);
  assert.equal(f.EnableNodeOptionsEnvironmentVariable, false);
  assert.equal(f.EnableNodeCliInspectArguments, false);
  assert.equal(f.EnableEmbeddedAsarIntegrityValidation, true);
  assert.equal(f.OnlyLoadAppFromAsar, true);
});
