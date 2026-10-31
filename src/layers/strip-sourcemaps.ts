import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/** Pillar: ship no source maps. Remove any sourceMappingURL comment. */
export function stripSourceMapComments(code: string): string {
  return code
    .replace(/\n?\/\/[#@]\s*sourceMappingURL=.*$/gm, "")
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, "");
}

/** Delete any .map files that slipped into the output dir. */
export function removeMapFiles(dir: string): string[] {
  const removed: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".map")) {
        rmSync(full);
        removed.push(full);
      }
    }
  };
  try {
    walk(dir);
  } catch {
    /* dir may not exist yet */
  }
  return removed;
}
