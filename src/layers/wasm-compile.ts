import { parse } from "@babel/parser";
import type * as t from "@babel/types";

/**
 * A tiny, self-contained compiler from a NUMERIC SUBSET of JavaScript to a real
 * WebAssembly (f64) module — emitted as binary bytes, no external toolchain.
 * This moves hot numeric logic off REA's JS module-graph path entirely.
 *
 * Supported: numeric params; `const x = <expr>;` locals; a single `return <expr>`.
 * Expr: number literals, params/locals, + - * /, unary -, ternary `c ? a : b`,
 * comparisons and && || ! (in ternary conditions), and
 * Math.(max|min|abs|floor|ceil|round|sqrt|trunc). Anything else throws
 * `UnsupportedWasm` and the caller falls back to obfuscation.
 *
 * Honest limit: WASM is harder for REA's JS path and a different analysis league,
 * but it is not unbreakable — wasm can still be decompiled.
 */
export class UnsupportedWasm extends Error {}

// ---- WASM encoding helpers ----
function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}
function f64bytes(v: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, true);
  return Array.from(new Uint8Array(buf));
}
function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}
function section(id: number, content: number[]): number[] {
  return [id, ...uleb(content.length), ...content];
}
function nameBytes(s: string): number[] {
  const b = Array.from(new TextEncoder().encode(s));
  return [...uleb(b.length), ...b];
}

// opcodes
const OP = {
  f64_const: 0x44,
  local_get: 0x20,
  local_set: 0x21,
  f64_neg: 0x9a,
  f64_ceil: 0x9b,
  f64_floor: 0x9c,
  f64_trunc: 0x9d,
  f64_sqrt: 0x9f,
  f64_abs: 0x99,
  f64_add: 0xa0,
  f64_sub: 0xa1,
  f64_mul: 0xa2,
  f64_div: 0xa3,
  f64_min: 0xa4,
  f64_max: 0xa5,
  f64_eq: 0x61,
  f64_ne: 0x62,
  f64_lt: 0x63,
  f64_gt: 0x64,
  f64_le: 0x65,
  f64_ge: 0x66,
  i32_eqz: 0x45,
  i32_and: 0x71,
  i32_or: 0x72,
  select: 0x1b,
  end: 0x0b,
} as const;

interface Ctx {
  vars: Map<string, number>; // name -> local index
}

function compileExpr(node: t.Node, ctx: Ctx): number[] {
  switch (node.type) {
    case "NumericLiteral":
      return [OP.f64_const, ...f64bytes(node.value)];
    case "Identifier": {
      const idx = ctx.vars.get(node.name);
      if (idx === undefined)
        throw new UnsupportedWasm(`unknown identifier ${node.name}`);
      return [OP.local_get, ...uleb(idx)];
    }
    case "ParenthesizedExpression":
      return compileExpr((node as t.ParenthesizedExpression).expression, ctx);
    case "UnaryExpression": {
      const u = node as t.UnaryExpression;
      if (u.operator === "-") {
        if (u.argument.type === "NumericLiteral")
          return [OP.f64_const, ...f64bytes(-u.argument.value)];
        return [...compileExpr(u.argument, ctx), OP.f64_neg];
      }
      if (u.operator === "+") return compileExpr(u.argument, ctx);
      throw new UnsupportedWasm(`unary ${u.operator}`);
    }
    case "BinaryExpression": {
      const b = node as t.BinaryExpression;
      const op = (
        { "+": OP.f64_add, "-": OP.f64_sub, "*": OP.f64_mul, "/": OP.f64_div } as Record<
          string,
          number
        >
      )[b.operator];
      if (op === undefined) throw new UnsupportedWasm(`binary ${b.operator}`);
      if (b.left.type === "PrivateName") throw new UnsupportedWasm("private");
      return [...compileExpr(b.left, ctx), ...compileExpr(b.right, ctx), op];
    }
    case "ConditionalExpression": {
      const c = node as t.ConditionalExpression;
      // select pops [a, b, cond] -> a if cond!=0 else b
      return [
        ...compileExpr(c.consequent, ctx),
        ...compileExpr(c.alternate, ctx),
        ...compileCond(c.test, ctx),
        OP.select,
      ];
    }
    case "CallExpression":
      return compileMathCall(node as t.CallExpression, ctx);
    default:
      throw new UnsupportedWasm(`expr ${node.type}`);
  }
}

