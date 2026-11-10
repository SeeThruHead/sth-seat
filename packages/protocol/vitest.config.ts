import { coverageOptions, coverageReporters } from "@sth-seat/lint/coverage.ts"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    reporters: coverageReporters(),
    coverage: coverageOptions(["src/**"], ["src/Telemetry.ts"])
  }
})
