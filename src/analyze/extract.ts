import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import type * as t from "@babel/types";

// @babel/{traverse,generator} are CJS with interop quirks under ESM.
const traverse = (_traverse as unknown as { default?: typeof _traverse })
  .default ?? (_traverse as unknown as typeof _traverse);
const generate = (_generate as unknown as { default?: typeof _generate })
  .default ?? (_generate as unknown as typeof _generate);

export interface ExtractedFn {
  name: string;
  params: string[];
  async: boolean;
  /** Full source text of the function (declaration or initializer). */
  source: string;
  /** Body source only (what runs). */
  bodySource: string;
  exported: boolean;
  kind: "declaration" | "arrow" | "expression";
}

export interface ParseResult {
  ast: t.File;
  code: string;
  fns: Map<string, ExtractedFn>;
}

function paramNames(params: t.Node[]): string[] {
  return params.map((p, i) => {
    if (p.type === "Identifier") return p.name;
    if (p.type === "RestElement" && p.argument.type === "Identifier")
      return "..." + p.argument.name;
    return `_a${i}`;
  });
}

/** Parse `code` and index top-level protectable functions by name. */
export function parseSource(code: string): ParseResult {
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: ["typescript"],
    allowReturnOutsideFunction: true,
  });

  const fns = new Map<string, ExtractedFn>();

  traverse(ast, {
    FunctionDeclaration(path) {
      const id = path.node.id;
      if (!id) return;
      if (path.getFunctionParent()) return; // top-level only
      const bodyNode = path.node.body;
      fns.set(id.name, {
        name: id.name,
        params: paramNames(path.node.params),
        async: !!path.node.async,
        source: generate(path.node).code,
        bodySource: generate(bodyNode).code,
        exported:
          path.parentPath?.isExportNamedDeclaration() ||
          path.parentPath?.isExportDefaultDeclaration() ||
          false,
        kind: "declaration",
      });
    },
    VariableDeclarator(path) {
      if (path.node.id.type !== "Identifier") return;
      const init = path.node.init;
      if (!init) return;
      if (
        init.type !== "ArrowFunctionExpression" &&
        init.type !== "FunctionExpression"
      )
        return;
      // top-level (program > declaration > declarator)
      const declPath = path.parentPath;
      const parentOfDecl = declPath?.parentPath;
      const topLevel =
        parentOfDecl?.isProgram() ||
        parentOfDecl?.isExportNamedDeclaration();
      if (!topLevel) return;

      const name = path.node.id.name;
      const bodySource =
        init.body.type === "BlockStatement"
          ? generate(init.body).code
          : `{ return ${generate(init.body).code}; }`;
      fns.set(name, {
        name,
        params: paramNames(init.params),
        async: !!init.async,
        source: generate(init).code,
        bodySource,
        exported: parentOfDecl?.isExportNamedDeclaration() || false,
        kind: init.type === "ArrowFunctionExpression" ? "arrow" : "expression",
      });
    },
  });

  return { ast, code, fns };
}

export { generate, traverse };
