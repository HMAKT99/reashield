/**
 * REAShield — defensive hardening that starves automated, agent-driven reverse
 * engineering of your OWN shipped JavaScript artifact.
 *
 * Honest promise: raises the cost of reverse engineering and defeats most
 * automated attempts. It does NOT make code impossible to reverse — nothing
 * that runs on someone else's machine can.
 */
export { resolveConfig, normalizeConfig, validateConfig } from "./config.js";
export { runPipeline } from "./pipeline.js";
export { createPolymorph } from "./polymorph.js";
export { compareStatic, tryRea } from "./harness/rea-measure.js";
export { runRegression } from "./harness/regression.js";
export { makeInProcessTransport } from "./server/runtime.js";
export type {
  ShieldConfig,
  RawShieldConfig,
  ProtectEntry,
  ProtectMode,
  Preset,
  BuildArtifacts,
  AppliedLayer,
} from "./types.js";
