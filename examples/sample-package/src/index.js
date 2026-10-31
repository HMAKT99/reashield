// A tiny, real library. Some logic is sensitive and marked for protection in
// shield.config.cjs. The public API is async where it depends on relocated or
// sealed logic — so behavior is identical before and after hardening.

// --- sensitive logic (protected) ---

// relocate: the real algorithm + secret must never ship in the client.
function licenseCheck(key) {
  const SECRET = "RSHLD-PRIVATE-ALGO-7731";
  let acc = SECRET.length;
  for (const ch of String(key)) acc = (acc * 31 + ch.charCodeAt(0)) >>> 0;
  return acc % 7 === 0 && String(key).startsWith("REA-");
}

// seal: proprietary scoring, shipped only as ciphertext.
function sealedCalc(a, b) {
  const WEIGHTS = "0.6177:0.3823";
  const [wa, wb] = WEIGHTS.split(":").map(Number);
  return Math.round((a * wa + b * wb) * 100) / 100;
}

// wasm (fast-follow -> falls back to obfuscate): stays client-side for now.
function pricingLogic(tier, seats) {
  const base = { free: 0, pro: 12, team: 29 }[tier] ?? 0;
  return base * Math.max(1, seats) - (seats > 10 ? 15 : 0);
}

// obfuscate: internal feature gate, hardened in place.
function featureGate(flag) {
  const map = { export: true, api: true, sso: false };
  return !!map[flag];
}

// --- public API ---

export async function activate(key) {
  const ok = await licenseCheck(key);
  return { active: ok };
}

export async function price(tier, seats, bonusA, bonusB) {
  const base = pricingLogic(tier, seats);
  const adj = await sealedCalc(bonusA, bonusB);
  return Math.round((base + adj) * 100) / 100;
}

export function canUse(flag) {
  return featureGate(flag);
}
