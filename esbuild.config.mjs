import * as esbuild from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  minify: false,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
};

// CLI entrypoint (with shebang for npx/global install)
await esbuild.build({
  ...common,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node\n" + common.banner.js },
});

// Action entrypoint
await esbuild.build({
  ...common,
  entryPoints: ["src/action.ts"],
  outfile: "dist/action.js",
});

console.log("Build complete: dist/cli.js, dist/action.js");
