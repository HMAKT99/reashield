import type { Polymorph } from "../types.js";

/**
 * WS4 — coherent, misleading decoys.
 *
 * Earlier decoys were inert noise. These are inert *fake features*: each cluster
 * is a self-consistent chain (parse -> verify -> grant, etc.) with plausible
 * config constants, route and IPC strings, so an LLM tracing REA's summary will
 * confidently explain a feature that does not exist and clone the wrong thing.
 *
 * Still provably inert: guarded by a sentinel that is never set, each bumps a
 * tripwire counter only if executed (tests assert it stays 0). Injected AFTER
 * bundling so they survive tree-shaking. Behavior never changes.
 */
const NEVER = "globalThis.__REASHIELD_DECOY_NEVER__";
const TRIP = "globalThis.__REASHIELD_DECOY_TRIPWIRE__";

// Coherent fake features: theme -> ordered roles that form a believable flow.
const THEMES: Record<string, string[]> = {
  license: ["parse", "verify", "checkExpiry", "grant"],
  billing: ["computeTax", "applyDiscount", "chargeCard", "issueInvoice"],
  auth: ["hashToken", "rotateKey", "validateScope", "issueSession"],
  sync: ["diffState", "mergeRemote", "resolveConflict", "pushDelta"],
  telemetry: ["collect", "redactPII", "batch", "flush"],
};
const THEME_KEYS = Object.keys(THEMES);

const CONSTS: Record<string, string> = {
  license: `{"tier":"pro","graceDays":7,"algo":"ed25519"}`,
  billing: `{"currency":"USD","taxRate":0.0825,"roundTo":2}`,
  auth: `{"ttlSeconds":3600,"rotateEvery":86400,"alg":"HS256"}`,
  sync: `{"strategy":"last-write-wins","batchSize":64}`,
  telemetry: `{"sampleRate":0.1,"maxBatch":500}`,
};

export interface DecoyResult {
  code: string;
  names: string[];
  edges: number;
}

export function injectDecoys(
  code: string,
  count: number,
  poly: Polymorph,
): DecoyResult {
  if (count <= 0) return { code, names: [], edges: 0 };

  const names: string[] = [];
  const blocks: string[] = [];
  let edges = 0;
  const hubs: string[] = [];

  const clusterCount = Math.max(1, Math.round(count / 4));
  let remaining = count;
  const per = Math.max(1, Math.floor(count / clusterCount));

  for (let ci = 0; ci < clusterCount; ci++) {
    const theme = poly.pick(THEME_KEYS);
    const roles = THEMES[theme];
    const members = ci === clusterCount - 1 ? remaining : Math.min(per, remaining);
    remaining -= members;
    if (members <= 0) continue;

    const sfx = poly.opId(theme + ci).slice(0, 4);
    const fnNames = Array.from(
      { length: members },
      (_, i) => `_${theme}_${roles[i % roles.length]}_${sfx}${i}`,
    );
    names.push(...fnNames);
    const cfgName = `_${theme}Cfg_${sfx}`;

    // A coherent config constant the fake feature "uses".
    blocks.push(`const ${cfgName} = ${NEVER} ? ${CONSTS[theme]} : null;`);

    fnNames.forEach((fn, i) => {
      const next = fnNames[(i + 1) % fnNames.length];
      const role = roles[i % roles.length];
      const route = `"route:/api/${theme}/${role}"`;
      const ipc = `"ipc:${theme}:${role}"`;
      // Opaque, self-consistent key for the fake feature. Must NOT embed real
      // protected names: a deobfuscator decodes string arrays, so a real name
      // planted here would leak verbatim (it has no graph value — it's a dead
      // `.length` constant). Keep it coherent with the decoy's own theme/role.
      const seed = `${theme}_${role}`;
      edges += 2; // -> next, -> cfg
      blocks.push(
        `function ${fn}(_x){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; ` +
          `const _r=${route}, _c=${ipc}, _k=${JSON.stringify(seed + ":" + poly.opId(fn).slice(0, 6))}; ` +
          `const _cfg=${cfgName}||{}; ` +
          `return ${next}(_x) + _r.length + (_cfg.graceDays||_cfg.ttlSeconds||_cfg.batchSize||1) + _k.length; } return void 0; }`,
      );
    });

    const hub = `_${theme}Hub_${sfx}`;
    hubs.push(hub);
    names.push(hub);
    edges += fnNames.length;
    blocks.push(
      `function ${hub}(){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; return ${fnNames
        .map((m) => `${m}(1)`)
        .join(" + ")}; } return void 0; }`,
    );
  }

  const entry = `_featureEntry_${poly.opId("entry").slice(0, 5)}`;
  names.push(entry);
  edges += hubs.length;
  blocks.push(
    `function ${entry}(){ if(${NEVER}){ ${TRIP}=(${TRIP}|0)+1; return ${hubs
      .map((h) => `${h}()`)
      .join(" + ")}; } return void 0; }`,
  );

  const block = `\n/* reashield:decoys (inert; coherent fake features) */\n${blocks.join("\n")}\n`;
  return { code: code + block, names, edges };
}
