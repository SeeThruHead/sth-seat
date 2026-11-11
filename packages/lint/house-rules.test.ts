import { BunServices } from "@effect/platform-bun"
import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

const Report = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        filename: Schema.String,
        labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) }))
      })
    )
  })
)

const expected = [
  "apps/hub/src/domains/presence/Uses.ts house(boundaries) 1",
  "apps/hub/src/domains/presence/Uses.ts house(boundaries) 2",
  "apps/hub/src/features/open/handler.ts house(boundaries) 1",
  "apps/seat/src/domains/files/Files.ts house(boundaries) 1",
  "casts.ts house(no-casts) 1",
  "comments.ts house(no-comments) 1",
  "deterministic.ts effecttsgo(crypto-random-uuid) 1",
  "deterministic.ts effecttsgo(global-date) 1",
  "deterministic.ts effecttsgo(global-date) 1",
  "deterministic.ts effecttsgo(global-random) 1",
  "floating-effect.ts effecttsgo(floating-effect) 4",
  "gen-wrapper.ts house(no-gen-wrapper) 2",
  "let.ts house(no-let) 2",
  "loops.ts house(no-loops) 3",
  "loops.ts house(no-mutation) 3",
  "multiline-logical.ts house(no-multiline-logical) 2",
  "mutation.ts house(no-mutation) 2",
  "mutation.ts house(no-mutation) 3",
  "mutation.ts house(no-mutation) 4",
  "nested-if.ts house(no-nested-if) 3",
  "packages/protocol/src/Bad.ts house(boundaries) 1",
  "run.ts house(run-at-entry-only) 2",
  "transports.ts house(transports-from-contracts) 4",
  "transports.ts house(transports-from-contracts) 6"
]

class NoReport extends Schema.TaggedError<NoReport, { readonly brand: unique symbol }>()("NoReport", {
  hint: Schema.String,
  output: Schema.String
}) {}

const lintFixtures = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const output = yield* spawner.string(
    ChildProcess.make("./node_modules/.bin/effect-tsgo", [
      "--tsrs-lint",
      "oxlint",
      "--no-ignore",
      "-c",
      "fixtures.oxlintrc.json",
      "-f",
      "json",
      "fixtures"
    ])
  )

  return yield* Schema.decodeEffect(Report)(output).pipe(
    Effect.mapError(
      () =>
        new NoReport({
          hint: "oxlint printed no report; run it through `effect-tsgo --tsrs-lint oxlint`, which adds the effecttsgo plugin",
          output
        })
    )
  )
})

it.effect("each house rule reports exactly the fixture lines it should, and clean code reports nothing", () =>
  Effect.gen(function* () {
    const report = yield* lintFixtures
    const found = report.diagnostics
      .map((d) => `${d.filename.replace(/^.*fixtures\//, "")} ${d.code} ${d.labels[0]?.span.line ?? 0}`)
      .toSorted()

    assert.deepStrictEqual(found, expected)
  }).pipe(Effect.provide(BunServices.layer))
)
