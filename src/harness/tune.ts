/**
 * WS2 — auto-tuning. Build + measure across a config grid and pick the config
 * with the LOWEST measured recovery under a size budget. Uses the fast static
 * proxy for the inner loop (string leak + secret leak); verify the winner once
 * with `--rea`. No new attacker logic — it optimizes existing knobs.
 */
import { runPipeline } from "../pipeline.js";
import { compareStatic } from "./rea-measure.js";
import type { Preset, ShieldConfig } from "../types.js";

export interface Candidate {
  preset: Preset;
  decoyCount: number;
  dynamicGraph: boolean;
  sizeBytes: number;
  stringLeak: number;
  leakedSecrets: number;
  score: number;
}

export interface TuneResult {
  candidates: Candidate[];
  best: Candidate;
}

export async function tune(
  base: ShieldConfig,
  cwd: string,
  beforeCode: string,
  opts: { maxSizeKb?: number } = {},
): Promise<TuneResult> {
  const presets: Preset[] = ["balanced", "max"];
  const decoyCounts = [5, 15, 30];
  const names = base.protect.map((p) => p.name);
  const candidates: Candidate[] = [];

  for (const preset of presets) {
    for (const decoyCount of decoyCounts) {
      const cfg: ShieldConfig = {
        ...base,
        preset,
        layers: {
          ...base.layers,
          dynamicGraph: true,
          decoys: { enabled: true, count: decoyCount },
        },
      };
      const art = await runPipeline({ config: cfg, cwd, seed: "tune" });
      const cmp = compareStatic(beforeCode, art.clientCode, names);
      const leakedSecrets = [...new Set(art.removedStrings)].filter((x) =>
        art.clientCode.includes(x),
      ).length;
      const sizeBytes = Buffer.byteLength(art.clientCode);
      // Protection dominates; size is the tie-breaker (lowest-cost max protection).
      const score = leakedSecrets * 1_000_000 + cmp.stringLeakRatio * 10_000 + sizeBytes;
      candidates.push({
        preset,
        decoyCount,
        dynamicGraph: true,
        sizeBytes,
        stringLeak: cmp.stringLeakRatio,
        leakedSecrets,
        score,
      });
    }
  }

  let pool = candidates;
  if (opts.maxSizeKb) {
    const within = candidates.filter((c) => c.sizeBytes <= opts.maxSizeKb! * 1024);
    if (within.length) pool = within;
  }
  const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
  return { candidates, best };
}
