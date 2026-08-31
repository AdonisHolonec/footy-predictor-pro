import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/pipeline/**/*.test.js", "tests/e2e/**/*.test.ts"],
    environmentMatchGlobs: [["tests/pipeline/**", "node"]]
  }
});
