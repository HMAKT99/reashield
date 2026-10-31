import { createHash, createCipheriv } from "node:crypto";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import type { Binding } from "@babel/traverse";
import { traverse, type ExtractedFn } from "../analyze/extract.js";
import type { Polymorph, ShieldConfig } from "../types.js";
import { argListSource, computedKeyExpr, stubBody } from "./ast-helpers.js";

export interface TransformState {
  config: ShieldConfig;
  poly: Polymorph;
  handlers: Record<string, string>; // opId -> "async function(..){..}"
  keys: Record<string, string>; // opId -> base64 AES key (sealed)
  opMap: Record<string, string>; // opId -> logical name
  relocated: string[];
  sealed: string[];
  dispatched: string[];
  channelsRewritten: number;
  ipcRewritten: number;
  removedStrings: string[];
  renamed: string[];
  warnings: string[];
  notes: string[];
}


function collectBodyStrings(bodySource: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\]{4,})"|'([^'\\]{4,})'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodySource))) out.push(m[1] ?? m[2]);
  return out;
}

function parseStatements(code: string): t.Statement[] {
  return parse(code, { sourceType: "module" }).program.body;
}

function setAsyncAndBody(node: t.Function, body: t.BlockStatement): void {
  (node as t.FunctionDeclaration).async = true;
  if (node.type === "ArrowFunctionExpression") {
    node.body = body;
    node.expression = false;
  } else {
    (node as t.FunctionDeclaration | t.FunctionExpression).body = body;
  }
}

/** Find the top-level function node for `name` and hand it to `mutate`. */
function withFunctionNode(
  ast: t.File,
  name: string,
  mutate: (node: t.Function) => void,
): boolean {
  let done = false;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (done) return;
      if (path.node.id?.name === name && !path.getFunctionParent()) {
        mutate(path.node);
        done = true;
        path.stop();
      }
    },
    VariableDeclarator(path) {
      if (done) return;
      const init = path.node.init;
      if (
        path.node.id.type === "Identifier" &&
        path.node.id.name === name &&
        init &&
        (init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression")
      ) {
        mutate(init);
        done = true;
        path.stop();
      }
    },
  });
  return done;
}

/** Pillar 1: move the real body to the server; leave an opaque remote stub. */
export function relocate(
  ast: t.File,
  fns: Map<string, ExtractedFn>,
  state: TransformState,
): void {
  for (const entry of state.config.protect) {
    if (entry.mode !== "relocate") continue;
    const fn = fns.get(entry.name);
    if (!fn) {
      state.warnings.push(`relocate: "${entry.name}" not found in input`);
      continue;
    }
    const op = state.poly.opId(entry.name);
    state.opMap[op] = entry.name;
    const params = fn.params.join(", ");
    state.handlers[op] = `async function(${params}) ${fn.bodySource}`;
    state.removedStrings.push(...collectBodyStrings(fn.bodySource));
    const args = argListSource(fn.params);
    const body = stubBody(
      `function __t(${params}){ return __shield.call(${JSON.stringify(op)}, [${args}]); }`,
    );
    if (withFunctionNode(ast, entry.name, (n) => setAsyncAndBody(n, body)))
      state.relocated.push(entry.name);
  }
}

/** Pillar 2 (max): ship ciphertext; decrypt at runtime with a server key. */
export function seal(
  ast: t.File,
  fns: Map<string, ExtractedFn>,
  state: TransformState,
): void {
  for (const entry of state.config.protect) {
    if (entry.mode !== "seal") continue;
    const fn = fns.get(entry.name);
    if (!fn) {
      state.warnings.push(`seal: "${entry.name}" not found in input`);
      continue;
    }
    const op = state.poly.opId(entry.name);
    state.opMap[op] = entry.name;
    const params = fn.params.join(", ");
    const plaintext = `async function(${params}) ${fn.bodySource}`;
    state.removedStrings.push(...collectBodyStrings(fn.bodySource));

    // Derive key/iv from the build seed so seeded builds are reproducible
    // (and auto-seed builds still rotate). The key is server-held, never shipped.
    const key = createHash("sha256").update(state.poly.seed + "::sk::" + op).digest();
    const iv = createHash("sha256").update(state.poly.seed + "::si::" + op).digest().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blobCt = Buffer.concat([ct, tag]).toString("base64"); // ct||tag for WebCrypto
    state.keys[op] = key.toString("base64");

    const blobLiteral = JSON.stringify({
      iv: iv.toString("base64"),
      ct: blobCt,
    });
    const args = argListSource(fn.params);
    const body = stubBody(
      `function __t(${params}){ return __shield.sealed(${JSON.stringify(op)}, ${blobLiteral}, [${args}]); }`,
    );
    if (withFunctionNode(ast, entry.name, (n) => setAsyncAndBody(n, body)))
      state.sealed.push(entry.name);
  }
}

