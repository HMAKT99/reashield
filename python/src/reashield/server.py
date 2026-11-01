"""Generate the server skeleton that holds the real relocated logic + seal keys.

DO NOT SHIP the generated server to end users. Secure its endpoint yourself
(auth + TLS + rate limiting) — `set_auth_verifier` wires the seam; you supply
the verifier.
"""
from __future__ import annotations


def _header(wire_key: bytes) -> str:
    return f'''# REAShield server skeleton — holds the REAL logic + keys. DO NOT SHIP.
import json as _json, base64 as _b64

_WK = {wire_key!r}

def _opaque(obj):
    s = _json.dumps(obj).encode()
    out = bytes(b ^ _WK[i % len(_WK)] for i, b in enumerate(s))
    return _b64.b64encode(out).decode()

def _unopaque(s):
    raw = _b64.b64decode(s)
    out = bytes(b ^ _WK[i % len(_WK)] for i, b in enumerate(raw))
    return _json.loads(out.decode())

class ShieldUnauthorized(Exception):
    pass

_auth_verify = None

def set_auth_verifier(fn):
    """Until you set this, the endpoint is OPEN. Secure it before shipping."""
    global _auth_verify
    _auth_verify = fn
'''


_HANDLE = '''def handle(payload):
    if _auth_verify is not None:
        if not _auth_verify(payload.get("t")):
            raise ShieldUnauthorized("reashield: unauthorized")
    args, kwargs = _unopaque(payload["d"])
    fn = _handlers[payload["op"]]
    return {"d": _opaque(fn(*args, **kwargs))}

def get_key(op):
    k = _keys.get(op)
    if k is None:
        raise KeyError("reashield: unknown sealed op")
    return k
'''


def server_source(state) -> str:
    parts = [_header(state.poly.wire_key())]
    parts.extend(state.mod.carried_imports)
    parts.extend(state.mod.carried_assigns)
    for op, (name, defsrc) in state.handlers.items():
        parts.append(defsrc)
    table = ", ".join(f"{op!r}: {name}" for op, (name, _) in state.handlers.items())
    parts.append(f"_handlers = {{{table}}}")
    keys = ", ".join(f"{op!r}: {k!r}" for op, k in state.keys.items())
    parts.append(f"_keys = {{{keys}}}")
    parts.append(_HANDLE)
    return "\n\n".join(parts) + "\n"
