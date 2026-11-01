import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppliedLayer, BuildArtifacts, ShieldConfig } from "./types.js";
import { createPolymorph } from "./polymorph.js";
import { flatten } from "./layers/bundle-flatten.js";
import {
  deriveWireKey,
  newState,
  runSourceTransforms,
  finalizeCode,
  buildServer,
  needsClientRuntime,
} from "./engine.js";

export interface RunOptions {
  config: ShieldConfig;
  cwd: string;
  /** Override polymorphic seed (e.g. for reproducible/A-B builds). */
  seed?: string;
  format?: "esm" | "cjs";
}

/** Whole-entry hardening: source transforms -> flatten -> finalize -> server. */
export async function runPipeline(opts: RunOptions): Promise<BuildArtifacts> {
  const { config, cwd } = opts;
  const seed = opts.seed ?? config.polymorphic.seed;
  const poly = createPolymorph(config.polymorphic.enabled ? seed : "fixed");
  const wireKeyB64 = deriveWireKey(poly.seed);

  const inputPath = path.resolve(cwd, config.input);
  const resolveDir = path.dirname(inputPath);
  const source = readFileSync(inputPath, "utf8");

  const applied: AppliedLayer[] = [];
  const state = newState(config, poly);

  // ---- source-level pillars ----
  let code = runSourceTransforms(source, state);

  applied.push({
    layer: "relocate",
    applied: state.relocated.length > 0,
    detail: state.relocated.length
      ? `moved off-device: ${state.relocated.join(", ")}`
      : "no relocate-mode symbols",
    cost: "connectivity",
  });
  applied.push({
    layer: "seal",
    applied: state.sealed.length > 0,
    detail: state.sealed.length
      ? `ciphertext + remote key: ${state.sealed.join(", ")}`
      : "no seal-mode symbols",
    cost: "connectivity",
  });
  const wasmEntries = config.protect.filter((p) => p.mode === "wasm");
  if (wasmEntries.length)
    applied.push({
      layer: "wasm",
      applied: state.wasmCompiled.length > 0,
      detail: state.wasmCompiled.length
        ? `compiled to WebAssembly: ${state.wasmCompiled.join(", ")}`
        : "no wasm-mode symbol in numeric subset (fell back to obfuscate)",
      cost: "cpu",
    });
  if (config.layers.dynamicGraph)
    applied.push({
      layer: "dynamicGraph",
      applied: state.dispatched.length > 0,
      detail: state.dispatched.length
        ? `computed dispatch: ${state.dispatched.join(", ")}`
        : "no internal obfuscate-mode symbols to dispatch",
      cost: "cpu",
    });
  if (config.layers.dynamicChannels)
    applied.push({
      layer: "dynamicChannels",
      applied: state.channelsRewritten > 0,
      detail: `${state.channelsRewritten} literal route/channel string(s) made computed`,
      cost: "none",
    });

  // ---- flatten (collapse the import graph; inject client runtime) ----
  if (config.layers.flattenBundle) {
    code = await flatten({
      entryCode: code,
      resolveDir,
      format: opts.format ?? "esm",
      endpoint: config.server.endpoint,
      keyEndpoint: config.server.keyEndpoint,
      wireKeyB64,
      needsRuntime: needsClientRuntime(state),
    });
    applied.push({
      layer: "flattenBundle",
      applied: true,
      detail: "import graph collapsed into a single module",
      cost: "none",
    });
  }

  // ---- decoys + obfuscate + strip maps + integrity ----
  const fin = finalizeCode(code, state, { injectRuntime: false });
  code = fin.code;

  if (config.layers.decoys.enabled && config.layers.decoys.count > 0)
    applied.push({
      layer: "decoys",
      applied: true,
      detail: `${fin.decoyNames.length} inert decoy(s) + ${fin.decoyEdges} fake edge(s) injected`,
      cost: "size",
    });
  if (config.layers.obfuscate)
    applied.push({
      layer: "obfuscate",
      applied: true,
      detail: `preset=${config.preset}, stringIndirection=${config.layers.stringIndirection}`,
      cost: config.preset === "max" ? "cpu" : "size",
    });
  if (config.layers.stripSourceMaps)
    applied.push({
      layer: "stripSourceMaps",
      applied: true,
      detail: "no .map, no sourceMappingURL",
      cost: "none",
    });
  if (config.layers.integrity)
    applied.push({
      layer: "integrity",
      applied: true,
      detail: "fail-safe anti-tamper (not an anti-static-RE layer)",
      cost: "cpu",
    });

  return {
    clientCode: code,
    serverFiles: buildServer(state, wireKeyB64),
    applied,
    opMap: state.opMap,
    relocated: state.relocated,
    sealed: state.sealed,
    wasmCompiled: state.wasmCompiled,
    decoyNames: fin.decoyNames,
    removedStrings: state.removedStrings,
  };
}
