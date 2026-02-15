import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import sirv from "sirv";
import { defineConfig, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
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
