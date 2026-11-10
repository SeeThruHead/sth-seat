import { assert, describe, it } from "@effect/vitest"
import { MutableRef, Record } from "effect"
import {
  coverageBar,
  coverageOptions,
  coverageReporters,
  coverageWarnings,
  shortfalls,
  summariesOf,
  warningLines
} from "./coverage.ts"
import type { FileSummary } from "./coverage.ts"

const summary = (lines: number, branches: number | string): FileSummary => ({
  lines: { pct: lines },
  branches: { pct: branches },
  functions: { pct: 100 },
  statements: { pct: 100 }
})

const coverageMap = (files: Readonly<Record<string, FileSummary>>) => ({
  files: () => Record.keys(files),
  fileCoverageFor: (file: string) => ({ toSummary: () => ({ toJSON: () => files[file] }) })
})

describe("coverage warnings", () => {
  it("names each file and metric under the bar, and treats a file with nothing to count as covered", () => {
    const found = shortfalls(
      [
        { file: "/repo/apps/hub/src/a.ts", summary: summary(92.5, 100) },
        { file: "/repo/apps/hub/src/b.ts", summary: summary(100, "Unknown") }
      ],
      coverageBar
    )

    assert.deepStrictEqual(found, [{ file: "/repo/apps/hub/src/a.ts", metric: "lines", pct: 92.5, bar: 100 }])
  })

  it("warns in plain words everywhere and adds CI annotations only in CI", () => {
    const found = [{ file: "/repo/apps/hub/src/a.ts", metric: "lines" as const, pct: 92.5, bar: 100 }]
    const local = warningLines(found, "/repo/apps/hub", false)
    const ci = warningLines(found, "/repo/apps/hub", true)

    assert.include(local[0], "does not fail the run")
    assert.strictEqual(local[1], "  src/a.ts: lines 92.5% (bar 100%)")
    assert.strictEqual(ci.at(-1), "::warning file=src/a.ts,title=Coverage below the bar::lines 92.5% is under 100%")
    assert.strictEqual(local.length + 1, ci.length)
  })

  it("says nothing when everything meets the bar", () => {
    assert.deepStrictEqual(warningLines([], "/repo", true), [])
  })

  it("reads per-file summaries from vitest's coverage map and ignores anything else", () => {
    const read = summariesOf(coverageMap({ "/repo/a.ts": summary(50, 100) }))

    assert.deepStrictEqual(read, [{ file: "/repo/a.ts", summary: summary(50, 100) }])
    assert.deepStrictEqual(summariesOf(undefined), [])
    assert.deepStrictEqual(summariesOf({ files: () => ["/x.ts"], fileCoverageFor: () => ({}) }), [])
  })

  it("keeps paths outside the package as they are", () => {
    const found = [{ file: "/elsewhere/a.ts", metric: "branches" as const, pct: 50, bar: 100 }]

    assert.strictEqual(warningLines(found, "/repo/apps/hub", false)[1], "  /elsewhere/a.ts: branches 50% (bar 100%)")
  })

  it("ignores coverage maps without the expected methods", () => {
    assert.deepStrictEqual(summariesOf({ files: "nope" }), [])
    assert.deepStrictEqual(summariesOf({ files: () => "nope" }), [])
    assert.deepStrictEqual(summariesOf({ files: () => ["/x.ts", 3], fileCoverageFor: 1 }), [])
  })

  it("writes the warning once per run, and nothing when the map meets the bar", () => {
    const written = MutableRef.make<ReadonlyArray<string>>([])
    const record = (text: string) => MutableRef.update(written, (all) => [...all, text])
    coverageWarnings({ write: record, inCi: true, root: "/repo" }).onCoverage(
      coverageMap({ "/repo/a.ts": summary(100, 100) })
    )
    coverageWarnings({ write: record, inCi: true, root: "/repo" }).onCoverage(
      coverageMap({ "/repo/a.ts": summary(50, 100) })
    )
    coverageWarnings().onCoverage(coverageMap({ "/repo/a.ts": summary(100, 100) }))

    const all = MutableRef.get(written)

    assert.strictEqual(all.length, 1)
    assert.include(all[0], "::warning file=a.ts,title=Coverage below the bar::lines 50% is under 100%")
  })

  it("measures coverage with no thresholds, so vitest itself never fails on it", () => {
    const options = coverageOptions(["src/**"], ["src/app/server.ts"])

    assert.isFalse("thresholds" in options)
    assert.deepStrictEqual(options.exclude, ["**/*.test.ts", "**/*.testing.ts", "src/app/server.ts"])
    assert.deepStrictEqual(coverageOptions(["*.ts"]).exclude, ["**/*.test.ts", "**/*.testing.ts"])
    assert.strictEqual(coverageReporters()[0], "default")
  })
})
