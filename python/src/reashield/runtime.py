"""Client runtime template + in-process transport.

The runtime is prepended to the hardened client. It is dependency-light; the
`cryptography` import only happens if a sealed module is actually invoked.

Honest note: `_opaque` is wire OBFUSCATION, not confidentiality — use TLS for
that. Sealed modules use real AES-GCM with a server-fetched key (never shipped).
"""
from __future__ import annotations


def client_runtime(wire_key: bytes) -> str:
    return f'''# --- reashield client runtime (injected) ---
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

_shield_transport = None
_shield_key_transport = None
_shield_auth = None

def configure_shield(transport=None, key_transport=None, auth_token=None):
    """Wire how relocated/sealed calls reach your server."""
    global _shield_transport, _shield_key_transport, _shield_auth
    if transport is not None: _shield_transport = transport
    if key_transport is not None: _shield_key_transport = key_transport
    if auth_token is not None: _shield_auth = auth_token

def _payload(op, args, kwargs):
    p = {{"op": op, "d": _opaque([list(args), kwargs])}}
    if _shield_auth is not None:
        p["t"] = _shield_auth() if callable(_shield_auth) else _shield_auth
    return p

def _shield_call(op, args, kwargs):
    if _shield_transport is None:
        raise RuntimeError("reashield: transport not configured (call configure_shield)")
    r = _shield_transport(_payload(op, args, kwargs))
    return _unopaque(r["d"])

async def _shield_call_async(op, args, kwargs):
    if _shield_transport is None:
        raise RuntimeError("reashield: transport not configured (call configure_shield)")
    r = _shield_transport(_payload(op, args, kwargs))
    if hasattr(r, "__await__"):
        r = await r
    return _unopaque(r["d"])

_seal_cache = {{}}
def _shield_sealed(op, blob, args, kwargs):
    fn = _seal_cache.get(op)
    if fn is None:
        if _shield_key_transport is None:
            raise RuntimeError("reashield: key_transport not configured")
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = _b64.b64decode(_shield_key_transport(op))
        iv = _b64.b64decode(blob["iv"])
        ct = _b64.b64decode(blob["ct"])
        src = AESGCM(key).decrypt(iv, ct, None).decode()
        ns = dict(globals())
        exec(compile(src, "<reashield-sealed>", "exec"), ns)
        fn = ns["_sealed_fn"]
        _seal_cache[op] = fn
    return fn(*args, **kwargs)
# --- end runtime ---
'''


def in_process(server_module):
    """Return (transport, key_transport) that call the server skeleton directly.

    Used by `reashield test` and host test suites to exercise relocated/sealed
    code without standing up a real server. Behavior is identical either way.
    """
    def transport(payload):
        return server_module.handle(payload)

    def key_transport(op):
        return server_module.get_key(op)

    return transport, key_transport
