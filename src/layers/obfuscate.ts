import _obfuscator from "javascript-obfuscator";
import { createHash } from "node:crypto";
import type { Preset } from "../types.js";
import { obfuscatorProfile } from "../presets.js";

const Obfuscator = (
  _obfuscator as unknown as { default?: typeof _obfuscator }
).default ?? _obfuscator;

/**
 * Pillar: mangle identifiers + string indirection (the replaceable outer skin).
 * Seed-driven so names/string-array layout re-randomize per build (polymorphism).
 * renameGlobals:false preserves the public export names (API contract) while
 * internal protected logic is renamed and its strings encrypted.
 */
export function obfuscate(
  code: string,
  preset: Preset,
  seed: string,
  stringIndirection: boolean,
): string {
  const p = obfuscatorProfile(preset);
  const seedNum = createHash("sha256").update(seed).digest().readUInt32LE(0);

  const result = Obfuscator.obfuscate(code, {
    seed: seedNum,
    compact: true,
    renameGlobals: false,
    identifierNamesGenerator: "mangled",
    controlFlowFlattening: p.controlFlowFlattening,
    controlFlowFlatteningThreshold: p.controlFlowFlattening ? 0.75 : 0,
    deadCodeInjection: p.deadCodeInjection,
    deadCodeInjectionThreshold: p.deadCodeInjection ? 0.4 : 0,
    selfDefending: p.selfDefending,
    stringArray: stringIndirection && p.stringArray,
    stringArrayEncoding: (stringIndirection
      ? p.stringArrayEncoding
      : []) as ("base64" | "rc4")[],
    stringArrayThreshold: stringIndirection ? 1 : 0.75,
    splitStrings: stringIndirection && p.splitStrings,
    splitStringsChunkLength: 5,
    numbersToExpressions: preset === "max",
    simplify: true,
    target: "node",
    sourceMap: false,
  });
  return result.getObfuscatedCode();
}
