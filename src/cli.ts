#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import os from "node:os";
import { build as esbuildBuild } from "esbuild";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { resolveConfig } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { formatApplied, formatMetrics } from "./report.js";
import { compareStatic, tryRea } from "./harness/rea-measure.js";
import { runRegression } from "./harness/regression.js";
import { tune } from "./harness/tune.js";
import { rewriteIpcChannels } from "./electron/ipc.js";
import { compileToBytecode } from "./electron/bytecode.js";
import { recommendedFuses, applyFuses } from "./electron/fuses.js";

const require = createRequire(import.meta.url);

const HONEST_LIMITS = `
Honest promise & limits:
  • Raises the cost of reverse engineering and defeats most AUTOMATED attempts.
  • Does NOT make code impossible to reverse — nothing shipped to another
    machine can be. A determined human analyst can still do it, at higher cost.
  • relocate/seal need a secured backend + connectivity; the request/response
    boundary stays observable, and sealing does not stop a human dumping
    decrypted code from memory.
  • integrity/anti-tamper does NOT defend REA's static path (REA never runs it).
  • Defensive-only, behavior-preserving, transparent (no phone-home).`;

const SCAFFOLD = `/**
 * REAShield config. See https://github.com/ (your repo) for docs.
 * Honest promise: raises RE cost + defeats most automation. Not impossibility.
 */
module.exports = {
  input: "src/index.js",
  output: "dist-shielded",
  preset: "balanced", // low | balanced | max
  protect: [
    // { name: "licenseCheck", mode: "relocate" }, // move off-device (strongest)
    // { name: "sealedCalc",   mode: "seal" },      // ciphertext + remote key (max)
    // { name: "pricingLogic", mode: "wasm" },      // off the JS graph (fast-follow)
    // { name: "featureGate",  mode: "obfuscate" }, // harden in place
  ],
  server: {
    enabled: true,
    out: "server-shielded",
    adapter: "express", // express | fastify | web | generic
    endpoint: "/__s",
    keyEndpoint: "/__s/k",
    decoyCalls: false,
  },
  polymorphic: { enabled: true, seed: "auto" },
  layers: {
    stripSourceMaps: true,
    flattenBundle: true,
    obfuscate: true,
    stringIndirection: true,
    dynamicChannels: true,
    dynamicGraph: false, // max default on
    ipcChannels: false, // Electron: rewrite literal IPC channel names
    decoys: { enabled: true, count: 5 },
    integrity: false,
  },
};
`;

function writeOutputs(
  cwd: string,
  outputDir: string,
  serverOut: string,
  artifacts: { clientCode: string; serverFiles: Record<string, string> },
): { clientPath: string; serverDir?: string } {
  const outAbs = path.resolve(cwd, outputDir);
  mkdirSync(outAbs, { recursive: true });
  const clientPath = path.join(outAbs, "index.js");
  writeFileSync(clientPath, artifacts.clientCode);

  let serverDir: string | undefined;
  const serverFileNames = Object.keys(artifacts.serverFiles);
  if (serverFileNames.length) {
    serverDir = path.resolve(cwd, serverOut);
    mkdirSync(serverDir, { recursive: true });
    for (const [rel, content] of Object.entries(artifacts.serverFiles)) {
      writeFileSync(path.join(serverDir, rel), content);
    }
  }
  return { clientPath, serverDir };
}

const program = new Command();
program
  .name("reashield")
  .description(
    "Defensive hardening against automated reverse engineering of your own JS artifact.",
  )
  .version(require("../package.json").version);

program
  .command("init")
  .description("scaffold a shield.config.cjs")
  .option("--config <path>", "config file path", "shield.config.cjs")
  .action((opts) => {
    const target = path.resolve(process.cwd(), opts.config);
    if (existsSync(target)) {
      console.error(`refusing to overwrite existing ${opts.config}`);
      process.exit(1);
    }
    writeFileSync(target, SCAFFOLD);
    console.log(`wrote ${opts.config}`);
    console.log(HONEST_LIMITS);
  });

program
  .command("build")
  .description("apply enabled layers; emit hardened client + server skeleton")
  .option("--config <path>", "config file path")
  .option("--seed <seed>", "override polymorphic seed (reproducible builds)")
  .action(async (opts) => {
    const { config, cwd } = await resolveConfig({ configPath: opts.config });
    const artifacts = await runPipeline({ config, cwd, seed: opts.seed });
    const { clientPath, serverDir } = writeOutputs(
      cwd,
      config.output,
      config.server.out,
      artifacts,
    );
    console.log("REAShield build complete.\n");
    console.log(formatApplied(artifacts.applied));
    console.log(`\n  client  -> ${path.relative(process.cwd(), clientPath)}`);
    if (serverDir)
      console.log(
        `  server  -> ${path.relative(process.cwd(), serverDir)}  (DO NOT SHIP; holds real logic/keys)`,
      );
    if (artifacts.relocated.length)
      console.log(`  off-device: ${artifacts.relocated.join(", ")}`);
    if (artifacts.sealed.length)
      console.log(`  sealed: ${artifacts.sealed.join(", ")}`);
    console.log(HONEST_LIMITS);
  });

