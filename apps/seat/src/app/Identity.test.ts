import { BunCrypto, BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { issueKey, readIdentity, requireIdentity } from "./Identity.ts"

const inFolder = <A, E, R>(
  use: (files: { keyFile: string; nameFile: string }, folder: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* use({ keyFile: `${folder}/config/key`, nameFile: `${folder}/config/name` }, folder)
  }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))

describe("machine identity", () => {
  it.effect("writes a private key only this user can read, and reads the same machine back", () =>
    inFolder(
      Effect.fnUntraced(function* (files) {
        const fs = yield* FileSystem.FileSystem
        yield* issueKey(files, MachineName.make("tower"), false)
        const info = yield* fs.stat(files.keyFile)
        const me = yield* requireIdentity(files)
        const again = yield* Effect.flip(issueKey(files, MachineName.make("tower"), false))
        yield* issueKey(files, MachineName.make("tower"), true)
        const replaced = yield* requireIdentity(files)

        assert.strictEqual(info.mode & 0o777, 0o600)
        assert.strictEqual(me.name, "tower")
        assert.match(me.publicText, /^[A-Za-z0-9_-]{43}$/)
        assert.include(again.message, "Pass --force")
        assert.notStrictEqual(replaced.publicText, me.publicText)
      })
    )
  )

  it.effect("says what to run when there is no key, no name or a broken key", () =>
    inFolder(
      Effect.fnUntraced(function* (files, folder) {
        const fs = yield* FileSystem.FileSystem
        const none = yield* readIdentity(files)
        const missing = yield* Effect.flip(requireIdentity(files))
        yield* fs.makeDirectory(`${folder}/config`)
        yield* fs.writeFileString(files.keyFile, "garbage")
        const broken = yield* Effect.flip(requireIdentity(files))
        yield* issueKey(files, MachineName.make("tower"), true)
        yield* fs.writeFileString(files.nameFile, "Not A Name")
        const badName = yield* Effect.flip(requireIdentity(files))
        yield* fs.remove(files.nameFile)
        const noName = yield* Effect.flip(requireIdentity(files))

        assert.deepStrictEqual(none, Option.none())
        assert.include(missing.message, "Run `sth-seat key --name")
        assert.include(broken.message, "This machine key can't be used")
        assert.include(badName.message, "doesn't hold a machine name")
        assert.include(noName.message, "No machine name at")
      })
    )
  )
})
