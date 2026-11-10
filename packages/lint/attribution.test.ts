import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { main, offendingLines } from "./attribution.ts"

const guardFiles = new Set(["packages/lint/attribution.ts", "packages/lint/attribution.test.ts"])

const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  return yield* spawner.string(ChildProcess.make("git", ["-C", "../..", ...args]))
})

const trackedText = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const listed = yield* git(["ls-files"])
  const files = listed.split("\n").filter((file) => file.length > 0 && !guardFiles.has(file))

  return yield* Effect.forEach(files, (file) => fs.readFileString(`../../${file}`), { concurrency: 16 })
})

const messageFile = Effect.fnUntraced(function* (text: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ prefix: "attribution-" })
  yield* fs.writeFileString(path, text)

  return path
})

describe("AI attribution guard", () => {
  it("flags attribution trailers and footers", () => {
    const message = [
      "Open links on the seat",
      "",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "Generated with Claude Code",
      "Claude-Session: https://claude.ai/code/session_01ABC",
      "https://claude.ai/code/session_01ABC"
    ].join("\n")

    assert.deepStrictEqual(offendingLines(message), message.split("\n").slice(2))
  })

  it("leaves ordinary messages alone", () => {
    assert.deepStrictEqual(offendingLines("Co-authored-by: A Person <person@example.com>\nGenerated config"), [])
  })

  it.effect("refuses a commit message with attribution and accepts a clean one", () =>
    Effect.gen(function* () {
      const dirty = yield* messageFile("Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
      const clean = yield* messageFile("Fix the seat choice")
      const refused = yield* Effect.flip(main(["bun", "hook", dirty]))
      yield* main(["bun", "hook", clean])

      assert.strictEqual(refused._tag, "AttributionFound")
      assert.include(refused.message, "Co-Authored-By: Claude")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.effect("explains its usage when no message file is given", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(main(["bun", "hook"]))

      assert.strictEqual(error._tag, "Usage")
      assert.include(error.message, "commit-message-file")
    }).pipe(Effect.provide(BunServices.layer))
  )

  it.effect("no tracked file carries attribution", () =>
    Effect.gen(function* () {
      const texts = yield* trackedText

      assert.deepStrictEqual(texts.flatMap(offendingLines), [])
    }).pipe(Effect.provide(BunServices.layer))
  )

  it.effect("no commit message in history carries attribution", () =>
    Effect.gen(function* () {
      const history = yield* git(["log", "--format=%B"]).pipe(Effect.orElseSucceed(() => ""))

      assert.deepStrictEqual(offendingLines(history), [])
    }).pipe(Effect.provide(BunServices.layer))
  )
})
