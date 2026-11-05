#!/usr/bin/env node
/**
 * REAShield MCP server — the defensive mirror of REA.
 *
 * REA is an MCP server that gives an agent reverse-engineering tools. This gives
 * an agent HARDENING tools: inspect what's exposed, harden a project, and measure
 * what the real REA can still recover.
 *
 * Honest: it raises the cost of automated reverse engineering of code you own and
 * ship. It does not make code unbreakable; the only truly unrecoverable logic is
 * logic you don't ship (run it server-side).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { compareStatic, tryRea } from "./harness/rea-measure.js";

const LIMITS =
  "Honest limits: raises the cost of AUTOMATED reverse engineering of code you own and ship; " +
  "not unbreakable (offline code can always be extracted by a determined human); " +
  "relocate/seal need a secured backend; the only truly unrecoverable logic is logic you don't ship.";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const server = new McpServer({ name: "reashield", version: "0.6.1" });

server.registerTool(
  "reashield_doctor",
  {
    title: "REAShield: doctor",
    description:
      "Report how a project is configured for REAShield: which symbols are protected and how (relocate/seal/wasm/obfuscate), which hardening layers are enabled, and the honest limits. Read-only — makes no changes.",
    inputSchema: {
      cwd: z.string().optional().describe("Project directory (defaults to the server's cwd)."),
      config: z.string().optional().describe("Path to shield.config.* (otherwise auto-discovered)."),
    },
  },
  async ({ cwd, config }) => {
    const { config: cfg } = await resolveConfig({ configPath: config, cwd });
    const out: string[] = [`REAShield doctor — preset=${cfg.preset}, seed=${cfg.polymorphic.seed}`, "", "protected symbols:"];
    for (const p of cfg.protect) out.push(`  - ${p.name} → ${p.mode}`);
    if (!cfg.protect.length) out.push("  (none configured)");
    out.push("", "layers:");
    for (const [k, v] of Object.entries(cfg.layers)) out.push(`  - ${k}: ${JSON.stringify(v)}`);
    out.push("", LIMITS);
    return text(out.join("\n"));
  },
);

server.registerTool(
  "reashield_harden",
  {
    title: "REAShield: harden",
    description:
      "Harden a project per its shield config: emit a hardened client (relocation, sealing, WASM, computed dispatch, string indirection, decoys) plus a server skeleton for any relocated/sealed logic. Writes to the config's output dir. Behavior-preserving.",
    inputSchema: {
      cwd: z.string().optional().describe("Project directory (defaults to the server's cwd)."),
      config: z.string().optional().describe("Path to shield.config.*"),
      seed: z.string().optional().describe("Override the polymorphic build seed (for reproducible builds)."),
    },
  },
  async ({ cwd, config, seed }) => {
    const { config: cfg, cwd: base } = await resolveConfig({ configPath: config, cwd });
    const art = await runPipeline({ config: cfg, cwd: base, seed });
    const outDir = path.resolve(base, cfg.output);
    mkdirSync(outDir, { recursive: true });
    const clientPath = path.join(outDir, "index.js");
    writeFileSync(clientPath, art.clientCode);
    let serverDir: string | undefined;
    if (Object.keys(art.serverFiles).length) {
      serverDir = path.resolve(base, cfg.server.out);
      mkdirSync(serverDir, { recursive: true });
      for (const [rel, content] of Object.entries(art.serverFiles)) writeFileSync(path.join(serverDir, rel), content);
    }
    const out = [
      "REAShield build complete.",
      ...art.applied.filter((a) => a.applied).map((a) => `  ✓ ${a.layer}: ${a.detail}`),
      art.relocated.length ? `  off-device: ${art.relocated.join(", ")}` : "",
      art.sealed.length ? `  sealed: ${art.sealed.join(", ")}` : "",
      `  client → ${path.relative(base, clientPath)}`,
      serverDir ? `  server → ${path.relative(base, serverDir)} (DO NOT SHIP; holds real logic/keys)` : "",
      "",
      LIMITS,
    ].filter(Boolean);
    return text(out.join("\n"));
  },
);

server.registerTool(
  "reashield_measure",
  {
    title: "REAShield: measure",
    description:
      "Build the hardened artifact and MEASURE how exposed it is: static metrics always, and — with rea=true — run the real REA (rea-agents) against the before/after build and report the recovery score (protected tokens REA still recovers). rea=true is slow (runs REA twice).",
    inputSchema: {
      cwd: z.string().optional().describe("Project directory (defaults to the server's cwd)."),
      config: z.string().optional().describe("Path to shield.config.*"),
      rea: z.boolean().optional().describe("Run the real REA (rea-agents) for a true recovery score. Slow; requires rea-agents + a JS toolchain."),
    },
  },
  async ({ cwd, config, rea }) => {
    const { config: cfg, cwd: base } = await resolveConfig({ configPath: config, cwd });
    const before = readFileSync(path.resolve(base, cfg.input), "utf8");
    const art = await runPipeline({ config: cfg, cwd: base });
    const names = cfg.protect.map((p) => p.name);
    const cmp = compareStatic(before, art.clientCode, names);
    const leaked = [...new Set(art.removedStrings)].filter((s) => art.clientCode.includes(s));
    const out: string[] = [
      "REAShield measurement (before vs after):",
      `  string leakage: 100% → ${(cmp.stringLeakRatio * 100).toFixed(1)}%`,
      `  off-device: ${[...art.relocated, ...art.sealed].join(", ") || "(none)"}`,
      `  secret strings leaked into client: ${leaked.length}`,
      `  decoys injected: ${art.decoyNames.length}`,
    ];
    if (rea) {
      const tokens = [...names, ...art.removedStrings];
      const dir = path.dirname(path.resolve(base, cfg.input));
      const outDir = path.resolve(base, cfg.output);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "index.js"), art.clientCode);
      const r = await tryRea(dir, outDir, tokens);
      out.push(
        "",
        r.available && r.before && r.after
          ? `  REAL REA recovery score (protected tokens): ${r.before.recovered} → ${r.after.recovered}`
          : `  ${r.note}`,
      );
    }
    out.push("", LIMITS);
    return text(out.join("\n"));
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
