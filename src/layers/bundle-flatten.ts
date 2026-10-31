import { build } from "esbuild";
import { clientRuntimeSource } from "../runtime-templates.js";

export interface FlattenOptions {
  entryCode: string;
  resolveDir: string;
  format: "esm" | "cjs";
  endpoint: string;
  keyEndpoint: string;
  wireKeyB64: string;
  /** If any symbol was relocated/sealed, inject the client runtime. */
  needsRuntime: boolean;
}

/**
 * Pillar: starve the module graph. esbuild bundles the whole import tree into a
 * single module, so there is no import structure for REA to walk. Source maps
 * are disabled here and verified by strip-sourcemaps.
 */
export async function flatten(opts: FlattenOptions): Promise<string> {
  const runtime = opts.needsRuntime
    ? clientRuntimeSource({
        endpoint: opts.endpoint,
        keyEndpoint: opts.keyEndpoint,
        wireKeyB64: opts.wireKeyB64,
      }) + "\n"
    : "";

  const result = await build({
    stdin: {
      contents: runtime + opts.entryCode,
      resolveDir: opts.resolveDir,
      sourcefile: "reashield-entry.js",
      loader: "js",
    },
    bundle: true,
    write: false,
    format: opts.format,
    platform: "node",
    treeShaking: true,
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}
