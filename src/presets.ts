import type { LayerConfig, Preset, ServerConfig } from "./types.js";

/**
 * Preset defaults, by durability + cost posture.
 * balanced stays low-cost; max opts into latency/perf/size for maximal shielding.
 */

export function layerDefaults(preset: Preset): LayerConfig {
  const base: LayerConfig = {
    stripSourceMaps: true,
    flattenBundle: true,
    obfuscate: true,
    stringIndirection: false,
    dynamicChannels: false,
    dynamicGraph: false,
    ipcChannels: false,
    decoys: { enabled: false, count: 0 },
    integrity: false,
  };

  if (preset === "low") {
    return { ...base, decoys: { enabled: true, count: 2 } };
  }
  if (preset === "balanced") {
    return {
      ...base,
      stringIndirection: true,
      dynamicChannels: true,
      dynamicGraph: true, // computed dispatch: forces REA call-edges to "unresolved"
      decoys: { enabled: true, count: 5 },
    };
  }
  // max
  return {
    ...base,
    stringIndirection: true,
    dynamicChannels: true,
    dynamicGraph: true,
    decoys: { enabled: true, count: 15 },
  };
}

export function serverDefaults(): ServerConfig {
  return {
    enabled: true,
    out: "server-shielded",
    adapter: "generic",
    endpoint: "/__s",
    keyEndpoint: "/__s/k",
    decoyCalls: false,
  };
}

/** Obfuscator aggressiveness per preset (consumed by layers/obfuscate.ts). */
export function obfuscatorProfile(preset: Preset) {
  if (preset === "low") {
    return {
      controlFlowFlattening: false,
      deadCodeInjection: false,
      selfDefending: false,
      stringArray: true,
      stringArrayEncoding: [] as string[],
      splitStrings: false,
    };
  }
  if (preset === "balanced") {
    return {
      controlFlowFlattening: false,
      deadCodeInjection: false,
      selfDefending: false,
      stringArray: true,
      stringArrayEncoding: ["base64"],
      splitStrings: true,
    };
  }
  return {
    controlFlowFlattening: true,
    deadCodeInjection: true,
    selfDefending: true,
    stringArray: true,
    stringArrayEncoding: ["rc4"],
    splitStrings: true,
  };
}
