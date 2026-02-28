import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-aria-components": path.resolve(
        __dirname,
        "node_modules/react-aria-components",
      ),
    },
  },
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    css: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
