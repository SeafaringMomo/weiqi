// esbuild bundler: web/main.ts -> public/dist/bundle.js
// Usage: node scripts/build-web.mjs [--watch]
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["web/main.ts"],
  bundle: true,
  outfile: "public/dist/bundle.js",
  format: "iife",
  target: "es2020",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[build-web] watching for changes...");
} else {
  await esbuild.build(options);
}
