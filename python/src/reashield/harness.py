"""Static measurement harness: what can an attacker still read in the client?"""
from __future__ import annotations
import ast
from dataclasses import dataclass


def _strings(src: str) -> list[str]:
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) >= 3:
            out.append(n.value)
    return out


@dataclass
class Report:
    before_strings: int
    after_strings: int
    string_leak_ratio: float
    leaked_secrets: list[str]
    relocated: list[str]
    sealed: list[str]
    decoys: int

    @property
    def ok(self) -> bool:
        return not self.leaked_secrets


def measure(before_src: str, after_src: str, state) -> Report:
    before = {s for s in _strings(before_src)}
    # The hardened client is searched as raw text (obfuscation can wrap strings).
    survived = [s for s in before if s in after_src]
    removed = {s for s in state.removed_strings}
    leaked = sorted(s for s in removed if s in after_src)
    return Report(
        before_strings=len(before),
        after_strings=len(_strings(after_src)),
        string_leak_ratio=(len(survived) / len(before)) if before else 0.0,
        leaked_secrets=leaked,
        relocated=state.relocated,
        sealed=state.sealed,
        decoys=len(state.decoy_names),
    )
