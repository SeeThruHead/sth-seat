import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { CommandId, FileName, FilePath, maxFileBytes } from "@sth-seat/protocol/Ids.ts"
import { Files } from "./Files.ts"

const id = CommandId.make("01a1a546-373d-7506-84ae-c8403ccc0cef")

const withFiles = <A, E>(use: (folder: string) => Effect.Effect<A, E, Files | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* use(folder).pipe(Effect.provide(Files.layer(`${folder}/inbox`)))
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer))

describe("Files", () => {
  it.effect("reads a regular file with its name", () =>
    withFiles(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const files = yield* Files
        yield* fs.writeFileString(`${folder}/report.html`, "<h1>hi</h1>")
        const file = yield* files.read(FilePath.make(`${folder}/report.html`))

        assert.strictEqual(file.name, "report.html")
        assert.strictEqual(new TextDecoder().decode(file.bytes), "<h1>hi</h1>")
      })
    )
  )

  it.effect("refuses folders, missing files, files over the size limit and names it can't send", () =>
    withFiles(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const files = yield* Files
        yield* fs.writeFileString(`${folder}/huge.bin`, "")
        yield* fs.truncate(`${folder}/huge.bin`, maxFileBytes + 1)
        yield* fs.writeFileString(`${folder}/back\\slash.html`, "x")
        yield* fs.writeFileString(`${folder}/private.html`, "x")
        yield* fs.chmod(`${folder}/private.html`, 0o000)
        const paths = [
          folder,
          `${folder}/missing.html`,
          `${folder}/huge.bin`,
          `${folder}/back\\slash.html`,
          `${folder}/private.html`
        ]
        const errors = yield* Effect.forEach(paths, (path) => Effect.flip(files.read(FilePath.make(path))))

        assert.deepStrictEqual(
          errors.map((error) => error.problem.split(":")[0]),
          [
            "isn't a regular file.",
            "can't be read",
            "is 33 MB; files up to 32 MB can be sent.",
            "has no usable name.",
            "can't be read"
          ]
        )
        assert.strictEqual(errors[0]?.message, `${folder} isn't a regular file.`)
      })
    )
  )

  it.effect("files what it receives under the command's own folder in the inbox", () =>
    withFiles(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const files = yield* Files
        const saved = yield* files.receive(id, FileName.make("report.html"), new TextEncoder().encode("<p>x</p>"))
        const text = yield* fs.readFileString(saved)

        assert.strictEqual(saved, `${folder}/inbox/${id}/report.html`)
        assert.strictEqual(text, "<p>x</p>")
      })
    )
  )

  it.effect("says when it can't write into the inbox", () =>
    Effect.gen(function* () {
      const files = yield* Files
      const error = yield* Effect.flip(files.receive(id, FileName.make("a.html"), new Uint8Array()))

      assert.include(error.message, "can't be written")
    }).pipe(Effect.provide(Files.layer("/proc/sth-seat-inbox").pipe(Layer.provideMerge(BunServices.layer))))
  )
})
