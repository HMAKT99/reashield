import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { transformModuleSource, finalizeCode, buildServer } from "../engine.js";
import { initSession, isHardenable, loaderFor, type PluginOptions, type PluginSession } from "./shared.js";

/**
 * esbuild plugin. Transforms matching source files on load, then post-processes
 * esbuild's output files on end (decoys + obfuscate + strip maps + runtime
 * injection) and writes the server skeleton. Forces `write:false` so it can
 * harden the output before writing it itself.
 */
export function reashieldEsbuild(options: PluginOptions = {}) {
  return {
    name: "reashield",
    setup(build: {
      initialOptions: { write?: boolean };
      onStart(cb: () => Promise<void> | void): void;
      onLoad(
        opts: { filter: RegExp },
        cb: (args: { path: string }) => Promise<{ contents: string; loader: string } | null>,
      ): void;
      onEnd(cb: (result: { outputFiles?: Array<{ path: string; text: string }> }) => Promise<void> | void): void;
    }) {
      let session: PluginSession;
      build.initialOptions.write = false; // we write after hardening

      build.onStart(async () => {
        session = await initSession(options);
      });

      build.onLoad({ filter: /\.(mjs|cjs|jsx?|tsx?)$/ }, async (args) => {
        if (!session || !isHardenable(args.path)) return null;
        const source = await readFile(args.path, "utf8");
        const out = transformModuleSource(source, session.state);
        if (!out) return null;
        return { contents: out, loader: loaderFor(args.path) };
      });

      build.onEnd(async (result) => {
        if (!session || !result.outputFiles) return;
        for (const file of result.outputFiles) {
          let text = file.text;
          if (/\.(js|mjs|cjs)$/.test(file.path)) {
            text = finalizeCode(text, session.state, {
              injectRuntime: true,
              wireKeyB64: session.wireKeyB64,
            }).code;
          }
          await mkdir(path.dirname(file.path), { recursive: true });
          await writeFile(file.path, text);
        }
        if (!session.serverWritten) {
          const files = buildServer(session.state, session.wireKeyB64);
          if (Object.keys(files).length) {
            const out = path.resolve(session.cwd, session.config.server.out);
            await mkdir(out, { recursive: true });
            for (const [rel, content] of Object.entries(files))
              await writeFile(path.join(out, rel), content);
          }
          session.serverWritten = true;
        }
      });
    },
  };
}
