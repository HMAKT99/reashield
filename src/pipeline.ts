import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AppliedLayer, BuildArtifacts, ShieldConfig } from "./types.js";
import { createPolymorph } from "./polymorph.js";
import { parseSource, generate } from "./analyze/extract.js";
import {
  relocate,
  seal,
  dynamicGraph,
  dynamicChannels,
  homogenizeProtected,
  type TransformState,
} from "./layers/source-transforms.js";
import { noteWasmFallback } from "./layers/wasm.js";
import { flatten } from "./layers/bundle-flatten.js";
import { injectDecoys } from "./layers/decoys.js";
import { obfuscate } from "./layers/obfuscate.js";
import { stripSourceMapComments } from "./layers/strip-sourcemaps.js";
import { wrapIntegrity } from "./layers/integrity.js";
import { serverFiles as buildServerFiles } from "./runtime-templates.js";

function deriveWireKey(seed: string): string {
  return createHash("sha256").update(seed + "::wire").digest().subarray(0, 16).toString("base64");
}

export interface RunOptions {
  config: ShieldConfig;
  cwd: string;
  /** Override polymorphic seed (e.g. for reproducible/A-B builds). */
  seed?: string;
  format?: "esm" | "cjs";
}

export async function runPipeline(opts: RunOptions): Promise<BuildArtifacts> {
  const { config, cwd } = opts;
  const seed = opts.seed ?? config.polymorphic.seed;
  const poly = createPolymorph(config.polymorphic.enabled ? seed : "fixed");
  const wireKeyB64 = deriveWireKey(poly.seed);

  const inputPath = path.resolve(cwd, config.input);
  const resolveDir = path.dirname(inputPath);
  const source = readFileSync(inputPath, "utf8");

  const applied: AppliedLayer[] = [];
  const { ast, fns } = parseSource(source);

  const state: TransformState = {
    config,
    poly,
    handlers: {},
    keys: {},
    opMap: {},
    relocated: [],
    sealed: [],
    dispatched: [],
    channelsRewritten: 0,
    removedStrings: [],
    renamed: [],
    warnings: [],
    notes: [],
  };

  // ---- source-level pillars (operate before flattening) ----
  relocate(ast, fns, state);
  seal(ast, fns, state);
  noteWasmFallback(state);
  if (config.layers.dynamicGraph) dynamicGraph(ast, fns, state);
  if (config.layers.dynamicChannels) dynamicChannels(ast, state);
  homogenizeProtected(ast, state);

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

  let code = generate(ast).code;

  // ---- flatten (collapse the import graph) ----
  if (config.layers.flattenBundle) {
    code = await flatten({
      entryCode: code,
      resolveDir,
      format: opts.format ?? "esm",
      endpoint: config.server.endpoint,
      keyEndpoint: config.server.keyEndpoint,
      wireKeyB64,
      needsRuntime: state.relocated.length + state.sealed.length > 0,
    });
    applied.push({
      layer: "flattenBundle",
      applied: true,
      detail: "import graph collapsed into a single module",
      cost: "none",
    });
  }

  // ---- decoys (post-bundle so they survive tree-shaking) ----
  let decoyNames: string[] = [];
  if (config.layers.decoys.enabled && config.layers.decoys.count > 0) {
    const r = injectDecoys(
      code,
      config.layers.decoys.count,
      poly,
      config.protect.map((p) => p.name),
    );
    code = r.code;
    decoyNames = r.names;
    applied.push({
      layer: "decoys",
      applied: true,
      detail: `${decoyNames.length} inert decoy(s) injected`,
      cost: "size",
    });
  }

  // ---- obfuscate (mangle + string indirection) ----
  if (config.layers.obfuscate) {
    code = obfuscate(
      code,
      config.preset,
      poly.seed,
      config.layers.stringIndirection,
    );
    applied.push({
      layer: "obfuscate",
      applied: true,
      detail: `preset=${config.preset}, stringIndirection=${config.layers.stringIndirection}`,
      cost: config.preset === "max" ? "cpu" : "size",
    });
  }

  // ---- strip source maps ----
  if (config.layers.stripSourceMaps) {
    code = stripSourceMapComments(code);
    applied.push({
      layer: "stripSourceMaps",
      applied: true,
      detail: "no .map, no sourceMappingURL",
      cost: "none",
    });
  }

  // ---- integrity (optional, off by default) ----
  if (config.layers.integrity) {
    code = wrapIntegrity(code);
    applied.push({
      layer: "integrity",
      applied: true,
      detail: "fail-safe anti-tamper (not an anti-static-RE layer)",
      cost: "cpu",
    });
  }

  // ---- server skeleton ----
  let serverFiles: Record<string, string> = {};
  const hasServer =
    Object.keys(state.handlers).length + Object.keys(state.keys).length > 0;
  if (config.server.enabled && hasServer) {
    serverFiles = buildServerFiles({
      adapter: config.server.adapter,
      endpoint: config.server.endpoint,
      keyEndpoint: config.server.keyEndpoint,
      wireKeyB64,
      handlers: state.handlers,
      keys: state.keys,
    });
  }

  return {
    clientCode: code,
    serverFiles,
    applied,
    opMap: state.opMap,
    relocated: state.relocated,
    sealed: state.sealed,
    decoyNames,
    removedStrings: state.removedStrings,
  };
}
