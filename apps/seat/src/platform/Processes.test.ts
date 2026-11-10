import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { run, watchLines } from "./Processes.ts"

describe("run", () => {
  it.live("returns what the command printed", () =>
    Effect.gen(function* () {
      const output = yield* run("sh", ["-c", "echo hello"], "10 seconds")

      assert.strictEqual(output, "hello\n")
    }).pipe(Effect.provide(BunServices.layer))
  )

  it.live("fails with the exit code and what the command said", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(run("sh", ["-c", "echo nope >&2; exit 3"], "10 seconds"))
      const quiet = yield* Effect.flip(run("sh", ["-c", "exit 4"], "10 seconds"))

      assert.strictEqual(failed.message, "sh -c echo nope >&2; exit 3 failed: exit code 3: nope")
      assert.strictEqual(quiet.problem, "exit code 4")
    }).pipe(Effect.provide(BunServices.layer))
  )

  it.live("gives up on a command that hangs, and on one that doesn't exist", () =>
    Effect.gen(function* () {
      const hung = yield* Effect.flip(run("sleep", ["5"], "200 millis"))
      const missing = yield* Effect.flip(run("sth-seat-no-such-command", [], "10 seconds"))

      assert.strictEqual(hung.problem, "no answer within 200ms")
      assert.include(missing.command, "sth-seat-no-such-command")
    }).pipe(Effect.provide(BunServices.layer))
  )
})

describe("watchLines", () => {
  it.live("hands over each line and fails once the command stops", () =>
    Effect.gen(function* () {
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const stopped = yield* Effect.flip(
        watchLines("sh", ["-c", "echo idle; echo active"], (line) => Ref.update(lines, (all) => [...all, line]))
      )
      const seen = yield* Ref.get(lines)

      assert.deepStrictEqual(seen, ["idle", "active"])
      assert.strictEqual(stopped.problem, "stopped with exit code 0")
    }).pipe(Effect.provide(BunServices.layer))
  )

  it.live("fails when the command can't start", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(watchLines("sth-seat-no-such-command", [], () => Effect.void))

      assert.include(error.message, "sth-seat-no-such-command failed")
    }).pipe(Effect.provide(BunServices.layer))
  )
})
