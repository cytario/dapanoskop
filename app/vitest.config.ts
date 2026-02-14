import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    css: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
