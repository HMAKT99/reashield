# REAShield (Python)

**Defensive hardening that raises the cost of automated reverse engineering of
your *own* shipped Python code.** The Python front-end of
[REAShield](https://github.com/HMAKT99/reashield).

> ### Honest promise & limits — read first
> This **raises the cost** of reverse engineering and **defeats most _automated_
> attempts**. It does **not** make code unreversible — nothing that runs on
> someone else's machine can be. A determined human can still do it. `.pyc` is
> decompilable; sealing doesn't stop a memory dump; relocation/sealing need a
> backend you secure. Defensive-only, behavior-preserving, transparent.
>
> "Foolproof" here means **engineering robustness** — it never silently breaks
> your code: unsupported cases are **refused with a reason**, not miscompiled.
>
> **On "unbreakable":** offline code can never be made unbreakable — if the
> machine executes it, the machine has it. The only truly unrecoverable option is
> to not ship the logic (run it server-side; `mode: "relocate"`). For offline
> apps, REAShield maximizes attacker cost instead.

## Install

```bash
pip install -e .          # from this directory
```

## Use

```toml
# shield.toml
input = "app.py"
output = "dist_shielded"
preset = "balanced"       # low | balanced | max
seed = "auto"

[[protect]]
name = "license_check"
mode = "relocate"         # move the real body off-device (strongest)
[[protect]]
name = "sealed_score"
mode = "seal"             # ship ciphertext, decrypt with a server-fetched key
[[protect]]
name = "feature_gate"
mode = "obfuscate"        # harden in place (internal-name mangling)
```

```bash
reashield build     # -> dist_shielded/client.py + dist_shielded/server_skeleton.py
reashield test      # measures before vs after (add --strict to fail on leak)
reashield doctor    # config, layers, safety findings, honest limits
```

Wire the generated server in-process (tests) or over HTTP, and point the client
at it:

```python
from reashield import in_process
transport, key_transport = in_process(server_module)
client.configure_shield(transport=transport, key_transport=key_transport)
```

## Pillars (parity with the JS tool, ordered by durability)

1. **Server-side relocation** — the real body moves to a generated server
   skeleton; the client keeps only an opaque remote-call stub. The secret never
   ships. A **safety analysis** refuses (loudly) any function whose body can't
   follow it off-device (free variables, decorators, generators, `nonlocal`,
   async) rather than miscompiling.
2. **Sealing (AES-GCM via `cryptography`)** — ship the body as ciphertext,
   decrypt at runtime with a server-fetched key (runs in the client's own
   globals, so free variables are fine).
3. **String indirection** — string literals become runtime-decoded, so no
   semantic plaintext survives.
4. **Name mangling** — internal (non-`__all__`) protected names are renamed; the
   public API is preserved.
5. **Polymorphic seed** — reproducible per seed; different seeds diverge.
6. **Decoys** — inert, summary-tuned fake feature clusters (never run).
7. **Strip / bytecode** — strip docstrings; optional `.pyc` output.
8. **Measurement harness** — string-leak %, secret-removal, before/after report.

## Boundary note

Relocated/sealed calls cross a **JSON boundary**, so relocated functions must
take and return JSON-serializable values (tuples come back as lists) — the same
constraint as any RPC. Keep relocated functions self-contained.

## Scope

Interpreted / source-shipped languages are the natural fit. Compiled-to-native
(Go, Rust, C/C++) ship no source and are a different reverse-engineering game, so
the graph-starvation pillars don't apply there.
