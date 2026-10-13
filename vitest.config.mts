import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Алиас @/* берётся из tsconfig.json (встроенная поддержка Vite 8).
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
