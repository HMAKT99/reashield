"""reashield CLI: init | build | test | doctor."""
from __future__ import annotations
import argparse
import py_compile
import sys
from pathlib import Path

from .config import load_config
from .pipeline import build as build_artifacts
from .harness import measure

HONEST_LIMITS = """
Honest promise & limits:
  - Raises the cost of reverse engineering; defeats most AUTOMATED attempts.
  - Does NOT make code unreversible - nothing shipped to another machine can be.
  - relocate/seal need a secured backend + connectivity; the boundary is
    observable, and sealing does not stop a memory dump of decrypted code.
  - Defensive-only, behavior-preserving, transparent (no phone-home).
"""

SCAFFOLD = '''# REAShield config
input = "app.py"
output = "dist_shielded"
preset = "balanced"   # low | balanced | max
seed = "auto"

# [[protect]]
# name = "license_check"
# mode = "relocate"    # relocate | seal | obfuscate | none
'''


def _write_outputs(cwd: Path, out_dir: str, art) -> tuple[Path, Path | None]:
    out = cwd / out_dir
    out.mkdir(parents=True, exist_ok=True)
    client_path = out / "client.py"
    client_path.write_text(art.client)
    server_path = None
    if art.server:
        server_path = out / "server_skeleton.py"
        server_path.write_text(art.server)
    return client_path, server_path


def cmd_init(args):
    target = Path(args.config or "shield.toml")
    if target.exists():
        print(f"refusing to overwrite {target}")
        return 1
    target.write_text(SCAFFOLD)
    print(f"wrote {target}")
    print(HONEST_LIMITS)
    return 0


def cmd_build(args):
    config, cwd = load_config(args.config)
    art = build_artifacts(config, str(cwd))
    client_path, server_path = _write_outputs(cwd, config.output, art)
    print("REAShield build complete.\n")
    if art.state.relocated:
        print(f"  relocated off-device: {', '.join(art.state.relocated)}")
    if art.state.sealed:
        print(f"  sealed (ciphertext):  {', '.join(art.state.sealed)}")
    if art.state.mangled:
        print(f"  name-mangled:         {', '.join(art.state.mangled)}")
    if art.state.decoy_names:
        print(f"  decoys injected:      {len(art.state.decoy_names)}")
    for name, reasons in art.state.refusals:
        print(f"  REFUSED {name}: {'; '.join(reasons)}")
    print(f"\n  client -> {client_path.relative_to(cwd)}")
    if server_path:
        print(f"  server -> {server_path.relative_to(cwd)}  (DO NOT SHIP)")
    if config.layers.bytecode:
        pyc = py_compile.compile(str(client_path), optimize=2)
        print(f"  bytecode -> {pyc}")
    print(HONEST_LIMITS)
    return 0


def cmd_test(args):
    config, cwd = load_config(args.config)
    before = (cwd / config.input).read_text()
    art = build_artifacts(config, str(cwd))
    rep = measure(before, art.client, art.state)
    print("REAShield measurement (before = source, after = hardened client)\n")
    print(f"  string literals:     {rep.before_strings} -> {rep.after_strings}")
    print(f"  string leak ratio:   100% -> {rep.string_leak_ratio * 100:.1f}%")
    print(f"  off-device:          {', '.join(rep.relocated + rep.sealed) or '(none)'}")
    print(f"  secret strings leaked into client: {rep.leaked_secrets or '(none)'}")
    print(f"  decoys:              {rep.decoys}")
    for name, reasons in art.state.refusals:
        print(f"  REFUSED {name}: {'; '.join(reasons)}")
    ok = rep.ok
    print(f"\n  result: {'PASS' if ok else 'REVIEW'}")
    if args.strict and not ok:
        return 1
    return 0


def cmd_doctor(args):
    config, cwd = load_config(args.config)
    print(f"REAShield doctor\n  preset: {config.preset}   seed: {config.seed}\n")
    print("  protected symbols:")
    for p in config.protect:
        print(f"    - {p.name:<18} {p.mode}")
    if not config.protect:
        print("    (none configured)")
    print("\n  layers:")
    for k, v in vars(config.layers).items():
        print(f"    - {k:<20} {v}")
    print(HONEST_LIMITS)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="reashield", description="Harden your own Python against automated reverse engineering.")
    p.add_argument("--config", help="path to shield.toml")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    sub.add_parser("build")
    t = sub.add_parser("test")
    t.add_argument("--strict", action="store_true", help="exit non-zero on secret leak")
    sub.add_parser("doctor")
    args = p.parse_args(argv)
    return {"init": cmd_init, "build": cmd_build, "test": cmd_test, "doctor": cmd_doctor}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
