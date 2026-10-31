import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { transformModuleSource, finalizeCode, buildServer } from "../engine.js";
import { initSession, isHardenable, type PluginOptions, type PluginSession } from "./shared.js";

/**
 * Rollup plugin (also a Vite plugin — Vite consumes the Rollup plugin
 * interface). Runs REAShield's source transforms per module, then finalizes
 * each rendered chunk (decoys + obfuscate + strip maps + runtime injection),
 * and writes the server skeleton once.
 *
 * NOTE: `flattenBundle` is a no-op here — Rollup/Vite already bundle. The plugin
 * hardens the host's own output.
 */
export function reashieldRollup(options: PluginOptions = {}) {
  let session: PluginSession;
  return {
    name: "reashield",
    async buildStart() {
      session = await initSession(options);
    },
    transform(code: string, id: string) {
      if (!session || !isHardenable(id)) return null;
      const out = transformModuleSource(code, session.state);
      return out ? { code: out, map: null } : null;
    },
    renderChunk(code: string) {
      if (!session) return null;
      const { code: c } = finalizeCode(code, session.state, {
        injectRuntime: true,
        wireKeyB64: session.wireKeyB64,
      });
      return { code: c, map: null };
    },
    writeBundle() {
      if (!session || session.serverWritten) return;
      const files = buildServer(session.state, session.wireKeyB64);
      if (Object.keys(files).length) {
        const out = path.resolve(session.cwd, session.config.server.out);
        mkdirSync(out, { recursive: true });
        for (const [rel, content] of Object.entries(files))
          writeFileSync(path.join(out, rel), content);
      }
      session.serverWritten = true;
    },
  };
}

/** Vite alias — runs in the output phase. */
export function reashieldVite(options: PluginOptions = {}) {
  return { ...reashieldRollup(options), enforce: "post" as const, apply: "build" as const };
}