/** Pillar 4 (max/opt-in): route INTERNAL protected calls through a computed table. */
export function dynamicGraph(
  ast: t.File,
  fns: Map<string, ExtractedFn>,
  state: TransformState,
): void {
  const targets = state.config.protect
    .filter((p) => p.mode === "obfuscate" && fns.has(p.name))
    .map((p) => p.name);
  if (targets.length === 0) return;

  const tableName = state.poly.ident();
  const assignments: string[] = [];

  for (const name of targets) {
    let binding: Binding | undefined;
    let exported = false;
    traverse(ast, {
      Program(path) {
        binding = path.scope.getBinding(name) ?? undefined;
      },
    });
    if (!binding) continue;
    // Never rewrite an exported symbol — that would change the public API.
    const declParent = binding.path.parentPath;
    if (
      declParent?.isExportNamedDeclaration() ||
      declParent?.isExportDefaultDeclaration()
    ) {
      exported = true;
    }
    if (exported) {
      state.notes.push(`dynamicGraph: skipped exported "${name}"`);
      continue;
    }

    const id = state.poly.opId("disp::" + name);
    state.opMap[id] = name;
    const fresh = state.poly.ident();
    binding.scope.rename(name, fresh);
    assignments.push(`${tableName}[${computedKeyExpr(id)}] = ${fresh};`);

    traverse(ast, {
      Identifier(path) {
        if (path.node.name !== fresh) return;
        // Skip the declaration's own id (function or variable name).
        const pp = path.parentPath;
        if (
          (pp.isFunctionDeclaration() && pp.node.id === path.node) ||
          (pp.isVariableDeclarator() && pp.node.id === path.node)
        )
          return;
        path.replaceWithSourceString(
          `${tableName}[${computedKeyExpr(id)}]`,
        );
      },
    });
    state.dispatched.push(name);
  }

  if (assignments.length) {
    ast.program.body.push(
      ...parseStatements(`const ${tableName} = {};\n${assignments.join("\n")}`),
    );
  }
}

/** Pillar 5: literal route/channel-like strings -> runtime-computed strings. */
export function dynamicChannels(ast: t.File, state: TransformState): void {
  const channelish = (s: string) =>
    /^\/[a-zA-Z0-9/_:-]+$/.test(s) ||
    /^[a-z0-9]+(?:[-:.][a-z0-9]+)+$/.test(s);
  traverse(ast, {
    StringLiteral(path) {
      const v = path.node.value;
      if (v.length < 3 || v.length > 120) return;
      if (!channelish(v)) return;
      const pp = path.parentPath;
      if (
        pp.isImportDeclaration() ||
        (pp.isCallExpression() &&
          pp.node.callee.type === "Identifier" &&
          pp.node.callee.name === "require")
      )
        return;
      path.replaceWithSourceString(computedKeyExpr(v));
      state.channelsRewritten += 1;
    },
  });
}


/**
 * Name homogenization: rename every protected symbol that is NOT part of the
 * public API to a confusable, meaningless identifier, so no husk name survives
 * for REA to anchor on. Exported names are preserved (API contract).
 */
export function homogenizeProtected(
  ast: t.File,
  state: TransformState,
): void {
  for (const entry of state.config.protect) {
    let binding: Binding | undefined;
    traverse(ast, {
      Program(path) {
        binding = path.scope.getBinding(entry.name) ?? undefined;
        path.stop();
      },
    });
    if (!binding) continue; // already renamed (e.g. by dynamicGraph) or absent
    const dp = binding.path.parentPath;
    if (dp?.isExportNamedDeclaration() || dp?.isExportDefaultDeclaration()) {
      state.notes.push(`kept exported name "${entry.name}"`);
      continue;
    }
    binding.scope.rename(entry.name, state.poly.ident());
    state.renamed.push(entry.name);
  }
}
