import { defineConfig } from "vitest/config"
import { coverageOptions, coverageReporters } from "./coverage.ts"

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    testTimeout: 60_000,
    reporters: coverageReporters(),
    coverage: coverageOptions(["attribution.ts", "coverage.ts"])
  }
})
