import { createHash, randomBytes } from "node:crypto";
import type { Polymorph } from "./types.js";

/**
 * Deterministic, seed-driven randomization. The same seed reproduces an
 * identical build; "auto" draws a fresh seed so two releases differ in names
 * AND structure — defeating diff-based version comparison (REA's
 * compare_application_versions).
 */

/** Simple, fast, well-distributed PRNG (mulberry32) seeded from the build seed. */
function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32LE(0);
}

// Confusable glyph pool: all lowercase-looking, similar width, no semantics.
const HOMOGLYPHS = "lIoO0cueaxnmrsz";

export function createPolymorph(seedInput: string): Polymorph {
  const seed =
    seedInput === "auto" ? randomBytes(8).toString("hex") : seedInput;
  const rng = mulberry32(seedToInt(seed));
  let identCounter = 0;

  const rand = () => rng();
  const int = (maxExclusive: number) => Math.floor(rng() * maxExclusive);
  const pick = <T,>(items: readonly T[]): T => items[int(items.length)];

  const opId = (logical: string): string => {
    // Build-stable but seed-dependent: rotates every build, stable within one.
    return createHash("sha256")
      .update(seed + "::op::" + logical)
      .digest("hex")
      .slice(0, 10);
  };

  const ident = (): string => {
    identCounter += 1;
    const len = 6 + int(5);
    let s = "_";
    for (let i = 0; i < len; i++) s += pick(HOMOGLYPHS.split(""));
    // Guarantee uniqueness without leaking a readable counter.
    return (
      s +
      createHash("sha1")
        .update(seed + identCounter)
        .digest("hex")
        .slice(0, 3)
    );
  };

  return { seed, rand, int, pick, opId, ident };
}
