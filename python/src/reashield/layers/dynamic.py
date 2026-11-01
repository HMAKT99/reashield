"""Computed dispatch (parity with the JS dynamicGraph pillar).

Internal (non-exported) obfuscate-mode functions are moved behind a module-level
dispatch dict keyed by a RUNTIME-COMPUTED string, so static analysis sees
`_d[_rk(...)]` instead of a direct call — the kind of edge REA leaves unresolved.
Behavior-preserving: the dict is populated at import time and resolved at call
time.
"""
from __future__ import annotations
import ast


def _get_all(tree: ast.Module):
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__all__":
                    try:
                        return set(ast.literal_eval(node.value))
                    except Exception:
                        return set()
    return None


def _is_public(name: str, exported) -> bool:
    if exported is not None:
        return name in exported
    return not name.startswith("_")


def _computed_key(value: str) -> ast.expr:
    return ast.Call(
        func=ast.Name("_rk", ast.Load()),
        args=[ast.Constant(ord(c)) for c in value],
        keywords=[],
    )


class _Renamer(ast.NodeTransformer):
    def __init__(self, old: str, new: str):
        self.old, self.new = old, new

    def visit_Name(self, node: ast.Name):
        if node.id == self.old:
            node.id = self.new
        return node

    def visit_FunctionDef(self, node):
        if node.name == self.old:
            node.name = self.new
        self.generic_visit(node)
        return node

    visit_AsyncFunctionDef = visit_FunctionDef


class _LoadToTable(ast.NodeTransformer):
    def __init__(self, name: str, table: str, key: str):
        self.name, self.table, self.key = name, table, key

    def visit_Name(self, node: ast.Name):
        if node.id == self.name and isinstance(node.ctx, ast.Load):
            return ast.copy_location(
                ast.Subscript(
                    value=ast.Name(self.table, ast.Load()),
                    slice=_computed_key(self.key),
                    ctx=ast.Load(),
                ),
                node,
            )
        return node


RK_HELPER = "def _rk(*_c):\n    return ''.join((chr(_x) for _x in _c))\n"


def computed_dispatch(tree: ast.Module, state) -> bool:
    exported = _get_all(tree)
    targets = [
        e.name
        for e in state.config.protect
        if e.mode == "obfuscate"
        and e.name in state.mod.fns
        and not _is_public(e.name, exported)
    ]
    if not targets:
        return False

    table = state.poly.ident()
    assignments: list[str] = []
    for name in targets:
        fresh = state.poly.ident()
        _Renamer(name, fresh).visit(tree)
        key = state.poly.op_id("disp::" + name)
        _LoadToTable(fresh, table, key).visit(tree)
        # the def's own FunctionDef.name == fresh (a str, not a Name) is untouched
        assignments.append(f"{table}[_rk({', '.join(str(ord(c)) for c in key)})] = {fresh}")
        state.dispatched.append(name)

    extra = RK_HELPER + f"{table} = {{}}\n" + "\n".join(assignments) + "\n"
    tree.body.extend(ast.parse(extra).body)
    ast.fix_missing_locations(tree)
    return True
