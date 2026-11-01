"""Parse + locate protected targets + SAFETY analysis.

The foolproofing core: before we move or seal any function we prove it is safe
to do so. If a body references names that can't follow it off-device, or uses a
construct we can't preserve, we REFUSE that symbol with a precise reason instead
of silently producing wrong behavior.
"""
from __future__ import annotations
import ast
import builtins
from dataclasses import dataclass, field

_BUILTINS = set(dir(builtins))


@dataclass
class FnInfo:
    name: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    is_async: bool
    free_names: set[str]
    has_yield: bool
    has_nonlocal: bool
    has_decorator: bool


@dataclass
class Module:
    tree: ast.Module
    source: str
    fns: dict[str, FnInfo]
    top_level_funcs: set[str]
    top_level_names: set[str]  # funcs + imports + assigns
    carried_imports: list[str]  # unparsed import stmts (go to server)
    carried_assigns: list[str]  # unparsed module-level assignments (go to server)


class _FreeVars(ast.NodeVisitor):
    """Collect names LOADed in a function that are not bound within it."""

    def __init__(self, params: set[str]):
        self.bound = set(params)
        self.free: set[str] = set()
        self.has_yield = False
        self.has_nonlocal = False

    def visit_Name(self, node: ast.Name):
        if isinstance(node.ctx, ast.Store):
            self.bound.add(node.id)
        elif isinstance(node.ctx, ast.Load):
            if node.id not in self.bound and node.id not in _BUILTINS:
                self.free.add(node.id)

    def visit_arg(self, node: ast.arg):
        self.bound.add(node.arg)

    def visit_Yield(self, node):  # noqa: N802
        self.has_yield = True
        self.generic_visit(node)

    def visit_YieldFrom(self, node):  # noqa: N802
        self.has_yield = True
        self.generic_visit(node)

    def visit_Nonlocal(self, node):  # noqa: N802
        self.has_nonlocal = True

    # nested funcs/classes: record their name as bound, don't descend into scope
    def visit_FunctionDef(self, node):  # noqa: N802
        self.bound.add(node.name)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):  # noqa: N802
        self.bound.add(node.name)


def _param_names(args: ast.arguments) -> set[str]:
    names = set()
    for a in args.posonlyargs + args.args + args.kwonlyargs:
        names.add(a.arg)
    if args.vararg:
        names.add(args.vararg.arg)
    if args.kwarg:
        names.add(args.kwarg.arg)
    return names


def parse_module(source: str) -> Module:
    tree = ast.parse(source)
    fns: dict[str, FnInfo] = {}
    top_level_funcs: set[str] = set()
    carried_imports: list[str] = []
    carried_assigns: list[str] = []
    top_level_names: set[str] = set()

    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            carried_imports.append(ast.unparse(node))
            for alias in node.names:
                top_level_names.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            carried_assigns.append(ast.unparse(node))
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name):
                    top_level_names.add(t.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            top_level_funcs.add(node.name)
            top_level_names.add(node.name)
            params = _param_names(node.args)
            fv = _FreeVars(params)
            for stmt in node.body:
                fv.visit(stmt)
            fns[node.name] = FnInfo(
                name=node.name,
                node=node,
                is_async=isinstance(node, ast.AsyncFunctionDef),
                free_names=fv.free,
                has_yield=fv.has_yield,
                has_nonlocal=fv.has_nonlocal,
                has_decorator=bool(node.decorator_list),
            )

    return Module(
        tree=tree,
        source=source,
        fns=fns,
        top_level_funcs=top_level_funcs,
        top_level_names=top_level_names,
        carried_imports=carried_imports,
        carried_assigns=carried_assigns,
    )


def check_moveable(fn: FnInfo, mod: Module, protected_names: set[str]) -> list[str]:
    """Return a list of reasons the function CANNOT be moved off-device.

    Empty list == safe. Non-empty == refuse with these reasons.
    """
    reasons: list[str] = []
    if fn.has_decorator:
        reasons.append("has a decorator (semantics can't be preserved off-device)")
    if fn.has_yield:
        reasons.append("is a generator (uses yield)")
    if fn.has_nonlocal:
        reasons.append("uses nonlocal (closure over an enclosing scope)")
    for name in sorted(fn.free_names):
        if name in protected_names:
            continue  # it will also live on the server
        if name in mod.top_level_funcs:
            reasons.append(
                f"calls top-level '{name}' which is not protected — "
                f"add it to protect (relocate/seal) or inline it"
            )
        elif name in mod.top_level_names:
            continue  # module import/assign — carried to the server
        else:
            reasons.append(f"references '{name}', which cannot follow it off-device")
    return reasons


def forward_spec(args: ast.arguments) -> tuple[str, str]:
    """Build (args_list_src, kwargs_dict_src) that faithfully forward a call."""
    pos = [a.arg for a in args.posonlyargs + args.args]
    pos_src = ", ".join(pos)
    if args.vararg:
        pos_src = (pos_src + ", " if pos_src else "") + f"*{args.vararg.arg}"

    kw_items = [f"{a.arg!r}: {a.arg}" for a in args.kwonlyargs]
    if args.kwarg:
        kw_items.append(f"**{args.kwarg.arg}")
    kw_src = "{" + ", ".join(kw_items) + "}"
    return f"[{pos_src}]", kw_src


def signature_src(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """Exact 'def name(sig)' line via a cloned node with an empty body."""
    clone = ast.AsyncFunctionDef if isinstance(node, ast.AsyncFunctionDef) else ast.FunctionDef
    stub = clone(
        name=node.name,
        args=node.args,
        body=[ast.Pass()],
        decorator_list=[],
        returns=None,
        type_comment=None,
        type_params=getattr(node, "type_params", []),
    )
    ast.fix_missing_locations(stub)
    header = ast.unparse(stub).splitlines()[0]  # 'def name(...):' or 'async def ...'
    return header


def body_strings(node) -> list[str]:
    """Distinctive string literals inside a function body (for leak metrics)."""
    out: list[str] = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            if len(sub.value) >= 4:
                out.append(sub.value)
    return out


def check_sealable(fn: FnInfo) -> list[str]:
    """Sealed code runs in the CLIENT's own globals, so free vars are fine;
    only unpreservable constructs are refused."""
    reasons = []
    if fn.has_decorator:
        reasons.append("has a decorator")
    if fn.has_yield:
        reasons.append("is a generator (uses yield)")
    if fn.has_nonlocal:
        reasons.append("uses nonlocal")
    return reasons


def renamed_def_source(node, new_name: str) -> str:
    """Unparse the function with a different name, no decorators."""
    cls = ast.AsyncFunctionDef if isinstance(node, ast.AsyncFunctionDef) else ast.FunctionDef
    clone = cls(
        name=new_name,
        args=node.args,
        body=node.body,
        decorator_list=[],
        returns=getattr(node, "returns", None),
        type_comment=None,
        type_params=getattr(node, "type_params", []),
    )
    ast.fix_missing_locations(clone)
    return ast.unparse(clone)
