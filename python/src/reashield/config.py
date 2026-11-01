"""Config loading + normalization (shield.toml or [tool.reashield] in pyproject)."""
from __future__ import annotations
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

MODES = {"relocate", "seal", "obfuscate", "none"}
PRESETS = {"low", "balanced", "max"}


@dataclass
class ProtectEntry:
    name: str
    mode: str = "obfuscate"


@dataclass
class Layers:
    string_indirection: bool = True
    name_mangling: bool = True
    dynamic_graph: bool = True
    decoys_enabled: bool = True
    decoy_count: int = 5
    strip: bool = True
    bytecode: bool = False


@dataclass
class ShieldConfig:
    input: str = "app.py"
    output: str = "dist_shielded"
    preset: str = "balanced"
    seed: str = "auto"
    protect: list[ProtectEntry] = field(default_factory=list)
    layers: Layers = field(default_factory=Layers)


def _layers_for_preset(preset: str) -> Layers:
    if preset == "low":
        return Layers(string_indirection=False, name_mangling=True, dynamic_graph=False,
                      decoys_enabled=True, decoy_count=2, strip=True, bytecode=False)
    if preset == "max":
        return Layers(string_indirection=True, name_mangling=True, dynamic_graph=True,
                      decoys_enabled=True, decoy_count=15, strip=True, bytecode=True)
    return Layers()  # balanced defaults


def normalize(raw: dict) -> ShieldConfig:
    preset = raw.get("preset", "balanced")
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r} (low|balanced|max)")
    layers = _layers_for_preset(preset)
    for k, v in (raw.get("layers") or {}).items():
        if hasattr(layers, k):
            setattr(layers, k, v)

    protect: list[ProtectEntry] = []
    for p in raw.get("protect", []):
        if isinstance(p, str):
            protect.append(ProtectEntry(p, "obfuscate"))
        else:
            mode = p.get("mode", "obfuscate")
            if mode not in MODES:
                raise ValueError(f"protect {p.get('name')!r}: unknown mode {mode!r}")
            protect.append(ProtectEntry(p["name"], mode))

    return ShieldConfig(
        input=raw.get("input", "app.py"),
        output=raw.get("output", "dist_shielded"),
        preset=preset,
        seed=raw.get("seed", "auto"),
        protect=protect,
        layers=layers,
    )


def load_config(path: str | None = None, cwd: str = ".") -> tuple[ShieldConfig, Path]:
    base = Path(cwd)
    if path:
        cfg_path = base / path
        raw = tomllib.loads(cfg_path.read_text())
        return normalize(raw), cfg_path.parent
    for cand in ("shield.toml",):
        p = base / cand
        if p.exists():
            return normalize(tomllib.loads(p.read_text())), p.parent
    pp = base / "pyproject.toml"
    if pp.exists():
        data = tomllib.loads(pp.read_text())
        tool = data.get("tool", {}).get("reashield")
        if tool:
            return normalize(tool), pp.parent
    raise FileNotFoundError("no shield.toml or [tool.reashield]; run `reashield init`")
