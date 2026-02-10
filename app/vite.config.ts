import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import sirv from "sirv";
import { defineConfig, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => ({
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
