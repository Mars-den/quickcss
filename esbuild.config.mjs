import { build } from "esbuild";
await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  external: ["obsidian", "electron"],
  outfile: "main.js",
  sourcemap: false,
});
