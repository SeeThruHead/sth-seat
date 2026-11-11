import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { SecretName } from "@sth-seat/protocol/Ids.ts"
import { Opened, machineIn, recordingDesktop, tower } from "../../testing/Seat.testing.ts"
import { askHere } from "./handler.ts"

describe("askHere", () => {
  it.effect("asks on this machine's own desktop and stores the answer here, handing back only the path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const request = { name: SecretName.make("flag-key"), question: "Feature flag key?" }
      const asked = askHere(request, tower).pipe(
        Effect.flatMap((result) => Opened.use((opened) => Effect.map(opened.all, (seen) => ({ result, seen }))))
      )
      const { result: stored, seen: prompts } = yield* asked.pipe(Effect.provide([machineIn(folder), recordingDesktop]))
      const content = yield* fs.readFileString(stored.path)
      const info = yield* fs.stat(stored.path)

      assert.deepStrictEqual(prompts, [
        "ask flag-key: Feature flag key? (to tower ~/.local/share/sth-seat/secrets/flag-key)"
      ])
      assert.strictEqual(stored.path, `${folder}/secrets/flag-key`)
      assert.strictEqual(content, "answer for flag-key")
      assert.strictEqual(info.mode & 0o777, 0o600)
      assert.notInclude(`${stored.message} ${stored.machine}`, "answer for")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})
