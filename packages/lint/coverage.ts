import { cwd, env, stdout } from "node:process"
import { Option, Predicate, Schema } from "effect"

export const metrics = ["lines", "branches", "functions", "statements"] as const

export type Metric = (typeof metrics)[number]

export type Bar = Readonly<Record<Metric, number>>

export const coverageBar: Bar = { lines: 100, branches: 100, functions: 100, statements: 100 }

const Percent = Schema.Union([Schema.Finite, Schema.String])

const MetricSummary = Schema.Struct({ pct: Percent })

const FileSummary = Schema.Struct({
  lines: MetricSummary,
  branches: MetricSummary,
  functions: MetricSummary,
  statements: MetricSummary
})

export type FileSummary = typeof FileSummary.Type

export type Shortfall = { readonly file: string; readonly metric: Metric; readonly pct: number; readonly bar: number }

const percentOf = (pct: number | string): number => (Predicate.isNumber(pct) ? pct : 100)

export const shortfalls = (
  files: ReadonlyArray<{ readonly file: string; readonly summary: FileSummary }>,
  bar: Bar
): ReadonlyArray<Shortfall> =>
  files.flatMap(({ file, summary }) =>
    metrics
      .map((metric) => ({ file, metric, pct: percentOf(summary[metric].pct), bar: bar[metric] }))
      .filter((found) => found.pct < found.bar)
  )

const relative = (file: string, root: string): string =>
  file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file

export const warningLines = (found: ReadonlyArray<Shortfall>, root: string, inCi: boolean): ReadonlyArray<string> => {
  if (found.length === 0) return []
  const plain = found.map((gap) => `  ${relative(gap.file, root)}: ${gap.metric} ${gap.pct}% (bar ${gap.bar}%)`)
  const annotations = found.map(
    (gap) =>
      `::warning file=${relative(gap.file, root)},title=Coverage below the bar::${gap.metric} ${gap.pct}% is under ${gap.bar}%`
  )

  return [
    `Coverage warning: ${found.length} metric(s) under the bar. This does not fail the run; add the missing tests.`,
    ...plain,
    ...(inCi ? annotations : [])
  ]
}

const decodeSummary = Schema.decodeUnknownOption(FileSummary)

const call = (value: unknown, method: string, args: ReadonlyArray<unknown> = []): Option.Option<unknown> => {
  if (!Predicate.hasProperty(value, method)) return Option.none()
  const fn = value[method]
  if (!Predicate.isFunction(fn)) return Option.none()

  return Option.some(Reflect.apply(fn, value, args))
}

const summaryOf = (map: unknown, file: string): Option.Option<FileSummary> =>
  call(map, "fileCoverageFor", [file]).pipe(
    Option.flatMap((coverage) => call(coverage, "toSummary")),
    Option.flatMap((summary) => call(summary, "toJSON")),
    Option.flatMap(decodeSummary)
  )

const filesOf = (map: unknown): ReadonlyArray<string> =>
  call(map, "files").pipe(
    Option.filter(Array.isArray),
    Option.map((files) => files.filter(Predicate.isString)),
    Option.getOrElse(() => [])
  )

export const summariesOf = (map: unknown): ReadonlyArray<{ readonly file: string; readonly summary: FileSummary }> =>
  filesOf(map).flatMap((file) =>
    Option.match(summaryOf(map, file), { onNone: () => [], onSome: (summary) => [{ file, summary }] })
  )

export type WarningOptions = {
  readonly bar: Bar
  readonly inCi: boolean
  readonly root: string
  readonly write: (text: string) => void
}

const defaults = (): WarningOptions => ({
  bar: coverageBar,
  inCi: env["CI"] !== undefined,
  root: cwd(),
  write: stdout.write.bind(stdout)
})

export const coverageWarnings = (options: Partial<WarningOptions> = {}) => {
  const settings = { ...defaults(), ...options }

  return {
    onCoverage: (map: unknown): void => {
      const lines = warningLines(shortfalls(summariesOf(map), settings.bar), settings.root, settings.inCi)
      if (lines.length === 0) return

      settings.write(`${lines.join("\n")}\n`)
    }
  }
}

export const coverageOptions = (include: ReadonlyArray<string>, exclude: ReadonlyArray<string> = []) => ({
  enabled: true,
  provider: "istanbul" as const,
  include: [...include],
  exclude: ["**/*.test.ts", "**/*.testing.ts", ...exclude],
  reporter: ["text-summary"]
})

export const coverageReporters = () => ["default", coverageWarnings()]
