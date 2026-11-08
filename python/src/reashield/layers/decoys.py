"""Summary-tuned, inert decoys. Never run (sentinel guard); a tripwire counter
stays 0. Shaped as cross-referencing fake 'feature' clusters."""
from __future__ import annotations

_VERBS = ["validate", "verify", "resolve", "sync", "issue", "renew", "check", "decode"]
_NOUNS = ["license", "pricing", "entitlement", "quota", "token", "policy", "tier"]


def decoy_source(count: int, poly) -> tuple[str, list[str]]:
    if count <= 0:
        return "", []
    names: list[str] = []
    lines = [
        "# reashield:decoys (inert; summary-tuned)",
        "__REASHIELD_DECOY_NEVER__ = False",
        "__REASHIELD_DECOY_TRIPWIRE__ = 0",
    ]
    members: list[str] = []
    for i in range(count):
        feat = poly.pick(_VERBS) + poly.pick(_NOUNS).capitalize()
        fn = f"_{feat}_{poly.op_id('d' + str(i))[:6]}"
        names.append(fn)
        members.append(fn)
    for i, fn in enumerate(members):
        nxt = members[(i + 1) % len(members)]
        # Opaque, decoy-derived route. Must NOT embed a real protected name: a
        # deobfuscator would surface it verbatim (see src/layers/decoys.ts).
        s = f'"route:/api/{poly.pick(_NOUNS)}/{poly.pick(_NOUNS)}"'
        lines.append(
            f"def {fn}(_x=0):\n"
            f"    if __REASHIELD_DECOY_NEVER__:\n"
            f"        global __REASHIELD_DECOY_TRIPWIRE__\n"
            f"        __REASHIELD_DECOY_TRIPWIRE__ += 1\n"
            f"        return {nxt}(_x) + len({s})\n"
            f"    return None"
        )
    hub = f"_featureHub_{poly.op_id('hub')[:5]}"
    names.append(hub)
    refs = " + ".join(f"{m}(1)" for m in members)
    lines.append(
        f"def {hub}():\n"
        f"    if __REASHIELD_DECOY_NEVER__:\n"
        f"        return {refs}\n"
        f"    return None"
    )
    return "\n".join(lines) + "\n", names