function compileMathCall(node: t.CallExpression, ctx: Ctx): number[] {
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "Math" ||
    callee.property.type !== "Identifier"
  )
    throw new UnsupportedWasm("only Math.* calls supported");
  const fn = callee.property.name;
  const args = node.arguments.map((a) => compileExpr(a as t.Node, ctx));
  const unary = (op: number) => {
    if (args.length !== 1) throw new UnsupportedWasm(`Math.${fn} arity`);
    return [...args[0], op];
  };
  switch (fn) {
    case "abs":
      return unary(OP.f64_abs);
    case "floor":
      return unary(OP.f64_floor);
    case "ceil":
      return unary(OP.f64_ceil);
    case "sqrt":
      return unary(OP.f64_sqrt);
    case "trunc":
      return unary(OP.f64_trunc);
    case "round": // JS Math.round(x) = floor(x + 0.5)
      if (args.length !== 1) throw new UnsupportedWasm("Math.round arity");
      return [...args[0], OP.f64_const, ...f64bytes(0.5), OP.f64_add, OP.f64_floor];
    case "max":
    case "min": {
      if (args.length < 2) throw new UnsupportedWasm(`Math.${fn} arity`);
      const op = fn === "max" ? OP.f64_max : OP.f64_min;
      let code = [...args[0], ...args[1], op];
      for (let i = 2; i < args.length; i++) code = [...code, ...args[i], op];
      return code;
    }
    default:
      throw new UnsupportedWasm(`Math.${fn}`);
  }
}

// Condition -> i32 (0/1)
function compileCond(node: t.Node, ctx: Ctx): number[] {
  switch (node.type) {
    case "ParenthesizedExpression":
      return compileCond((node as t.ParenthesizedExpression).expression, ctx);
    case "UnaryExpression": {
      const u = node as t.UnaryExpression;
      if (u.operator === "!") return [...compileCond(u.argument, ctx), OP.i32_eqz];
      throw new UnsupportedWasm(`cond unary ${u.operator}`);
    }
    case "LogicalExpression": {
      const l = node as t.LogicalExpression;
      const op = l.operator === "&&" ? OP.i32_and : l.operator === "||" ? OP.i32_or : undefined;
      if (op === undefined) throw new UnsupportedWasm(`logical ${l.operator}`);
      return [...compileCond(l.left, ctx), ...compileCond(l.right, ctx), op];
    }
    case "BinaryExpression": {
      const b = node as t.BinaryExpression;
      const cmp = (
        {
          "<": OP.f64_lt,
          ">": OP.f64_gt,
          "<=": OP.f64_le,
          ">=": OP.f64_ge,
          "===": OP.f64_eq,
          "==": OP.f64_eq,
          "!==": OP.f64_ne,
          "!=": OP.f64_ne,
        } as Record<string, number>
      )[b.operator];
      if (cmp === undefined) throw new UnsupportedWasm(`cmp ${b.operator}`);
      if (b.left.type === "PrivateName") throw new UnsupportedWasm("private");
      return [...compileExpr(b.left, ctx), ...compileExpr(b.right, ctx), cmp];
    }
    default:
      throw new UnsupportedWasm(`cond ${node.type}`);
  }
}

/** Compile `function(params){ bodySource }` to a WASM module. Throws if unsupported. */
export function compileNumericToWasm(
  params: string[],
  bodySource: string,
): Uint8Array {
  if (params.some((p) => p.startsWith("...") || !/^[A-Za-z_$][\w$]*$/.test(p)))
    throw new UnsupportedWasm("only simple numeric params");

  const file = parse(`function __t(${params.join(",")}) ${bodySource}`, {
    sourceType: "module",
  });
  const fn = file.program.body[0] as t.FunctionDeclaration;
  const stmts = fn.body.body;

  const ctx: Ctx = { vars: new Map() };
  params.forEach((p, i) => ctx.vars.set(p, i));
  let nextLocal = params.length;
  const code: number[] = [];
  let returned = false;

  for (const stmt of stmts) {
    if (returned) throw new UnsupportedWasm("code after return");
    if (stmt.type === "VariableDeclaration") {
      if (stmt.kind !== "const") throw new UnsupportedWasm("only const locals");
      for (const d of stmt.declarations) {
        if (d.id.type !== "Identifier" || !d.init)
          throw new UnsupportedWasm("bad const");
        code.push(...compileExpr(d.init, ctx));
        const idx = nextLocal++;
        ctx.vars.set(d.id.name, idx);
        code.push(OP.local_set, ...uleb(idx));
      }
    } else if (stmt.type === "ReturnStatement") {
      if (!stmt.argument) throw new UnsupportedWasm("empty return");
      code.push(...compileExpr(stmt.argument, ctx));
      returned = true;
    } else {
      throw new UnsupportedWasm(`stmt ${stmt.type}`);
    }
  }
  if (!returned) throw new UnsupportedWasm("no return");

  const localCount = nextLocal - params.length;
  const F64 = 0x7c;

  const typeSec = section(1, vec([[0x60, ...vec([...Array(params.length).fill(F64)].map((v) => [v])), ...vec([[F64]])]]));
  const funcSec = section(3, vec([[0]]));
  const exportSec = section(7, [...uleb(1), ...nameBytes("f"), 0x00, 0x00]);
  const locals = localCount > 0 ? [...uleb(1), ...uleb(localCount), F64] : [0x00];
  const body = [...locals, ...code, OP.end];
  const codeSec = section(10, vec([[...uleb(body.length), ...body]]));

  const mod = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSec,
    ...funcSec,
    ...exportSec,
    ...codeSec,
  ];
  return Uint8Array.from(mod);
}
