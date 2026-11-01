import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = (_traverse as unknown as { default?: typeof _traverse })
  .default ?? (_traverse as unknown as typeof _traverse);
const pexec = promisify(execFile);

export interface StaticMetrics {
  importEdges: number;
  requireCalls: number;
  hasSourceMaps: boolean;
  stringLiterals: number;
  /** of the BEFORE strings, how many survive verbatim in AFTER (set by diff). */
  names: Set<string>;
}

export interface Measurement {
  importEdges: number;
  requireCalls: number;
  hasSourceMaps: boolean;
  stringLiterals: number;
}

function collect(code: string): { metrics: Measurement; strings: string[]; names: Set<string> } {
  let importEdges = 0;
  let requireCalls = 0;
  const strings: string[] = [];
  const names = new Set<string>();
  let ast;
  try {
    ast = parse(code, { sourceType: "unambiguous", plugins: ["typescript"] });
  } catch {
    // Obfuscated output can still parse; if not, fall back to regex counts.
    importEdges = (code.match(/\bimport\s+[^;]*\bfrom\b/g) || []).length;
    requireCalls = (code.match(/\brequire\s*\(/g) || []).length;
    return {
      metrics: {
        importEdges,
        requireCalls,
        hasSourceMaps: /sourceMappingURL/.test(code),
        stringLiterals: (code.match(/["'`]/g) || []).length,
      },
      strings,
      names,
    };
  }
  traverse(ast, {
    ImportDeclaration() {
      importEdges += 1;
    },
    CallExpression(path) {
      const c = path.node.callee;
      if (c.type === "Identifier" && c.name === "require") requireCalls += 1;
      if (c.type === "Import") importEdges += 1;
    },
    StringLiteral(path) {
      if (path.node.value.length >= 3) strings.push(path.node.value);
    },
    Identifier(path) {
      names.add(path.node.name);
    },
  });
  return {
    metrics: {
      importEdges,
      requireCalls,
      hasSourceMaps: /sourceMappingURL/.test(code),
      stringLiterals: strings.length,
    },
    strings,
    names,
  };
}

export interface CompareResult {
  before: Measurement;
  after: Measurement;
  /** fraction of BEFORE string literals that survive verbatim in AFTER. */
  stringLeakRatio: number;
  /** protected names still present verbatim in AFTER. */
  leakedNames: string[];
  rea: ReaResult;
}

export interface ReaSide {
  nodes: number;
  edges: number;
  findings: number;
  astNodes: number;
  /** distinct protected tokens (names + secret strings) REA still recovers. */
  recovered: number;
  recoveredTokens: string[];
}

export interface ReaResult {
  available: boolean;
  note: string;
  before?: ReaSide;
  after?: ReaSide;
}

/** Static before/after comparison. Always available, no REA needed. */
export function compareStatic(
  beforeCode: string,
  afterCode: string,
  protectedNames: string[],
): Omit<CompareResult, "rea"> {
  const b = collect(beforeCode);
  const a = collect(afterCode);

  const afterStrings = new Set(a.strings);
  const uniqueBefore = [...new Set(b.strings)];
  const survived = uniqueBefore.filter((s) => afterStrings.has(s)).length;
  const stringLeakRatio = uniqueBefore.length
    ? survived / uniqueBefore.length
    : 0;

  const leakedNames = protectedNames.filter((n) => a.names.has(n));

  return {
    before: b.metrics,
    after: a.metrics,
    stringLeakRatio,
    leakedNames,
  };
}

/**
 * Best-effort real-REA measurement on your OWN before/after artifact dirs.
 * Shells out to the documented CLI; if rea-agents is not installed, returns
 * { available:false } and the static comparison stands on its own.
 */
export async function tryRea(
  beforeDir: string,
  afterDir: string,
  tokens: string[] = [],
): Promise<ReaResult> {
  const uniq = [...new Set(tokens.filter((t) => t && t.length >= 3))];
  const run = async (dir: string): Promise<ReaSide> => {
    const { stdout } = await pexec(
      "npx",
      ["-y", "rea-agents@latest", "analyze-javascript-application", dir, "--json"],
      { timeout: 300_000, maxBuffer: 256 * 1024 * 1024 },
    );
    const json = JSON.parse(stdout);
    const nr = json.normalized_result ?? json;
    const g = nr.graph ?? {};
    const st = nr.statistics ?? {};
    // Protected-token recovery: does REA's analysis still contain the name/secret?
    const recoveredTokens = uniq.filter((t) => stdout.includes(t));
    return {
      nodes: Array.isArray(g.nodes) ? g.nodes.length : 0,
      edges: Array.isArray(g.edges) ? g.edges.length : 0,
      findings: st.findings ?? 0,
      astNodes: st.visited_ast_nodes ?? 0,
      recovered: recoveredTokens.length,
      recoveredTokens,
    };
  };
  try {
    const before = await run(beforeDir);
    const after = await run(afterDir);
    return { available: true, note: "rea-agents measured", before, after };
  } catch (e) {
    return {
      available: false,
      note:
        "rea-agents not run: " +
        (((e as { stderr?: string }).stderr || "").trim().split("\n").slice(-2).join(" | ") ||
          String((e as Error).message).split("\n")[0]),
    };
  }
}

/**
 * WS6 — ecosystem coverage. Run webcrack (unpacks/deobfuscates bundled JS) on
 * the hardened client and report whether it recovers any protected tokens.
 * Report-only, best-effort, gracefully skipped if unavailable. (humanify, the
 * LLM un-minifier, needs an API key, so it is documented rather than run.)
 */
export interface EcosystemResult {
  available: boolean;
  tool: string;
  recovered: number;
  recoveredTokens: string[];
  note: string;
}

export async function tryWebcrack(
  clientFile: string,
  tokens: string[],
): Promise<EcosystemResult> {
  const uniq = [...new Set(tokens.filter((t) => t && t.length >= 3))];
  const { mkdtempSync, readdirSync, readFileSync } = await import("node:fs");
  const osmod = await import("node:os");
  const pathmod = await import("node:path");
  // Only run if webcrack is installed locally; cold `npx` downloads are slow/flaky.
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  try {
    req.resolve("webcrack");
  } catch {
    return {
      available: false, tool: "webcrack", recovered: 0, recoveredTokens: [],
      note: "webcrack not installed (npm i -D webcrack to include it in --rea)",
    };
  }
  const out = mkdtempSync(pathmod.join(osmod.tmpdir(), "reashield-webcrack-"));
  try {
    await pexec("npx", ["webcrack", clientFile, "-o", out, "-f"], {
      timeout: 180_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    let text = "";
    const walk = (d: string) => {
      for (const n of readdirSync(d, { withFileTypes: true })) {
        const p = pathmod.join(d, n.name);
        if (n.isDirectory()) walk(p);
        else if (n.name.endsWith(".js")) text += readFileSync(p, "utf8");
      }
    };
    walk(out);
    const recoveredTokens = uniq.filter((t) => text.includes(t));
    return {
      available: true,
      tool: "webcrack",
      recovered: recoveredTokens.length,
      recoveredTokens,
      note: "webcrack deobfuscated/unpacked the client",
    };
  } catch (e) {
    return {
      available: false,
      tool: "webcrack",
      recovered: 0,
      recoveredTokens: [],
      note: "webcrack not run: " + String((e as Error).message).split("\n")[0],
    };
  }
}
