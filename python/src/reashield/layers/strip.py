"""Strip docstrings (source reduction). Comments aren't in the AST, so they're
already gone after a parse->unparse round-trip."""
from __future__ import annotations
import ast


def _is_docstring(stmt) -> bool:
    return (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Constant)
        and isinstance(stmt.value.value, str)
    )


def strip_docstrings(tree: ast.AST, state) -> None:
    removed = 0
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and _is_docstring(body[0]):
            # keep a valid body
            if len(body) == 1:
                body[0] = ast.Pass()
            else:
                del body[0]
            removed += 1
    state.notes.append(f"stripped {removed} docstring(s)")
