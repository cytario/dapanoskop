import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import sirv from "sirv";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

/**
 * Vite plugin that copies DuckDB-wasm bundles to public/duckdb/ so they are
 * served as static assets at /duckdb/* without Vite content-hashing.
 * Runs at buildStart (build) and configureServer (dev).
 */
function copyDuckDbBundles(): Plugin {
  const files = ["duckdb-eh.wasm", "duckdb-browser-eh.worker.js"];
  const srcDir = path.resolve(
    __dirname,
    "node_modules/@duckdb/duckdb-wasm/dist",
  );
  const destDir = path.resolve(__dirname, "public/duckdb");

  function copyFiles() {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }

  return {
    name: "copy-duckdb-bundles",
    buildStart() {
      copyFiles();
    },
    configureServer() {
      copyFiles();
    },
  };
}

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    copyDuckDbBundles(),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    command === "serve"
      ? {
          name: "serve-fixtures",
          configureServer(server: ViteDevServer) {
            const serve = sirv(path.resolve(__dirname, "fixtures"), {
              dev: true,
            });
            server.middlewares.use("/data", serve);
          },
        }
      : null,
  ].filter(Boolean),
}));
