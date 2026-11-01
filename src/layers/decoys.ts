import type { Polymorph } from "../types.js";

/**
 * Summary-view-tuned graph-flooding decoys.
 *
 * REA builds a graph then hands the agent a COMPACT SUMMARY to reason over. So
 * decoys are shaped to look *central* in that summary: grouped into fake
 * "feature" clusters with a hub that fans out to members, members that ring-
 * reference each other and the hub (high in/out degree), a fake entry that
 * references each hub, and plausible route/IPC/key strings — the exact signals
 * REA's feature-investigation workflows latch onto.
 *
 * Every decoy is inert: guarded by a sentinel that is never set, so it never
 * runs; each bumps a tripwire counter *only if executed* — the tests assert the
 * counter stays 0. Injected AFTER bundling so they survive tree-shaking.
 *
 * Experimental: measure against REA, it can backfire (bundle size). Never
 * changes behavior.
 */
const VERBS = ["validate", "verify", "resolve", "sync", "issue", "renew", "grant", "check", "decode", "sign"];
const NOUNS = ["license", "pricing", "entitlement", "quota", "token", "policy", "tier", "signature", "session", "vault"];

const NEVER = "globalThis.__REASHIELD_DECOY_NEVER__";
const TRIP = "globalThis.__REASHIELD_DECOY_TRIPWIRE__";

export interface DecoyResult {
  code: string;
  names: string[];
  /** fake call edges created (centrality mass added to REA's summary). */
  edges: number;
}

export function injectDecoys(
  code: string,
  count: number,
  poly: Polymorph,
  protectedNames: string[],
): DecoyResult {
  if (count <= 0) return { code, names: [], edges: 0 };

  const names: string[] = [];
  const blocks: string[] = [];
  let edges = 0;

  const clusterCount = Math.max(1, Math.round(count / 4));
  const base = Math.floor(count / clusterCount);
  let remaining = count;

  const entryRefs: string[] = [];

  for (let ci = 0; ci < clusterCount; ci++) {
    const members = ci === clusterCount - 1 ? remaining : base;
    remaining -= members;
    if (members <= 0) continue;

    const feat = `${poly.pick(VERBS)}${poly.pick(NOUNS).replace(/^./, (c) => c.toUpperCase())}`;
    const suffix = poly.opId("feat" + ci).slice(0, 4);
    const hub = `_${feat}Hub_${suffix}`;
    const memberNames = Array.from(
      { length: members },
      (_, i) => `_${feat}_${i}_${poly.opId("m" + ci + i).slice(0, 4)}`,
    );
    names.push(hub, ...memberNames);

    // Members ring-reference the next member and the hub (high degree).
    memberNames.forEach((m, i) => {
      const next = memberNames[(i + 1) % memberNames.length];
      const seed = protectedNames.length ? poly.pick(protectedNames) : feat;
      const strs = [
        `"route:/api/${feat.toLowerCase()}/${poly.pick(NOUNS)}"`,
        `"ipc:${feat.toLowerCase()}:${poly.pick(VERBS)}"`,
        `"k:${seed}:${poly.opId(m).slice(0, 8)}"`,
      ];
      edges += 2; // -> next, -> hub
      blocks.push(
        `function ${m}(_x){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; ` +
          `const _s=[${strs.join(",")}]; return ${next}(_x)+${hub}()+_s.length; } return void 0; }`,
      );
    });

    // Hub fans out to every member.
    edges += memberNames.length;
    blocks.push(
      `function ${hub}(){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; ` +
        `return ${memberNames.map((m) => `${m}(1)`).join("+")}; } return void 0; }`,
    );
    entryRefs.push(`${hub}()`);
    edges += 1; // entry -> hub
  }

  // Fake feature entry references every hub (fan-in to the hubs).
  const entry = `_featureEntry_${poly.opId("entry").slice(0, 5)}`;
  names.push(entry);
  blocks.push(
    `function ${entry}(){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; return ${entryRefs.join("+")}; } return void 0; }`,
  );

  const block = `\n/* reashield:decoys (inert; summary-tuned) */\n${blocks.join("\n")}\n`;
  return { code: code + block, names, edges };
}