program
  .command("test")
  .description("measure hardening before vs after (rea-agents if present, else static)")
  .option("--config <path>", "config file path")
  .option("--rea", "attempt a real rea-agents measurement (slow; needs install)")
  .action(async (opts) => {
    const { config, cwd } = await resolveConfig({ configPath: opts.config });
    const inputPath = path.resolve(cwd, config.input);
    const beforeCode = readFileSync(inputPath, "utf8");

    const artifacts = await runPipeline({ config, cwd });
    const { clientPath, serverDir } = writeOutputs(
      cwd,
      config.output,
      config.server.out,
      artifacts,
    );
    void serverDir;

    const protectedNames = config.protect.map((p) => p.name);
    const cmp = compareStatic(beforeCode, artifacts.clientCode, protectedNames);

    console.log("REAShield measurement (before = source, after = hardened client)\n");
    console.log(
      formatMetrics([
        { label: "import edges", before: cmp.before.importEdges, after: cmp.after.importEdges },
        { label: "require()", before: cmp.before.requireCalls, after: cmp.after.requireCalls },
        { label: "source maps", before: String(cmp.before.hasSourceMaps), after: String(cmp.after.hasSourceMaps) },
        { label: "string leak", before: "100%", after: `${(cmp.stringLeakRatio * 100).toFixed(1)}%` },
      ]),
    );
    console.log(
      `\n  protected names leaked into client: ${cmp.leakedNames.length ? cmp.leakedNames.join(", ") : "(none)"}`,
    );
    console.log(`  off-device (not in client at all): ${[...artifacts.relocated, ...artifacts.sealed].join(", ") || "(none)"}`);
    const leakedSecrets = [...new Set(artifacts.removedStrings)].filter(
      (sstr) => artifacts.clientCode.includes(sstr),
    );
    console.log(`  secret strings removed from client: ${artifacts.removedStrings.length} (leaked: ${leakedSecrets.length})`);
    console.log(`  decoys injected: ${artifacts.decoyNames.length}`);

    // Durability: baseline / regression check.
    const baselinePath = path.resolve(cwd, ".reashield-cache/baseline.json");
    const reg = runRegression({
      beforeCode,
      afterCode: artifacts.clientCode,
      protectedNames,
      baselinePath,
    });
    console.log(`\n  regression: ${reg.status} — ${reg.details.join("; ")}`);

    let reaRecoveredAfter = 0;
    if (opts.rea) {
      console.log("\n  running real rea-agents (this can take a few minutes)…");
      const tokens = [...protectedNames, ...artifacts.removedStrings];
      // REA wants a shipped-artifact shape, so compare a clean bundle (before)
      // vs the hardened client dir (after) — not the raw multi-file source.
      const beforeDir = path.join(os.tmpdir(), "reashield-before-" + Date.now());
      mkdirSync(beforeDir, { recursive: true });
      await esbuildBuild({
        entryPoints: [inputPath],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: path.join(beforeDir, "index.js"),
        logLevel: "silent",
      });
      const rea = await tryRea(beforeDir, path.dirname(clientPath), tokens);
      if (rea.available && rea.before && rea.after) {
        console.log(
          formatMetrics([
            { label: "REA graph nodes", before: rea.before.nodes, after: rea.after.nodes },
            { label: "REA graph edges", before: rea.before.edges, after: rea.after.edges },
            { label: "protected tokens REA recovers", before: rea.before.recovered, after: rea.after.recovered },
          ]),
        );
        reaRecoveredAfter = rea.after.recovered;
        console.log(
          `\n  REA recovery score (protected tokens): ${rea.before.recovered} -> ${rea.after.recovered}` +
            (rea.after.recoveredTokens.length ? ` (still visible: ${rea.after.recoveredTokens.join(", ")})` : ""),
        );
      } else {
        console.log(`  ${rea.note}`);
      }
    }

    const ok =
      !cmp.after.hasSourceMaps &&
      leakedSecrets.length === 0 &&
      reaRecoveredAfter === 0 &&
      reg.status !== "regressed";
    console.log(`\n  result: ${ok ? "PASS" : "REVIEW"}`);
    process.exit(ok ? 0 : 1);
  });

