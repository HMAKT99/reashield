---
name: protect-shipped-code
description: >-
  Harden shipped JavaScript/Electron/Python against automated, agent-driven
  reverse engineering (REA-type tools). Use before releasing a client that
  others download or run, when the artifact contains IP — licensing checks,
  pricing math, proprietary algorithms. Moves the real secrets off-device,
  hardens what must ship, and MEASURES what an attacker can still recover.
  Honest: it defeats automated reverse engineering and raises a human's cost; it
  does NOT make code unbreakable — nothing that runs on someone else's machine
  can be.
---

# Protect shipped code against reverse engineering

## Overview

Tools like REA (Reverse Engineer Anything) let an AI agent point at a shipped app
and rebuild any feature statically — no source code. This skill is the process
for hardening your *own* shipped code against that, and — critically — for
**measuring** whether the hardening actually worked instead of assuming it did.

It is process-first. The reference implementation is
[REAShield](https://github.com/HMAKT99/reashield) (`npx reashield` / the
`reashield-mcp` MCP server), which automates the steps and ships the measurement
harness, but the process holds regardless of tool.

## When to use

- You ship a **client others run**: an npm package, a bundled web app, an
  Electron desktop app, or a packaged Python app — and it contains IP.
- You are about to cut a release and haven't verified what an RE tool can extract.
- Someone asks "how do I stop competitors / agents from reverse-engineering my app?"

Do **not** use this for a pure server/SaaS backend (nothing ships, nothing to
harden) or for open-source code (there is nothing to hide).

## The ground rule — state it out loud

You **cannot** make client-side code unbreakable. If a machine must run it, the
machine has it, so it can always be extracted with enough effort. The achievable
goal is to **defeat the *automated* attack** and turn a ~10-minute agent job into
days of specialist human work. Never claim "unbreakable" — it is false and it
destroys credibility with exactly the audience that will check.

## Process

1. **Inventory what is actually secret.** List the functions/constants that are
   real IP (licensing, pricing, proprietary logic). Most code is not secret —
   protect the few things that are, not everything.

2. **Move the real secrets off-device (biggest lever).** The only truly
   unrecoverable code is code you don't ship. Relocate secret logic behind an API;
   the client keeps a stub. (`mode: "relocate"`.) If the app must work offline,
   accept that these pieces can't be made unrecoverable and harden them instead.

3. **Harden what must ship**, in order of durability:
   - Strip source maps (shipping `.map`/`sourceMappingURL` = publishing source).
   - Ship bytecode / compile hot logic to WASM (off the readable-JS path).
   - Make calls, imports, and IPC/route names **runtime-computed** — static RE
     tools leave computed values "unresolved."
   - Obfuscate + inject inert decoys. (Obfuscation is the *weakest* layer —
     deobfuscators strip it — so it only matters on top of the above.)

4. **Measure against the real attacker.** Do not guess. Run the actual RE tool
   against your before/after build and check what it still recovers. With
   REAShield: `npx reashield test --rea` reports a recovery score (protected
   tokens the tool still extracts). Target: **0**.

5. **Gate it in CI.** RE tools ship often. Pin a baseline and fail the build if a
   newer tool recovers more than the baseline allows, so protection stays a test,
   not a hope.

## Verification

- `npx reashield test --rea` (or the real RE tool) reports **0 protected tokens
  recovered** on the hardened build.
- The app's behavior is **unchanged** — existing tests pass against the hardened
  output. (Relocated/sealed functions become async; await them.)
- **No source maps** ship: no `.map` files, no `sourceMappingURL`.
- The secret's distinctive strings are **absent** from the shipped client (and, if
  relocated, present only in the server skeleton — which you never ship).

## Red flags — stop if you see these

- Claiming or implying the output is "unbreakable" / "impossible to reverse."
- Relying on **obfuscation alone** — run a deobfuscator (e.g. webcrack); if your
  secret survives deobfuscation, it was never protected.
- Shipping source maps to production.
- Hardcoding the secret as a **default argument value** — it leaks via the
  function signature even if the body is sealed. Put it in the body.
- "Protecting" a SaaS backend or open-source repo — there's nothing to shield.
- Hardening breaking behavior — if outputs change, the hardening is wrong, not the
  app.

## Limits (say these in any public claim)

Offline code is never unbreakable; a determined human with the running process
still gets there. This defeats the automated attack and raises cost. The only
truly unrecoverable code is code you don't ship — run it server-side. Defensive
only: harden code you own and ship; never use it to attack, hide, or tamper with
anyone else's software.
