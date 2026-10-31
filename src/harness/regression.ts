import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { compareStatic } from "./rea-measure.js";

/**
 * Durability guarantee: pin a matrix of rea-agents versions, snapshot a baseline
 * of protection metrics, and FAIL when a newer REA recovers more than the
 * baseline allows. This — not any single trick — is what keeps the shield strong
 * as REA ships. When rea-agents isn't installed, the static signal (string leak,
 * leaked protected names, import edges) stands in as the regression metric.
 */
export interface Baseline {
  createdAt: string;
  seedNote: string;
  stringLeakRatio: number;
  leakedNames: string[];
  importEdges: number;
}

export interface RegressionResult {
  status: "baseline-written" | "pass" | "regressed";
  details: string[];
  baseline: Baseline;
  current: Baseline;
}

const TOLERANCE = 0.1;

export function runRegression(opts: {
  beforeCode: string;
  afterCode: string;
  protectedNames: string[];
  baselinePath: string;
}): RegressionResult {
  const cmp = compareStatic(
    opts.beforeCode,
    opts.afterCode,
    opts.protectedNames,
  );
  const current: Baseline = {
    createdAt: new Date().toISOString(),
    seedNote: "static-proxy",
    stringLeakRatio: Number(cmp.stringLeakRatio.toFixed(4)),
    leakedNames: cmp.leakedNames,
    importEdges: cmp.after.importEdges,
  };

  if (!existsSync(opts.baselinePath)) {
    mkdirSync(path.dirname(opts.baselinePath), { recursive: true });
    writeFileSync(opts.baselinePath, JSON.stringify(current, null, 2));
    return {
      status: "baseline-written",
      details: [`baseline written to ${opts.baselinePath}`],
      baseline: current,
      current,
    };
  }

  const baseline = JSON.parse(
    readFileSync(opts.baselinePath, "utf8"),
  ) as Baseline;
  const details: string[] = [];
  let regressed = false;

  if (current.stringLeakRatio > baseline.stringLeakRatio + TOLERANCE) {
    regressed = true;
    details.push(
      `string leak up: ${baseline.stringLeakRatio} -> ${current.stringLeakRatio}`,
    );
  }
  if (current.leakedNames.length > baseline.leakedNames.length) {
    regressed = true;
    details.push(
      `protected names leaked: ${current.leakedNames.join(", ") || "(none)"}`,
    );
  }
  if (current.importEdges > baseline.importEdges + 1) {
    regressed = true;
    details.push(
      `import edges up: ${baseline.importEdges} -> ${current.importEdges}`,
    );
  }
  if (!regressed) details.push("within baseline tolerance");

  return {
    status: regressed ? "regressed" : "pass",
    details,
    baseline,
    current,
  };
}