program
  .command("doctor")
  .description("report resolved config, layers, costs, and dependency status")
  .option("--config <path>", "config file path")
  .action(async (opts) => {
    const { config, cwd, configPath } = await resolveConfig({
      configPath: opts.config,
    });
    console.log(`REAShield doctor\n  config: ${path.relative(process.cwd(), configPath)}`);
    console.log(`  cwd:    ${cwd}`);
    console.log(`  preset: ${config.preset}   seed: ${config.polymorphic.seed}\n`);

    console.log("  protected symbols:");
    for (const p of config.protect) {
      const note =
        p.mode === "wasm"
          ? " (compile backend fast-follow; falls back to obfuscate)"
          : p.mode === "seal"
            ? " (needs connectivity; not safe vs memory dump)"
            : p.mode === "relocate"
              ? " (needs a secured backend)"
              : "";
      console.log(`    - ${p.name.padEnd(16)} ${p.mode}${note}`);
    }
    if (!config.protect.length) console.log("    (none configured)");

    console.log("\n  layers:");
    for (const [k, v] of Object.entries(config.layers)) {
      console.log(`    - ${k.padEnd(18)} ${JSON.stringify(v)}`);
    }

    console.log("\n  dependencies:");
    for (const dep of ["esbuild", "javascript-obfuscator", "@babel/parser"]) {
      let ok = true;
      try {
        require.resolve(dep);
      } catch {
        ok = false;
      }
      console.log(`    - ${dep.padEnd(22)} ${ok ? "ok" : "MISSING"}`);
    }
    let reaOk = true;
    try {
      require.resolve("rea-agents");
    } catch {
      reaOk = false;
    }
    console.log(`    - rea-agents (optional)  ${reaOk ? "ok" : "not installed (static fallback used)"}`);

    if (config.preset === "max")
      console.log(
        "\n  NOTE: preset=max adds latency/CPU/size cost (CFF, dead code, sealing, dispatch).",
      );
    console.log(HONEST_LIMITS);
  });


const electron = program
  .command("electron")
  .description("Electron-specific hardening (IPC rewriting, V8 bytecode, fuses)");

electron
  .command("ipc <input>")
  .description("rewrite literal IPC channel names into runtime-computed ones")
  .option("--out <file>", "write result here (default: overwrite input)")
  .action((input, opts) => {
    const src = readFileSync(input, "utf8");
    const r = rewriteIpcChannels(src);
    const out = opts.out ?? input;
    writeFileSync(out, r.code);
    console.log(`reashield electron ipc: rewrote ${r.rewritten} channel(s) -> ${path.relative(process.cwd(), out)}`);
    if (r.channels.length) console.log(`  channels: ${[...new Set(r.channels)].join(", ")}`);
  });

electron
  .command("bytecode <input>")
  .description("compile a JS file to V8 bytecode (.jsc) + a loader")
  .requiredOption("--out <file>", "output .jsc path")
  .action(async (input, opts) => {
    const r = await compileToBytecode(input, opts.out);
    console.log(`reashield electron bytecode:`);
    console.log(`  jsc    -> ${path.relative(process.cwd(), r.jscPath)}`);
    console.log(`  loader -> ${path.relative(process.cwd(), r.loaderPath)}`);
    console.log("  NOTE: V8 bytecode is version-specific — compile with your target Electron's Node/V8.");
  });

electron
  .command("fuses <binary>")
  .description("apply REAShield's recommended defensive fuses to an Electron binary")
  .option("--dry", "print the recommended fuses without flipping")
  .action(async (binary, opts) => {
    if (opts.dry) {
      console.log("recommended fuses:", JSON.stringify(recommendedFuses(), null, 2));
      return;
    }
    const rec = await applyFuses(binary);
    console.log("reashield electron fuses: applied", JSON.stringify(rec));
  });


program
  .command("tune")
  .description("auto-tune the config to minimize measured recovery under a size budget")
  .option("--config <path>", "config file path")
  .option("--max-size <kb>", "size budget in KB", parseFloat)
  .action(async (opts) => {
    const { config, cwd } = await resolveConfig({ configPath: opts.config });
    const before = readFileSync(path.resolve(cwd, config.input), "utf8");
    const res = await tune(config, cwd, before, { maxSizeKb: opts.maxSize });
    console.log("REAShield auto-tune (lower score = stronger, then cheaper)\n");
    for (const c of [...res.candidates].sort((a, b) => a.score - b.score)) {
      const mark = c === res.best ? "\u2605" : " ";
      console.log(
        `  ${mark} preset=${c.preset.padEnd(8)} decoys=${String(c.decoyCount).padStart(2)} ` +
          `leak=${(c.stringLeak * 100).toFixed(1)}% secrets=${c.leakedSecrets} ` +
          `size=${(c.sizeBytes / 1024).toFixed(1)}KB`,
      );
    }
    console.log(
      `\n  recommended: preset=${res.best.preset}, decoys.count=${res.best.decoyCount}, dynamicGraph=true`,
    );
    console.log("  verify against real REA with: reashield test --rea");
  });

program.parseAsync(process.argv);
