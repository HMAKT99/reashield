"""Pillar 1: server-side relocation. Move the real body off-device; leave a stub."""
from __future__ import annotations
import ast
from ..analyze import check_moveable, forward_spec, body_strings


def relocate(state) -> None:
    relocate_names = {e.name for e in state.config.protect if e.mode == "relocate"}
    for entry in state.config.protect:
        if entry.mode != "relocate":
            continue
        fn = state.mod.fns.get(entry.name)
        if fn is None:
            state.refusals.append((entry.name, ["not a top-level function in input"]))
            continue
        if fn.is_async:
            state.refusals.append((entry.name, ["async relocation not supported yet (use seal or keep it client-side)"]))
            continue
        reasons = check_moveable(fn, state.mod, relocate_names)
        if reasons:
            state.refusals.append((entry.name, reasons))
            continue  # fail safe: leave the function untouched, report why

        op = state.poly.op_id(entry.name)
        state.opmap[op] = entry.name
        # Server keeps the ORIGINAL function (name + full body) so relocated
        # functions can call each other and reach carried imports/constants.
        state.handlers[op] = (entry.name, ast.unparse(_clean(fn.node)))
        state.removed_strings.extend(body_strings(fn.node))

        args_src, kwargs_src = forward_spec(fn.node.args)
        if fn.is_async:
            stub = f"return await _shield_call_async({op!r}, {args_src}, {kwargs_src})"
        else:
            stub = f"return _shield_call({op!r}, {args_src}, {kwargs_src})"
        fn.node.body = ast.parse(stub).body
        fn.node.decorator_list = []
        state.relocated.append(entry.name)


def _clean(node):
    node.decorator_list = []
    return node
