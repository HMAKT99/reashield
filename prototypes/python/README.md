# REAShield — Python front-end (prototype)

A proof of concept that REAShield's most durable, language-agnostic pillar —
**server-side relocation** — transfers beyond JavaScript.

Mark a function; `harden()` lifts its real body into a generated **server
skeleton** and leaves the client with only an opaque remote-call stub. The secret
never ships — exactly like the JS tool's `mode: "relocate"`, but driven by
Python's own `ast` instead of Babel.

## Run it

```bash
cd prototypes/python
python3 test_prototype.py                      # proves behavior + secret removal
python3 reashield_py.py example/app.py --relocate license_check
```

The test asserts, in-process (no server needed):
- **Behavior preserved** — the hardened client returns identical results to the
  original for every input, with the server wired in-process.
- **Secret removed** — the secret string and the real algorithm are absent from
  the client and present only on the server.

## What this proves (and doesn't)

- ✅ The **architecture** generalizes: relocate + remote-stub + measurement is not
  JS-specific. The expensive, language-specific part is the parser/AST front-end
  (here, Python's `ast`; in the JS tool, Babel).
- ⚠️ This prototype implements **relocation only**. The JS tool also does sealing,
  WASM, graph starvation, polymorphism, and decoys — each would need a
  Python-specific implementation.
- ⚠️ Same honest limits as the main tool: raises the cost of *automated* reverse
  engineering; does not make code unreversible; relocation needs a backend you
  secure, and the request/response boundary stays observable.

Interpreted / source-shipped languages (Python, Ruby, PHP, Lua) are the natural
fit for the full approach. Compiled-to-native languages (Go, Rust, C/C++) ship no
source and are a different reverse-engineering game (disassembly), so the
"starve the module graph" pillars don't map there.
