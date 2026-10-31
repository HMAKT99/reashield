# REAShield

**Drop-in defensive hardening that starves automated, agent-driven reverse
engineering of your _own_ shipped JavaScript / npm artifact.**

> ### Honest promise & limits — read this first
> REAShield **raises the cost** of reverse engineering and **defeats most
> _automated_ attempts** (tools like [REA](https://github.com/morluto/rea) that
> statically reconstruct a module graph and reason over a summary of it).
>
> It does **not** make your code impossible to reverse. **Nothing that runs on
> someone else's machine can be.** A determined human analyst can still do it —
> at much higher cost. REAShield never claims otherwise, and neither should you.
>
> The single biggest lever isn't a trick in this tool: **if logic must stay
> secret, move it server-side so it never ships.** REAShield makes that a
> first-class, one-line option (`mode: "relocate"`).

REAShield is **defensive-only, behavior-preserving, and transparent** (no hidden
network calls, no phone-home). It hardens code _you own and ship_. It is not a
tool for analyzing, hiding, or tampering with anyone else's software, and it
will not help bypass someone else's DRM, license checks, or anti-cheat.

---

## Why this works (the threat model)

REA's JavaScript/Electron path is **static** — it never runs your app. It reads
your bundle, rebuilds a graph of **modules, imports, routes, IPC channels and
strings**, then hands a coding agent a compact **summary** to reason over. It
honestly leaves anything **computed at runtime unresolved** and drops
relationships when a graph gets too big.

So the durable defenses either **move secrets off-device** or **turn static
facts into runtime facts** REA can't resolve. Plain obfuscation — the thing
LLM-assisted deobfuscation erodes fastest — is the replaceable outer skin, not
the foundation.

## Defense pillars (ordered by durability)

| Pillar | `mode` / layer | What it does | Honest limit |
|---|---|---|---|
| **Server-side relocation** | `relocate` | Moves the real body to a generated server skeleton; ships only an opaque remote-call stub through one endpoint. The secret never ships. | Needs a secured backend; the request/response boundary is observable. |
| **Encrypted sealing** (`max`) | `seal` | Ships the module as ciphertext, decrypted at runtime with a key fetched from your server. | Needs connectivity; does **not** stop a human dumping decrypted memory. |
| **WASM** (fast-follow) | `wasm` | Moves logic off REA's JS graph path. | Compile backend not yet shipped; falls back to `obfuscate` (reported). |
| **Dynamic graph** (`max`) | `dynamicGraph` | Computed imports + runtime dispatch table — deletes the call/import edges REA recovers. | CPU cost; scoped to protected regions. |
| **Graph starvation** | `flattenBundle`, `stripSourceMaps`, `stringIndirection`, `dynamicChannels` | One module, no maps, no semantic plaintext strings, computed channel names. | Obfuscation erodes over time. |
| **Polymorphism** | `polymorphic` | Per-build re-randomization of names, strings **and structure** — defeats version diffing. | Cosmetic alone; pairs with the above. |
| **Decoys** | `decoys` | Inert, plausible fake modules/strings that pollute REA's summary. | Experimental; measured, can add size. |
| **Integrity** | `integrity` (off) | Fail-safe anti-tamper. | Does **not** defend REA's static path (REA never runs your app). |

## Install

```bash
npm install --save-dev reashield
```

## Quick start

```bash
npx reashield init          # scaffold shield.config.cjs
npx reashield build         # emit hardened client + server skeleton
npx reashield doctor        # show config, layers, costs, deps
npx reashield test          # measure before vs after (static; add --rea for real REA)
```

## Config (`shield.config.cjs`)

```js
module.exports = {
  input: "src/index.js",
  output: "dist-shielded",
  preset: "balanced",            // low | balanced | max
  protect: [
    { name: "licenseCheck", mode: "relocate" },  // strongest: off-device
    { name: "sealedCalc",   mode: "seal" },        // ciphertext + remote key (max)
    { name: "pricingLogic", mode: "wasm" },        // off the JS graph (fast-follow)
    { name: "featureGate",  mode: "obfuscate" },   // harden in place
  ],
  server: {
    enabled: true, out: "server-shielded", adapter: "express",
    endpoint: "/__s", keyEndpoint: "/__s/k", decoyCalls: false,
  },
  polymorphic: { enabled: true, seed: "auto" },     // "auto" rotates every build
  layers: {
    stripSourceMaps: true, flattenBundle: true, obfuscate: true,
    stringIndirection: true, dynamicChannels: true, dynamicGraph: false,
    decoys: { enabled: true, count: 5 }, integrity: false,
  },
};
```

`protect: ["a", "b"]` (a plain string array) is also accepted; each defaults to
`mode: "obfuscate"`. You can also put the config under a `reashield` key in
`package.json`.

### Presets

- **low** — strip maps, flatten, mangle. Fast, minimal size.
- **balanced** (default) — + string indirection, name homogenization, computed
  channels, opaque relocation boundary, structural polymorphism, 5 decoys. Low
  cost.
- **max** — + dynamic dispatch, encrypted sealing, decoy calls, control-flow
  flattening, dead-code injection, self-defending, ~15 decoys. Adds latency /
  CPU / size — `doctor` flags it.

## Bundler plugins (run hardening inside your existing build)

Instead of the CLI, harden as part of an esbuild / Rollup / Vite build. The
plugin runs the source-level pillars per module, then finalizes each output
chunk (decoys + obfuscation + source-map stripping + client-runtime injection)
and writes the server skeleton. `flattenBundle` is a no-op here — your bundler
already bundles; the plugin hardens its output. Configure the relocated/sealed
transport once via the global the plugin installs:
`globalThis.__configureShield({ transport, keyTransport })` (or let the default
`fetch` transport call your endpoints).

```js
// rollup.config.mjs
import { reashieldRollup } from "reashield/plugins";
export default {
  input: "src/index.js",
  output: { dir: "dist", format: "esm" },
  plugins: [reashieldRollup({ configPath: "shield.config.cjs" })],
};
```

```js
// vite.config.mjs  (Vite consumes the Rollup plugin interface)
import { reashieldVite } from "reashield/plugins";
export default { plugins: [reashieldVite({ configPath: "shield.config.cjs" })] };
```

```js
// esbuild build script
import { build } from "esbuild";
import { reashieldEsbuild } from "reashield/plugins";
await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  outdir: "dist",
  plugins: [reashieldEsbuild({ configPath: "shield.config.cjs" })],
});
```

Each plugin accepts `{ config | configPath, cwd, seed }`. Note: the plugin
hardens every emitted JS chunk, so obfuscation cost applies to the whole output
— scope your build accordingly.

## The generated server skeleton

`relocate` and `seal` emit a `server-shielded/` directory holding the **real
logic and keys**. **Never ship it to users.** You run it behind your own auth +
TLS. REAShield scaffolds the Express/Fastify wiring and an in-process handler
for tests; **securing the endpoint is your responsibility** (it does not add
auth for you).

Relocated/sealed functions become `async` (they do a round-trip). Make sure your
call sites `await` them. They must be **self-contained** (no closure over
client-only module state).

## Behavior preservation

Hardening must never change what your program does. The bundled example
(`examples/sample-package`) proves identical outputs before and after hardening
— including relocated and sealed code, exercised through an in-process server —
and asserts decoys never execute. Run it with `npm run example:test`.

## Electron hardening

For Electron apps, REAShield adds an Electron-specific path (pair it with the JS
pillars above):

- **Dynamic IPC channel rewriting** — turns literal `ipcMain`/`ipcRenderer`/
  `webContents` channel strings into runtime-computed ones. REA leaves
  dynamically-computed IPC names **unresolved by design**, so this directly
  starves its graph. Value-preserving: both sides compute the identical string.
  Enable with `layers.ipcChannels: true`, or run standalone:
  ```bash
  npx reashield electron ipc src/main.js --out dist/main.js
  ```
- **V8 bytecode** (`bytenode`) — ship `.jsc` so the asar holds no readable JS:
  ```bash
  npx reashield electron bytecode dist/main.js --out dist/main.jsc
  ```
  **Caveat:** V8 bytecode is tied to the exact V8 version — compile with your
  target Electron's Node/V8, or the `.jsc` will not load. Raises cost against
  automated static JS analysis; it is not unbreakable.
- **Defensive fuses** (`@electron/fuses`) — flip the packaged binary to the
  hardened defaults (disable `RunAsNode`, Node CLI inspect args and
  `NODE_OPTIONS`; enable embedded ASAR integrity validation and
  `OnlyLoadAppFromAsar`). Run after packaging, in your `afterPack`:
  ```bash
  npx reashield electron fuses path/to/YourApp   # --dry to preview
  ```

`bytenode` and `@electron/fuses` are **optional** dependencies, loaded only when
you use these commands. Programmatic API: `import { rewriteIpcChannels,
compileToBytecode, recommendedFuses, applyFuses } from "reashield/electron"`.

## Durability: measure, don't trust

REA ships often. `reashield test` compares your own before/after artifact and
writes a baseline; the committed GitHub Action
(`.github/workflows/reashield-regression.yml`) re-measures across a matrix of
`rea-agents` versions and **fails when a newer REA recovers more than the
baseline allows**. That regression gate — not any single obfuscation trick — is
what keeps the shield strong over time.

`rea-agents` is an **optional** dev dependency. Without it, `reashield test`
falls back to static proxy metrics (source maps, import edges, string leakage,
protected-name leakage, secret-string removal).

## Roadmap

✅ Bundler plugins (esbuild/Rollup/Vite) · ✅ Electron path (bytenode, defensive
fuses, dynamic IPC rewriting).

Next: WASM compile backend · broader server adapters + auth helpers ·
summary-view-tuned decoys · ASAR packaging integration helpers.

## License

MIT. Use it to protect code you own and ship. Nothing here is a weapon against
anyone else's software.
