import type { AppliedLayer } from "./types.js";

export function formatApplied(applied: AppliedLayer[]): string {
  const lines = applied.map((a) => {
    const mark = a.applied ? "✓" : "·";
    const cost = a.cost && a.cost !== "none" ? `  [cost: ${a.cost}]` : "";
    return `  ${mark} ${a.layer.padEnd(16)} ${a.detail}${cost}`;
  });
  return lines.join("\n");
}

export interface MetricRow {
  label: string;
  before: string | number;
  after: string | number;
}

export function formatMetrics(rows: MetricRow[]): string {
  const w = Math.max(...rows.map((r) => r.label.length), 6);
  const head = `  ${"metric".padEnd(w)}  ${"before".padStart(10)}  ${"after".padStart(10)}`;
  const body = rows
    .map(
      (r) =>
        `  ${r.label.padEnd(w)}  ${String(r.before).padStart(10)}  ${String(
          r.after,
        ).padStart(10)}`,
    )
    .join("\n");
  return `${head}\n${body}`;
}
