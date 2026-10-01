import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Money math is plain TypeScript, so tests run in Node without a browser.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
