# Changelog

All notable changes to REAShield are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Honest promise throughout: REAShield raises the cost of reverse engineering and
defeats most *automated* attempts. It does not make code impossible to reverse.

## [Unreleased]

## [0.7.2] - 2026-11-05

### Changed
- Republish after 0.7.1 got stuck in npm staging; identical to 0.7.1 (MCP registry metadata).

## [0.7.1] - 2026-11-05

### Added
- MCP registry metadata: `mcpName` in package.json + `server.json`, so REAShield can be published to the official MCP Registry (and propagate to mcp.so / Glama / PulseMCP).

## [0.7.0] - 2026-11-05

### Added
- **MCP server** (`reashield-mcp`) — the defensive mirror of REA. Exposes
  `reashield_doctor`, `reashield_harden`, and `reashield_measure` tools so an agent
  (Claude Code / Cursor) can inspect, harden, and measure a project from chat.


### Added
- **Real-REA adversarial harness**: `reashield test --rea` now runs the actual
  `rea-agents` against a clean before-bundle vs the hardened client and reports a
  **recovery score** — protected tokens REA still recovers (measured 6 -> 0 on the
  example). PASS now requires 0 recovered.
- **`reashield tune`**: auto-tunes the config across a grid to minimize measured
  recovery under a size budget.
- **Coherent misleading decoys**: inert fake *features* (self-consistent
  parse->verify->grant chains with plausible config/route/IPC) that lead an LLM
  to confidently explain a feature that does not exist.
- **Ecosystem coverage**: `test --rea` now also runs **webcrack** on the hardened
  client and reports recovered tokens (humanify documented; needs an LLM key).
- **Python parity**: computed-dispatch layer (mirrors JS `dynamicGraph`),
  default-on at `balanced`.

### Changed
- `dynamicGraph` (computed dispatch) is now **default-on at `balanced`** — forces
  REA's call-edges into "unresolved".
- README/doctor wording clarified: offline code can't be unbreakable; REAShield
  maximizes cost and proves it against real REA.

## [0.6.1] - 2026-11-01

### Added
- **Python front-end** ([`python/`](./python)) — a full-parity, pip-installable
  shield for shipped Python code: server-side relocation, AES-GCM sealing, string
  indirection, name mangling, polymorphism, inert decoys, and a measurement
  harness, with a safety analyzer that refuses rather than miscompiles. Separate
  `python-ci` across Python 3.11/3.12/3.13.

### Changed
- README now presents the repo as a monorepo (JS + Python front-ends).

## [0.6.0] - 2026-11-01

Capstone release — the full planned roadmap, shipped and tested.

### Added
- **Summary-view-tuned decoys**: inert fake "feature" clusters (a hub that fans
  out to members, members that ring-reference each other and the hub, and a fake
  feature entry) plus plausible route/IPC/key strings, shaped to look central in
  REA's summary. Provably inert — a sentinel-guarded tripwire counter stays `0`.
  The build report now shows decoy function and fake-edge counts.
- `publishConfig`, `repository`, `bugs`, and `homepage` metadata.

### Changed
- `reashield --version` now reads `package.json` instead of a hardcoded string.
- `files` whitelist trimmed to `dist`, `README.md`, `LICENSE`.

### Fixed
- CLI bin now carries a `#!/usr/bin/env node` shebang (emitted only for
  `dist/cli.*`), so `npx reashield` / global installs execute correctly.

## [0.5.0] - 2026-11-01

### Added
- **Auth seam** on the relocation boundary: server `setAuthVerifier(fn)` +
  `ShieldUnauthorized` (401); client `__configureShield({ authToken })` attaches
  a token to every relocated call. The endpoint is open until you set a verifier.
- **Cross-runtime Web adapter** (`adapter: "web"`): the server skeleton exports
  `webHandler(request: Request): Promise<Response>` for Hono, Cloudflare Workers,
  Deno, Bun, and Next.js route handlers.

## [0.4.0] - 2026-11-01

### Added
- **Real WASM backend**: `mode: "wasm"` compiles a numeric subset of JS to an
  actual WebAssembly module (emitted as binary, no external toolchain),
  instantiated synchronously so behavior is identical. Supports numeric params,
  `const` locals, `return`, `+ - * /`, unary `-`, ternaries with
  comparison/`&&`/`||`/`!` conditions, and
  `Math.max|min|abs|floor|ceil|round|sqrt|trunc`.

### Changed
- `mode: "wasm"` outside the numeric subset falls back to obfuscation, reported
  (never silent). Removed the previous no-op WASM fallback stub.

## [0.3.0] - 2026-10-31

### Added
- **Electron hardening** (`reashield/electron` + `reashield electron` CLI):
  - **Dynamic IPC channel rewriting** — literal `ipcMain`/`ipcRenderer`/
    `webContents` channel strings become runtime-computed (value-preserving, so
    main/renderer still match). Optional `layers.ipcChannels` or standalone.
  - **V8 bytecode** via `bytenode` (`.jsc` + loader).
  - **Defensive fuses** via `@electron/fuses`.
  - `bytenode` and `@electron/fuses` are optional, lazy-loaded dependencies.

## [0.2.0] - 2026-10-31

### Added
- **Bundler plugins** (`reashield/plugins`): `reashieldRollup`, `reashieldVite`,
  `reashieldEsbuild` — run hardening inside an existing esbuild/Rollup/Vite build.
- MIT `LICENSE`, library unit tests, a committed real-HTTP end-to-end example,
  and CI across Node 20/22/24.

### Changed
- Extracted a shared hardening engine used by both the CLI and the plugins
  (behavior unchanged).

## [0.1.0] - 2026-10-31

### Added
- Initial release: a shield against reverse-engineering tactics (REA included)
  for your own shipped JavaScript.
- Defense pillars: server-side relocation (opaque unified boundary), encrypted
  sealing, graph starvation (flatten, strip source maps, string indirection,
  computed channels, name homogenization), dynamic dispatch graph, polymorphic
  per-build output, and graph-flooding decoys.
- CLI: `init`, `build`, `test`, `doctor`.
- Measurement harness (`rea-agents` when installed, static proxy otherwise) and a
  regression gate pinned across `rea-agents` versions, with a CI workflow.

[Unreleased]: https://github.com/HMAKT99/reashield/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/HMAKT99/reashield/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/HMAKT99/reashield/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/HMAKT99/reashield/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/HMAKT99/reashield/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/HMAKT99/reashield/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/HMAKT99/reashield/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/HMAKT99/reashield/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/HMAKT99/reashield/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/HMAKT99/reashield/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HMAKT99/reashield/releases/tag/v0.1.0
