# Evidence: REAShield measured against the real attacker

This folder holds **raw, reproducible output** — not screenshots, not claims. The
whole point of REAShield is that you don't have to trust the numbers: you re-run
them.

- [`rea-run.txt`](./rea-run.txt) — verbatim output of `reashield test --rea` on the
  bundled sample app.
- [`environment.txt`](./environment.txt) — exact tool versions and the target, so a
  re-run is apples-to-apples.

## Reproduce it yourself

```bash
git clone https://github.com/HMAKT99/reashield && cd reashield
npm install && npm run build
cd examples/sample-package
npm i --no-save rea-agents webcrack        # the real attacker + a deobfuscator
node ../../dist/cli.js test --rea           # ~90s; downloads rea-agents on first run
```

You should see `REA recovery score (protected tokens): 6 -> 0` and `result: PASS`.

## What the numbers mean — read this, it's the honest part

The sample protects **6 tokens**: 4 function names (`licenseCheck`, `sealedCalc`,
`pricingLogic`, `featureGate`) and the secret strings inside them
(`RSHLD-PRIVATE-ALGO-7731`, the weights `0.6177:0.3823`).

### 1. Against REA — the attack this tool is built to defeat: **6 → 0**

REA (`rea-agents` 6.8.0) is a **static** analyzer: it reads your shipped bundle,
builds a module/call/string graph, and hands an agent a summary. On the clean
bundle it recovered all **6** protected tokens. On the hardened client it recovered
**0** — the relocated/sealed bodies aren't in the artifact, and the computed
dispatch/string-indirection leave the rest unresolved. This is the result that
matters, and it's real.

### 2. Against webcrack — a dedicated deobfuscator: **0 recovered**

To stress-test honestly, we also ran [webcrack](https://github.com/j4k0xb/webcrack),
which decodes obfuscated string arrays (it made 1000+ changes here). It recovered
**0** protected tokens — neither secret values nor names:

- **Secret values: 0.** `RSHLD-PRIVATE-ALGO-7731` and the weights are relocated/
  sealed off the client, so there is nothing in the artifact to decode.
- **Protected names: 0.** They are stripped from the shipped client, and nothing
  else embeds them in plaintext.

> **How this evidence improved the tool.** An earlier build of this exact measurement
> showed webcrack recovering **3 names** (`licenseCheck`, `sealedCalc`, `featureGate`).
> Re-running the real tools caught it: the decoy generator was seeding a dead
> `.length` string with a *real* protected name (e.g. `"licenseCheck:5a319f"`), which
> a string-array decoder reconstructs verbatim. Those strings carried no graph value,
> so we switched decoy keys to opaque, theme-derived labels
> ([`src/layers/decoys.ts`](../src/layers/decoys.ts)). webcrack now recovers 0. This
> is the whole reason the measurement is committed rather than claimed.

### Why REA recovers nothing

REA reasons over a graph *summary* and never runs the app, so relocated/sealed
bodies and computed dispatch leave it with nothing to resolve. We ship the harness
(against both REA and a deobfuscator) instead of a marketing number — so a leak like
the one above gets caught by the evidence, not by your users.

## Honest limits

Offline code can't be made unbreakable — if a machine runs it, it has it. This
evidence shows REAShield does what it claims (defeat the **automated** REA-class
attack and keep secret values off-device), and it shows exactly where the edge is
(a deobfuscator can still recover relocated-op *names*). Re-run it and hold us to it.
