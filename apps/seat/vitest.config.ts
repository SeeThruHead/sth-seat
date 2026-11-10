import { coverageOptions, coverageReporters } from "@sth-seat/lint/coverage.ts"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    reporters: coverageReporters(),
    coverage: coverageOptions(
      ["src/**"],
      ["src/app/main.ts", "src/app/Cli.ts", "src/app/cli/**", "src/app/Daemon.ts", "src/app/Hub.ts"]
    )
  }
})
