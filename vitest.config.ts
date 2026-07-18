import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/pipeline/**/*.test.js"],
    environmentMatchGlobs: [["tests/pipeline/**", "node"]]
  }
});
