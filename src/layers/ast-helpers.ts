import { parse } from "@babel/parser";
import type * as t from "@babel/types";

/** Parse a single function-declaration snippet and return its body block. */
export function stubBody(code: string): t.BlockStatement {
  const file = parse(code, { sourceType: "module" });
  const decl = file.program.body[0] as t.FunctionDeclaration;
  return decl.body;
}

/** Parse a single expression snippet into an expression node. */
export function exprFrom(code: string): t.Expression {
  const file = parse("(" + code + ")", { sourceType: "module" });
  const stmt = file.program.body[0] as t.ExpressionStatement;
  return stmt.expression;
}

/** Build the args-array source for a stub from extracted param names. */
export function argListSource(params: string[]): string {
  return params
    .map((p) => (p.startsWith("...") ? "..." + p.slice(3) : p))
    .join(", ");
}

/** A runtime-computed string key so static analysis sees it unresolved. */
export function computedKeyExpr(value: string): string {
  const codes = Array.from(value).map((c) => c.charCodeAt(0));
  return `String.fromCharCode(${codes.join(",")})`;
}
