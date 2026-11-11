import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { EnvelopeId } from "@sth-seat/protocol/Remote.ts"
import { Messages } from "./Messages.ts"
import type { InboxMessage } from "./Messages.ts"

const message = (count: number, text: string): InboxMessage => ({
  id: EnvelopeId.make(`019a5f3e-6a2b-7c4d-8e9f-${count.toString(16).padStart(12, "0")}`),
  from: MachineName.make("tower"),
  at: "2026-11-11T18:00:00.000Z",
  text
})

describe("Messages", () => {
  it.effect("keeps messages in a file only this user can read, lists the unread ones, and marks them read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const { before, after, all } = yield* Effect.gen(function* () {
        const messages = yield* Messages
        yield* messages.add(message(1, "first"))
        yield* messages.add(message(2, "second"))
        const unread = yield* messages.unread
        yield* messages.markRead(unread.slice(0, 1))

        return { before: unread, after: yield* messages.unread, all: yield* messages.all }
      }).pipe(Effect.provide(Messages.layer(folder)))
      const info = yield* fs.stat(`${folder}/messages.jsonl`)

      assert.deepStrictEqual(
        before.map((one) => one.text),
        ["first", "second"]
      )
      assert.deepStrictEqual(
        after.map((one) => one.text),
        ["second"]
      )
      assert.strictEqual(all.length, 2)
      assert.strictEqual(info.mode & 0o777, 0o600)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.effect("starts empty, skips lines it can't read, and says when the folder can't be written", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/messages.jsonl`, "not json\n")
      const unread = yield* Messages.use((messages) => messages.unread).pipe(Effect.provide(Messages.layer(folder)))
      yield* fs.writeFileString(`${folder}/blocked`, "a file, not a folder")
      const failed = yield* Messages.use((messages) => Effect.flip(messages.add(message(3, "x")))).pipe(
        Effect.provide(Messages.layer(`${folder}/blocked`))
      )

      assert.deepStrictEqual(unread, [])
      assert.include(failed.message, "Can't use this machine's message inbox")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})
