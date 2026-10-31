import { createPolymorph } from "../polymorph.js";
import { normalizeConfig, resolveConfig } from "../config.js";
import { newState, deriveWireKey } from "../engine.js";
import type { RawShieldConfig, ShieldConfig } from "../types.js";
import type { TransformState } from "../layers/source-transforms.js";

export interface PluginOptions {
  /** Inline config (takes precedence over configPath). */
  config?: RawShieldConfig;
  /** Path to a shield.config.* file. */
  configPath?: string;
  /** Project root; defaults to process.cwd(). */
  cwd?: string;
  /** Override the polymorphic seed. */
  seed?: string;
}

export interface PluginSession {
  config: ShieldConfig;
  cwd: string;
  wireKeyB64: string;
  state: TransformState;
  serverWritten: boolean;
}

export async function initSession(
  options: PluginOptions,
): Promise<PluginSession> {
  let config: ShieldConfig;
  let cwd: string;
  if (options.config) {
    config = normalizeConfig(options.config);
    cwd = options.cwd ?? process.cwd();
  } else {
    const r = await resolveConfig({
      configPath: options.configPath,
      cwd: options.cwd,
    });
    config = r.config;
    cwd = r.cwd;
  }
  const seed = options.seed ?? config.polymorphic.seed;
  const poly = createPolymorph(config.polymorphic.enabled ? seed : "fixed");
  return {
    config,
    cwd,
    wireKeyB64: deriveWireKey(poly.seed),
    state: newState(config, poly),
    serverWritten: false,
  };
}

const JS_RE = /\.(mjs|cjs|jsx?|tsx?)$/;
export function isHardenable(id: string): boolean {
  return JS_RE.test(id.split("?")[0]) && !id.includes("node_modules");
}

export function loaderFor(id: string): "ts" | "tsx" | "jsx" | "js" {
  const p = id.split("?")[0];
  if (p.endsWith(".tsx")) return "tsx";
  if (p.endsWith(".ts")) return "ts";
  if (p.endsWith(".jsx")) return "jsx";
  return "js";
}
