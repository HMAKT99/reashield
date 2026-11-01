"""Seeded, deterministic randomization (mirrors the JS polymorph engine).

Same seed -> identical build; "auto" -> a fresh seed each build, so two releases
differ in names and structure (defeats diff-based version comparison).
"""
from __future__ import annotations
import hashlib
import random
import secrets

_HOMOGLYPHS = "lIoO0cueaxnmrsz"


class Polymorph:
    def __init__(self, seed: str = "auto") -> None:
        self.seed = secrets.token_hex(8) if seed == "auto" else seed
        digest = hashlib.sha256(self.seed.encode()).digest()
        self._rng = random.Random(int.from_bytes(digest, "big"))
        self._ctr = 0

    def rand(self) -> float:
        return self._rng.random()

    def pick(self, items):
        return items[self._rng.randrange(len(items))]

    def op_id(self, logical: str) -> str:
        return "op_" + hashlib.sha256(
            (self.seed + "::op::" + logical).encode()
        ).hexdigest()[:10]

    def ident(self) -> str:
        self._ctr += 1
        n = 6 + self._rng.randrange(5)
        body = "".join(self._rng.choice(_HOMOGLYPHS) for _ in range(n))
        tail = hashlib.sha1((self.seed + str(self._ctr)).encode()).hexdigest()[:3]
        return "_" + body + tail

    def wire_key(self) -> bytes:
        return hashlib.sha256((self.seed + "::wire").encode()).digest()[:16]
