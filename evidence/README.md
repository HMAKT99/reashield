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

### 2. Against webcrack — a dedicated deobfuscator: secrets **0**, names **3**

To stress-test honestly, we also ran [webcrack](https://github.com/j4k0xb/webcrack),
which decodes obfuscated string arrays (it made 1000+ changes here). Full result:

- **Secret values recovered: 0.** `RSHLD-PRIVATE-ALGO-7731` and the weights never
  appear — relocation and sealing moved them off the client entirely, so no amount
  of deobfuscation brings them back.
- **Protected *names* recovered: 3** (`licenseCheck`, `sealedCalc`, `featureGate`).
  These are used as routing labels / in-place identifiers and are shipped
  **encoded** (raw `grep` of the client finds 0), but webcrack's string-array decode
  reconstructs them to plaintext.

**So the honest claim is:** your secret *logic and values* survive even a dedicated
deobfuscator, because they aren't in the client to decode. What a deobfuscator can
still surface are the *names* of the relocated operations — routing labels, not the
secrets themselves. If even those names must not leak, use opaque op-ids (a tracked
improvement). We'd rather show you this than claim a flat "recovered 0."

### Why REA recovers nothing but webcrack recovers the names

REA reasons over a graph *summary* and never surfaces the encoded routing strings;
webcrack's only job is to decode those strings. Different tools, different results —
which is exactly why REAShield ships the measurement instead of a marketing number.

## Honest limits

Offline code can't be made unbreakable — if a machine runs it, it has it. This
evidence shows REAShield does what it claims (defeat the **automated** REA-class
attack and keep secret values off-device), and it shows exactly where the edge is
(a deobfuscator can still recover relocated-op *names*). Re-run it and hold us to it.
