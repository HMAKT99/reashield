"""String indirection + internal name mangling (the replaceable outer skin)."""
from __future__ import annotations
import ast
import base64

OBF_HEADER = (
    "import base64 as _rb64\n"
    "def _s(_x):\n    return _rb64.b64decode(_x).decode()\n"
)


class _StringHider(ast.NodeTransformer):
    def __init__(self):
        self.count = 0

    def visit_Constant(self, node: ast.Constant):
        if isinstance(node.value, str) and 3 <= len(node.value) <= 200:
            self.count += 1
            enc = base64.b64encode(node.value.encode()).decode()
            call = ast.Call(
                func=ast.Name(id="_s", ctx=ast.Load()),
                args=[ast.Constant(value=enc)],
                keywords=[],
            )
            return ast.copy_location(call, node)
        return node


def string_indirection(tree: ast.AST, state) -> bool:
    hider = _StringHider()
    hider.visit(tree)
    if hider.count:
        state.notes.append(f"string indirection: {hider.count} literal(s) hidden")
        return True
    return False


class _Renamer(ast.NodeTransformer):
    def __init__(self, mapping: dict[str, str]):
        self.m = mapping

    def visit_Name(self, node: ast.Name):
        if node.id in self.m:
            node.id = self.m[node.id]
        return node

    def visit_FunctionDef(self, node):
        if node.name in self.m:
            node.name = self.m[node.name]
        self.generic_visit(node)
        return node

    visit_AsyncFunctionDef = visit_FunctionDef


def name_mangling(tree: ast.Module, state) -> None:
    exported = None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__all__":
                    try:
                        exported = set(ast.literal_eval(node.value))
                    except Exception:
                        exported = set()
    mapping: dict[str, str] = {}
    for entry in state.config.protect:
        if entry.mode != "obfuscate":
            continue
        name = entry.name
        if name not in state.mod.fns:
            continue
        is_public = (exported is not None and name in exported) or (
            exported is None and not name.startswith("_")
        )
        if is_public:
            state.notes.append(f"name mangling: kept public API name {name!r}")
            continue
        mapping[name] = state.poly.ident()
        state.mangled.append(name)
    if mapping:
        _Renamer(mapping).visit(tree)
