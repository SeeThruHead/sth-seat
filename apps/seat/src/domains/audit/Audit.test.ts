import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { Audit } from "./Audit.ts"

describe("Audit", () => {
  it.effect("keeps the newest entries, skips lines it can't read, and locks and unlocks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const result = yield* Effect.gen(function* () {
        const audit = yield* Audit
        const empty = yield* audit.recent(5)
        yield* audit.record({ caller: "tower", action: "shell", target: "ls", result: "started" })
        yield* fs.writeFileString(`${folder}/state/audit.jsonl`, "not json\n", { flag: "a" })
        yield* audit.record({ caller: "hub", action: "OpenUrl", target: "https://example.com", result: "done" })
        const entries = yield* audit.recent(2)
        yield* audit.setLocked(true)
        const locked = yield* audit.isLocked
        yield* audit.setLocked(false)
        const unlocked = yield* audit.isLocked

        return { empty, entries, locked, unlocked }
      }).pipe(Effect.provide(Audit.layer(`${folder}/state`)))

      assert.deepStrictEqual(result.empty, [])
      assert.deepStrictEqual(
        result.entries.map((entry) => entry.caller),
        ["hub"]
      )
      assert.deepStrictEqual([result.locked, result.unlocked], [true, false])
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.effect("keeps going when the log can't be written, and says why the lock can't change", () =>
    Effect.gen(function* () {
      const audit = yield* Audit
      yield* audit.record({ caller: "tower", action: "shell", target: "ls", result: "started" })
      const error = yield* Effect.flip(audit.setLocked(true))

      assert.include(error.message, "Can't change the lock")
    }).pipe(Effect.provide(Audit.layer("/proc/sth-seat-cannot-write").pipe(Layer.provideMerge(BunServices.layer))))
  )
})
