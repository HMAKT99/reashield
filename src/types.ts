/**
 * REAShield type surface.
 *
 * Honest framing baked in: every layer here raises the *cost* of automated
 * reverse engineering of your own shipped artifact. None of them make code
 * impossible to reverse. See README for the promise and its limits.
 */

export type Preset = "low" | "balanced" | "max";

/** How a single protected symbol is defended. Ordered by durability. */
export type ProtectMode =
  | "relocate" // move the body off-device to a generated server handler
  | "seal" // ship as ciphertext, decrypt at runtime with a server-fetched key (max)
  | "wasm" // compile off the JS module-graph path (interface now; fallback: obfuscate)
  | "obfuscate"; // stays client-side, hardened in place

export interface ProtectEntry {
  /** Top-level function name in `input` to protect. */
  name: string;
  mode: ProtectMode;
}

export interface ServerConfig {
  enabled: boolean;
  /** Output dir for the generated server skeleton. Never ship this to users. */
  out: string;
  adapter: "express" | "fastify" | "generic";
  /** Single opaque endpoint all relocated calls funnel through. */
  endpoint: string;
  /** Endpoint that serves decryption keys for sealed modules. */
  keyEndpoint: string;
  /** max-only: emit inert decoy calls so the real one can't be isolated. */
  decoyCalls: boolean;
}

export interface DecoyConfig {
  enabled: boolean;
  count: number;
}

export interface LayerConfig {
  stripSourceMaps: boolean;
  flattenBundle: boolean;
  obfuscate: boolean;
  /** Assemble strings at runtime so no semantic plaintext survives. */
  stringIndirection: boolean;
  /** Rewrite literal route/channel-like constants into computed forms. */
  dynamicChannels: boolean;
  /** Computed imports + runtime dispatch table for protected regions. */
  dynamicGraph: boolean;
  decoys: DecoyConfig;
  /** Fail-safe runtime self-check. Does NOT defend REA's static path. */
  integrity: boolean;
}

export interface PolymorphicConfig {
  enabled: boolean;
  /** "auto" = random per build; any other string = reproducible. */
  seed: string;
}

export interface ShieldConfig {
  input: string;
  output: string;
  preset: Preset;
  protect: ProtectEntry[];
  server: ServerConfig;
  polymorphic: PolymorphicConfig;
  layers: LayerConfig;
}

/** Raw user config before normalization (protect may be a string[]). */
export interface RawShieldConfig {
  input?: string;
  output?: string;
  preset?: Preset;
  protect?: Array<string | ProtectEntry>;
  server?: Partial<ServerConfig>;
  polymorphic?: Partial<PolymorphicConfig>;
  layers?: Partial<LayerConfig>;
}

/** Deterministic RNG + name/id generators derived from the build seed. */
export interface Polymorph {
  seed: string;
  /** float in [0,1). */
  rand(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Opaque, build-stable id for a logical operation (e.g. a relocated op). */
  opId(logical: string): string;
  /** A homogenized, confusable identifier. */
  ident(): string;
}

export interface LayerContext {
  config: ShieldConfig;
  poly: Polymorph;
  /** Project root the config paths resolve against. */
  cwd: string;
  warnings: string[];
  notes: string[];
}

/** One entry in the human-readable build report. */
export interface AppliedLayer {
  layer: string;
  applied: boolean;
  detail: string;
  /** Rough user-facing cost hint for `doctor`. */
  cost?: "none" | "size" | "latency" | "cpu" | "connectivity";
}

export interface BuildArtifacts {
  /** Hardened client code (single flattened module). */
  clientCode: string;
  /** Generated server skeleton files, keyed by relative path. */
  serverFiles: Record<string, string>;
  applied: AppliedLayer[];
  /** op-id -> logical name, for the harness and docs (not shipped). */
  opMap: Record<string, string>;
  /** Names of symbols whose real body left the client entirely. */
  relocated: string[];
  sealed: string[];
  decoyNames: string[];
  /** Distinctive secret strings that left the client (relocated/sealed bodies). */
  removedStrings: string[];
}
