import type { TransformState } from "./source-transforms.js";

/**
 * Pillar 3 interface. The WASM compile backend is fast-follow; for now a
 * `mode:wasm` symbol gracefully falls back to in-place obfuscation, with the
 * downgrade reported honestly (never silent).
 */
export function noteWasmFallback(state: TransformState): void {
  for (const entry of state.config.protect) {
    if (entry.mode !== "wasm") continue;
    state.warnings.push(
      `wasm: "${entry.name}" — compile backend not yet implemented; ` +
        `falling back to obfuscate (stays on REA's JS path).`,
    );
  }
}
