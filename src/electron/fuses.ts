import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Pillar 3 (Electron): defensive fuses. Flip the Electron binary's fuse bits to
 * the hardened defaults. Uses `@electron/fuses`. Run AFTER packaging, on the
 * final Electron binary, typically wired into your build (electron-builder /
 * forge afterPack). This does not touch anyone else's binary.
 *
 * Honest scope: fuses reduce runtime attack surface (no RunAsNode, no inspector,
 * asar integrity). They do not defend REA's static JS analysis by themselves —
 * pair them with bytecode + IPC rewriting + the JS pillars.
 */

/** The hardened fuse settings REAShield recommends (true = enable). */
export interface RecommendedFuses {
  RunAsNode: boolean; // false = disable the node CLI escape hatch
  EnableNodeOptionsEnvironmentVariable: boolean; // false
  EnableNodeCliInspectArguments: boolean; // false = no --inspect
  EnableEmbeddedAsarIntegrityValidation: boolean; // true
  OnlyLoadAppFromAsar: boolean; // true
}

export function recommendedFuses(): RecommendedFuses {
  return {
    RunAsNode: false,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true,
    OnlyLoadAppFromAsar: true,
  };
}

export interface ApplyFusesOptions {
  /** macOS: re-apply an ad-hoc signature after flipping (usually required). */
  resetAdHocDarwinSignature?: boolean;
}

/** Apply the recommended fuses to the Electron binary at `electronPath`. */
export async function applyFuses(
  electronPath: string,
  opts: ApplyFusesOptions = {},
): Promise<RecommendedFuses> {
  let mod: {
    flipFuses: (p: string, cfg: Record<string, unknown>) => Promise<void>;
    FuseVersion: { V1: string };
    FuseV1Options: Record<string, number>;
  };
  try {
    mod = require("@electron/fuses");
  } catch {
    throw new Error(
      "@electron/fuses is not installed. `npm i -D @electron/fuses` (optional dependency).",
    );
  }
  const { flipFuses, FuseVersion, FuseV1Options } = mod;
  const rec = recommendedFuses();
  await flipFuses(electronPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: opts.resetAdHocDarwinSignature ?? process.platform === "darwin",
    [FuseV1Options.RunAsNode]: rec.RunAsNode,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: rec.EnableNodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableNodeCliInspectArguments]: rec.EnableNodeCliInspectArguments,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: rec.EnableEmbeddedAsarIntegrityValidation,
    [FuseV1Options.OnlyLoadAppFromAsar]: rec.OnlyLoadAppFromAsar,
  });
  return rec;
}
