import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {
  ProtectEntry,
  RawShieldConfig,
  ShieldConfig,
} from "./types.js";
import { layerDefaults, serverDefaults } from "./presets.js";

const CONFIG_CANDIDATES = [
  "shield.config.js",
  "shield.config.cjs",
  "shield.config.mjs",
];

function normalizeProtect(
  raw: Array<string | ProtectEntry> | undefined,
): ProtectEntry[] {
  if (!raw) return [];
  return raw.map((p) =>
    typeof p === "string" ? { name: p, mode: "obfuscate" as const } : p,
  );
}

async function loadRaw(configPath: string): Promise<RawShieldConfig> {
  const ext = path.extname(configPath);
  if (ext === ".cjs") {
    const require = createRequire(import.meta.url);
    // Bust cache so repeated loads in one process see edits.
    delete require.cache[require.resolve(configPath)];
    return require(configPath) as RawShieldConfig;
  }
  const mod = await import(pathToFileURL(configPath).href);
  return (mod.default ?? mod) as RawShieldConfig;
}

export interface ResolveOptions {
  /** Explicit config path; otherwise auto-discover from cwd. */
  configPath?: string;
  cwd?: string;
}

export async function resolveConfig(
  opts: ResolveOptions = {},
): Promise<{ config: ShieldConfig; cwd: string; configPath: string }> {
  const cwd = opts.cwd ?? process.cwd();

  let configPath = opts.configPath
    ? path.resolve(cwd, opts.configPath)
    : undefined;

  let raw: RawShieldConfig | undefined;

  if (!configPath) {
    for (const cand of CONFIG_CANDIDATES) {
      const p = path.join(cwd, cand);
      try {
        readFileSync(p);
        configPath = p;
        break;
      } catch {
        /* keep looking */
      }
    }
  }

  if (configPath) {
    raw = await loadRaw(configPath);
  } else {
    // package.json "reashield" key fallback.
    const pkgPath = path.join(cwd, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.reashield) {
      throw new Error(
        "No shield.config.js (or .cjs/.mjs) and no \"reashield\" key in package.json. Run `reashield init`.",
      );
    }
    raw = pkg.reashield as RawShieldConfig;
    configPath = pkgPath;
  }

  const config = normalizeConfig(raw);
  validateConfig(config);
  // Resolve against the config file's directory when loaded from a file.
  const baseDir =
    path.basename(configPath) === "package.json"
      ? path.dirname(configPath)
      : path.dirname(configPath);
  return { config, cwd: baseDir, configPath };
}

export function normalizeConfig(raw: RawShieldConfig): ShieldConfig {
  const preset = raw.preset ?? "balanced";
  const layers = { ...layerDefaults(preset), ...(raw.layers ?? {}) };
  if (raw.layers?.decoys) {
    layers.decoys = { ...layers.decoys, ...raw.layers.decoys };
  }
  return {
    input: raw.input ?? "src/index.js",
    output: raw.output ?? "dist-shielded",
    preset,
    protect: normalizeProtect(raw.protect),
    server: { ...serverDefaults(), ...(raw.server ?? {}) },
    polymorphic: {
      enabled: raw.polymorphic?.enabled ?? true,
      seed: raw.polymorphic?.seed ?? "auto",
    },
    layers,
  };
}

export function validateConfig(config: ShieldConfig): void {
  const modes = new Set(["relocate", "seal", "wasm", "obfuscate"]);
  for (const p of config.protect) {
    if (!p.name) throw new Error("protect entry missing a name");
    if (!modes.has(p.mode)) {
      throw new Error(
        `protect "${p.name}": unknown mode "${p.mode}" (relocate|seal|wasm|obfuscate)`,
      );
    }
  }
  if (!config.input) throw new Error("config.input is required");
  if (!config.output) throw new Error("config.output is required");
}
