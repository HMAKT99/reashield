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

export interface ReaResult {
  available: boolean;
  note: string;
  before?: { modules?: number; imports?: number };
  after?: { modules?: number; imports?: number };
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
): Promise<ReaResult> {
  const run = async (dir: string) => {
    const { stdout } = await pexec(
      "npx",
      ["-y", "rea-agents@latest", "analyze-javascript-application", dir, "--json"],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const json = JSON.parse(stdout);
    // Be liberal about shape across rea-agents releases.
    const modules =
      json.modules?.length ?? json.graph?.nodes?.length ?? json.moduleCount;
    const imports =
      json.imports?.length ??
      json.graph?.relationships?.length ??
      json.relationshipCount;
    return { modules, imports };
  };
  try {
    const before = await run(beforeDir);
    const after = await run(afterDir);
    return { available: true, note: "rea-agents measured", before, after };
  } catch (e) {
    return {
      available: false,
      note:
        "rea-agents not run (install it as a dev dep to measure against real REA): " +
        String((e as Error).message).split("\n")[0],
    };
  }
}
