import type { Polymorph } from "../types.js";

/**
 * Graph-flooding decoys. Inert, plausible fake modules/handlers/strings injected
 * AFTER bundling (so they survive tree-shaking). Each is guarded by a sentinel
 * that is never set, so it never runs, and bumps a tripwire counter if it ever
 * did — the test asserts the counter stays 0. Shaped to cross-reference each
 * other so they look central in REA's summary.
 *
 * Experimental: measured against REA, can backfire (size). Never changes behavior.
 */
const DECOY_WORDS = [
  "license",
  "pricing",
  "entitlement",
  "quota",
  "verify",
  "signature",
  "token",
  "policy",
  "tier",
  "grant",
  "nonce",
  "vault",
];

export interface DecoyResult {
  code: string;
  names: string[];
}

export function injectDecoys(
  code: string,
  count: number,
  poly: Polymorph,
  protectedNames: string[],
): DecoyResult {
  if (count <= 0) return { code, names: [] };
  const names: string[] = [];
  const bodies: string[] = [];

  for (let i = 0; i < count; i++) {
    const w1 = poly.pick(DECOY_WORDS);
    const w2 = poly.pick(DECOY_WORDS);
    const seed = protectedNames.length
      ? poly.pick(protectedNames)
      : poly.ident();
    const fn = `_${w1}${w2[0].toUpperCase()}${w2.slice(1)}_${poly
      .opId(w1 + w2 + i)
      .slice(0, 4)}`;
    names.push(fn);
    const str = `${w1}:${seed}:${poly.opId(String(i)).slice(0, 6)}`;
    bodies.push(
      `function ${fn}(_x){ if(globalThis.__REASHIELD_DECOY_NEVER__){` +
        `globalThis.__REASHIELD_DECOY_TRIPWIRE__=(globalThis.__REASHIELD_DECOY_TRIPWIRE__|0)+1;` +
        `const _s=${JSON.stringify(str)}; return _s.length + (_x||0);} return void 0; }`,
    );
  }

  // Dead dispatcher that cross-references every decoy (fan-in/out), never runs.
  const refs = names.map((n) => `${n}(1)`).join(" + ");
  const dispatcher = `function _dispatch_${poly
    .opId("disp")
    .slice(0, 5)}(){ if(globalThis.__REASHIELD_DECOY_NEVER__){ return ${refs}; } }`;

  const block = `\n/* reashield:decoys */\n${bodies.join("\n")}\n${dispatcher}\n`;
  return { code: code + block, names };
}
