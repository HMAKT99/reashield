"""Pillar 2: sealing. Ship the body as AES-GCM ciphertext; decrypt at runtime
with a server-fetched key. Decrypted code runs in the client's own globals."""
from __future__ import annotations
import ast
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from ..analyze import check_sealable, forward_spec, body_strings, renamed_def_source


def _derive(seed: str, op: str, tag: str, n: int) -> bytes:
    return hashlib.sha256((seed + "::" + tag + "::" + op).encode()).digest()[:n]


def seal(state) -> None:
    for entry in state.config.protect:
        if entry.mode != "seal":
            continue
        fn = state.mod.fns.get(entry.name)
        if fn is None:
            state.refusals.append((entry.name, ["not a top-level function in input"]))
            continue
        reasons = check_sealable(fn)
        if reasons:
            state.refusals.append((entry.name, reasons))
            continue

        op = state.poly.op_id(entry.name)
        state.opmap[op] = entry.name
        plaintext = renamed_def_source(fn.node, "_sealed_fn")
        state.removed_strings.extend(body_strings(fn.node))

        # Seed-derived key/iv -> reproducible builds; key is server-held only.
        key = _derive(state.poly.seed, op, "sk", 32)
        iv = _derive(state.poly.seed, op, "si", 12)
        ct = AESGCM(key).encrypt(iv, plaintext.encode(), None)
        state.keys[op] = base64.b64encode(key).decode()
        blob = {
            "iv": base64.b64encode(iv).decode(),
            "ct": base64.b64encode(ct).decode(),
        }

        args_src, kwargs_src = forward_spec(fn.node.args)
        call = f"_shield_sealed({op!r}, {blob!r}, {args_src}, {kwargs_src})"
        stub = f"return await {call}" if fn.is_async else f"return {call}"
        fn.node.body = ast.parse(stub).body
        fn.node.decorator_list = []
        state.sealed.append(entry.name)
