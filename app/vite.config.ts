import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import sirv from "sirv";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { createS3ProxyMiddleware } from "./vite-s3-proxy";

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

/**
 * Vite plugin that serves /data/* requests during development.
 *
 * When VITE_DATA_S3_BUCKET is set, proxies requests to S3 using the
 * developer's local AWS credentials. Otherwise, serves local fixtures.
 */
function createDataPlugin(): Plugin {
  const s3Bucket = process.env.VITE_DATA_S3_BUCKET;
  const s3Region = process.env.VITE_DATA_S3_REGION || "eu-north-1";

  if (s3Bucket) {
    console.log(`[data] Proxying /data/* to s3://${s3Bucket} (${s3Region})`);
    return {
      name: "s3-data-proxy",
      configureServer(server: ViteDevServer) {
        server.middlewares.use(
          "/data",
          createS3ProxyMiddleware({ bucket: s3Bucket, region: s3Region }),
        );
      },
    };
  }

  return {
    name: "serve-fixtures",
    configureServer(server: ViteDevServer) {
      const serve = sirv(path.resolve(__dirname, "fixtures"), { dev: true });
      server.middlewares.use("/data", serve);
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
    command === "serve" ? createDataPlugin() : null,
  ].filter(Boolean),
}));
