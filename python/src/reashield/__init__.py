"""REAShield (Python) — defensive hardening against automated reverse engineering
of your OWN shipped Python code.

Honest promise: raises the cost of automated reverse engineering and defeats most
automated attempts. It does NOT make code unreversible — nothing shipped to
someone else's machine can be.
"""
from .config import load_config, normalize, ShieldConfig, ProtectEntry
from .pipeline import harden, build, Artifacts, State
from .polymorph import Polymorph
from .harness import measure, Report
from .runtime import in_process

__all__ = [
    "load_config", "normalize", "ShieldConfig", "ProtectEntry",
    "harden", "build", "Artifacts", "State",
    "Polymorph", "measure", "Report", "in_process",
]
__version__ = "0.1.0"
