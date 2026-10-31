import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import type * as t from "@babel/types";
import { computedKeyExpr } from "../layers/ast-helpers.js";

const traverse = (_traverse as unknown as { default?: typeof _traverse })
  .default ?? (_traverse as unknown as typeof _traverse);
const generate = (_generate as unknown as { default?: typeof _generate })
  .default ?? (_generate as unknown as typeof _generate);

/**
 * Dynamic IPC channel rewriting (Electron). REA leaves dynamically-computed IPC
 * channel names UNRESOLVED by design — so we turn literal channel strings into
 * runtime-computed ones. The transform is value-preserving: both sides compute
 * the identical string from the same literal, so main/renderer still match.
 *
 * Conservative: only rewrites the first string argument of IPC-ish calls
 * (ipcMain / ipcRenderer / webContents . handle|on|once|invoke|send|sendSync|
 * postMessage|handleOnce), never arbitrary `.on`/`.send`.
 */
const IPC_METHODS = new Set([
  "handle",
  "handleOnce",
  "on",
  "once",
  "invoke",
  "send",
  "sendSync",
  "sendTo",
  "postMessage",
]);
const IPC_OBJECTS = /(ipcMain|ipcRenderer|webContents)/;

export interface IpcRewriteResult {
  code: string;
  rewritten: number;
  channels: string[];
}

function objectText(node: t.Node): string {
  try {
    return generate(node).code;
  } catch {
    return "";
  }
}

export function rewriteIpcChannels(source: string): IpcRewriteResult {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["typescript", "jsx"],
  });
  let rewritten = 0;
  const channels: string[] = [];

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "MemberExpression") return;
      if (callee.property.type !== "Identifier") return;
      if (!IPC_METHODS.has(callee.property.name)) return;
      if (!IPC_OBJECTS.test(objectText(callee.object))) return;

      const first = path.node.arguments[0];
      if (!first || first.type !== "StringLiteral") return;

      channels.push(first.value);
      const replacement = computedKeyExpr(first.value);
      path.get("arguments.0").replaceWithSourceString(replacement);
      rewritten += 1;
    },
  });

  return { code: generate(ast).code, rewritten, channels };
}
