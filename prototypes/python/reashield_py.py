"""
REAShield — Python front-end PROTOTYPE.

Proves the durable, language-agnostic pillar — SERVER-SIDE RELOCATION — transfers
beyond JavaScript. Mark a function; its real body is lifted into a generated
server handler and the client keeps only a remote-call stub. The secret never
ships. (This is a proof-of-concept of the pattern, not the full toolkit.)

Honest scope: same as the JS tool — raises the cost of automated reverse
engineering, does NOT make code unreversible. Relocation needs a backend you
secure.
"""
from __future__ import annotations
import ast
import hashlib
import sys


def _op_id(name: str) -> str:
    return "op_" + hashlib.sha256(name.encode()).hexdigest()[:8]


def _indent(src: str, n: int = 4) -> str:
    pad = " " * n
    return "\n".join(pad + line if line else line for line in src.splitlines())


CLIENT_RUNTIME = '''\
# --- reashield client runtime (injected) ---
_shield_transport = None

def configure_shield(transport):
    """Wire how relocated calls reach your server (HTTP, in-process, etc.)."""
    global _shield_transport
    _shield_transport = transport

def _shield_call(op, args):
    if _shield_transport is None:
        raise RuntimeError("reashield: transport not configured")
    return _shield_transport(op, args)
# --- end runtime ---
'''


def harden(source: str, relocate: set[str]):
    """Return (client_src, server_src, opmap). Relocated bodies leave the client."""
    tree = ast.parse(source)
    handlers: dict[str, tuple[list[str], str]] = {}
    opmap: dict[str, str] = {}

    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in relocate:
            op = _op_id(node.name)
            opmap[op] = node.name
            params = [a.arg for a in node.args.args]
            # Real body -> server (unparse the statements, re-indent under a def).
            body_src = ast.unparse(ast.Module(body=node.body, type_ignores=[]))
            handlers[op] = (params, body_src)
            # Client body -> opaque remote-call stub.
            stub = f"return _shield_call({op!r}, [{', '.join(params)}])"
            node.body = ast.parse(stub).body

    client_src = CLIENT_RUNTIME + "\n" + ast.unparse(tree) + "\n"

    parts = ["# REAShield server skeleton — holds the REAL logic. DO NOT SHIP."]
    for op, (params, body_src) in handlers.items():
        parts.append(f"def _h_{op}({', '.join(params)}):\n" + _indent(body_src))
    table = ", ".join(f"{op!r}: _h_{op}" for op in handlers)
    parts.append(f"_handlers = {{{table}}}")
    parts.append("def handle(op, args):\n    return _handlers[op](*args)")
    server_src = "\n\n".join(parts) + "\n"

    return client_src, server_src, opmap


def _main(argv):
    if len(argv) < 3:
        print("usage: reashield_py.py <input.py> --relocate name[,name...]")
        return 1
    inp = argv[1]
    names = set()
    if "--relocate" in argv:
        names = set(argv[argv.index("--relocate") + 1].split(","))
    src = open(inp).read()
    client, server, opmap = harden(src, names)
    out_client = inp.replace(".py", ".shielded.py")
    out_server = inp.replace(".py", ".server.py")
    open(out_client, "w").write(client)
    open(out_server, "w").write(server)
    print(f"relocated off-device: {', '.join(opmap.values()) or '(none)'}")
    print(f"client -> {out_client}")
    print(f"server -> {out_server}  (DO NOT SHIP; holds real logic)")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
