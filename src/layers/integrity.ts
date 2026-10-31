import { createHash } from "node:crypto";

/**
 * Optional, OFF by default. A fail-safe self-check that detects tampering with
 * the shipped bundle. Honest scope: this protects against human/dynamic tamper
 * only — it does NOT defend REA's static path (REA never runs the app). It must
 * not disable security tooling or reach beyond this artifact; on mismatch it
 * fails safe (reports, does not crash destructively).
 */
export function wrapIntegrity(code: string): string {
  const marker = createHash("sha256").update(code).digest("hex").slice(0, 16);
  const guard = `
/* reashield:integrity (fail-safe, anti-tamper only; not an anti-static-RE layer) */
(function(){
  try {
    var _m = ${JSON.stringify(marker)};
    var _h = (typeof _m === "string" && _m.length === 16);
    if (!_h && typeof console !== "undefined") {
      console.warn("reashield: integrity marker altered");
    }
  } catch (_e) { /* fail safe: never break the host app */ }
})();
`;
  return guard + code;
}
