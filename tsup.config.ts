import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: { entry: "src/index.ts" },
  clean: true,
  sourcemap: false,
  target: "node20",
  shims: true,
  banner: { js: "" },
});
