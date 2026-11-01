"""Orchestrate the layers into a hardened client + server skeleton."""
from __future__ import annotations
import ast
from dataclasses import dataclass, field
from pathlib import Path

from .analyze import Module, parse_module
from .config import ShieldConfig
from .polymorph import Polymorph
from .runtime import client_runtime
from .server import server_source
from .layers.relocate import relocate
from .layers.seal import seal
from .layers.strip import strip_docstrings
from .layers.obfuscate import string_indirection, name_mangling, OBF_HEADER
from .layers.decoys import decoy_source


@dataclass
class State:
    config: ShieldConfig
    poly: Polymorph
    mod: Module
    handlers: dict = field(default_factory=dict)      # op -> (name, def_src)
    keys: dict = field(default_factory=dict)          # op -> key b64
    opmap: dict = field(default_factory=dict)
    relocated: list = field(default_factory=list)
    sealed: list = field(default_factory=list)
    mangled: list = field(default_factory=list)
    decoy_names: list = field(default_factory=list)
    removed_strings: list = field(default_factory=list)
    notes: list = field(default_factory=list)
    refusals: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


@dataclass
class Artifacts:
    client: str
    server: str
    state: State


def harden(source: str, config: ShieldConfig) -> Artifacts:
    poly = Polymorph(config.seed)
    mod = parse_module(source)
    state = State(config=config, poly=poly, mod=mod)

    # source-level pillars (mutate the client tree, collect server artifacts)
    relocate(state)
    seal(state)

    if config.layers.strip:
        strip_docstrings(mod.tree, state)
    needs_obf = False
    if config.layers.string_indirection:
        needs_obf = string_indirection(mod.tree, state)
    if config.layers.name_mangling:
        name_mangling(mod.tree, state)

    ast.fix_missing_locations(mod.tree)
    client_body = ast.unparse(mod.tree)

    header = ""
    if state.relocated or state.sealed:
        header += client_runtime(poly.wire_key()) + "\n"
    if needs_obf:
        header += OBF_HEADER + "\n"
    client = header + client_body + "\n"

    if config.layers.decoys_enabled and config.layers.decoy_count > 0:
        dsrc, names = decoy_source(
            config.layers.decoy_count, poly, [p.name for p in config.protect]
        )
        client += "\n" + dsrc
        state.decoy_names = names

    server = ""
    if state.handlers or state.keys:
        server = server_source(state)

    return Artifacts(client=client, server=server, state=state)


def build(config: ShieldConfig, cwd: str = ".") -> Artifacts:
    src = (Path(cwd) / config.input).read_text()
    return harden(src, config)
