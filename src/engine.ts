import { createHash } from "node:crypto";
import type { Polymorph, ShieldConfig } from "./types.js";
import { parseSource, generate } from "./analyze/extract.js";
import {
  relocate,
  seal,
  dynamicGraph,
  dynamicChannels,
  homogenizeProtected,
  wasmCompile,
  type TransformState,
} from "./layers/source-transforms.js";
import { injectDecoys } from "./layers/decoys.js";
import { obfuscate } from "./layers/obfuscate.js";
import { stripSourceMapComments } from "./layers/strip-sourcemaps.js";
import { wrapIntegrity } from "./layers/integrity.js";
import { rewriteIpcChannels } from "./electron/ipc.js";
import {
  serverFiles as buildServerFiles,
  clientRuntimeSource,
} from "./runtime-templates.js";

/**
 * Shared hardening engine used by BOTH the CLI pipeline (whole-entry flatten)
 * and the bundler plugins (per-module transform + per-chunk finalize).
 */

export function deriveWireKey(seed: string): string {
  return createHash("sha256")
    .update(seed + "::wire")
    .digest()
    .subarray(0, 16)
    .toString("base64");
}

export function newState(
  config: ShieldConfig,
  poly: Polymorph,
): TransformState {
  return {
    config,
    poly,
    handlers: {},
    keys: {},
    opMap: {},
    relocated: [],
    sealed: [],
    dispatched: [],
    channelsRewritten: 0,
    ipcRewritten: 0,
    wasmCompiled: [],
    removedStrings: [],
    renamed: [],
    warnings: [],
    notes: [],
  };
}

/** Run every source-level pillar over one parsed module, mutating `state`. */
export function runSourceTransforms(source: string, state: TransformState): string {
  const { ast, fns } = parseSource(source);
  relocate(ast, fns, state);
  seal(ast, fns, state);
  wasmCompile(ast, fns, state);
  if (state.config.layers.dynamicGraph) dynamicGraph(ast, fns, state);
  if (state.config.layers.dynamicChannels) dynamicChannels(ast, state);
  homogenizeProtected(ast, state);
  let out = generate(ast).code;
  if (state.config.layers.ipcChannels) {
    const r = rewriteIpcChannels(out);
    out = r.code;
    state.ipcRewritten += r.rewritten;
  }
  return out;
}

/**
 * Plugin helper: transform one module only if it actually contains a protected
 * symbol or a rewritable channel; otherwise return null (leave it untouched).
 */
export function transformModuleSource(
  source: string,
  state: TransformState,
): string | null {
  const before =
    state.relocated.length +
    state.sealed.length +
    state.dispatched.length +
    state.renamed.length +
    state.channelsRewritten +
    state.ipcRewritten +
    state.wasmCompiled.length;
  const code = runSourceTransforms(source, state);
  const after =
    state.relocated.length +
    state.sealed.length +
    state.dispatched.length +
    state.renamed.length +
    state.channelsRewritten +
    state.ipcRewritten +
    state.wasmCompiled.length;
  return after > before ? code : null;
}

export interface FinalizeOptions {
  /** Inject the client runtime first (plugin mode; CLI injects via flatten). */
  injectRuntime?: boolean;
  wireKeyB64?: string;
}

/** Apply decoys -> obfuscate -> strip maps -> integrity to flattened code. */
export function finalizeCode(
  code: string,
  state: TransformState,
  opts: FinalizeOptions = {},
): { code: string; decoyNames: string[]; decoyEdges: number } {
  const { config, poly } = state;

  if (
    opts.injectRuntime &&
    /__shield\s*\./.test(code) &&
    !/__wk\s*=/.test(code)
  ) {
    const runtime = clientRuntimeSource({
      endpoint: config.server.endpoint,
      keyEndpoint: config.server.keyEndpoint,
      wireKeyB64: opts.wireKeyB64 ?? deriveWireKey(poly.seed),
      exportConfigure: false,
    });
    code = runtime + "\n" + code;
  }

  let decoyNames: string[] = [];
  let decoyEdges = 0;
  if (config.layers.decoys.enabled && config.layers.decoys.count > 0) {
    const r = injectDecoys(code, config.layers.decoys.count, poly);
    code = r.code;
    decoyNames = r.names;
    decoyEdges = r.edges;
  }
  if (config.layers.obfuscate) {
    code = obfuscate(code, config.preset, poly.seed, config.layers.stringIndirection);
  }
  if (config.layers.stripSourceMaps) code = stripSourceMapComments(code);
  if (config.layers.integrity) code = wrapIntegrity(code);
  return { code, decoyNames, decoyEdges };
}

/** Build the server skeleton files (empty if nothing relocated/sealed). */
export function buildServer(
  state: TransformState,
  wireKeyB64?: string,
): Record<string, string> {
  const { config, poly } = state;
  const has =
    Object.keys(state.handlers).length + Object.keys(state.keys).length > 0;
  if (!config.server.enabled || !has) return {};
  return buildServerFiles({
    adapter: config.server.adapter,
    endpoint: config.server.endpoint,
    keyEndpoint: config.server.keyEndpoint,
    wireKeyB64: wireKeyB64 ?? deriveWireKey(poly.seed),
    handlers: state.handlers,
    keys: state.keys,
  });
}

export function needsClientRuntime(state: TransformState): boolean {
  return state.relocated.length + state.sealed.length > 0;
}
