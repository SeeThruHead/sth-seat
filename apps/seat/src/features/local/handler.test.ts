import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option } from "effect"
import { Title } from "@sth-seat/protocol/Ids.ts"
import { Files } from "../../domains/files/Files.ts"
import type { Desktop } from "../../platform/Desktop.ts"
import { Opened, recordingDesktop } from "../../testing/Seat.testing.ts"
import { openHere } from "./handler.ts"

const here = <A, E>(use: (folder: string) => Effect.Effect<A, E, Files | Opened | Desktop | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* use(folder).pipe(
      Effect.provide([Files.layer(`${folder}/inbox`, `${folder}/secrets`), recordingDesktop])
    )
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer))

describe("openHere", () => {
  it.effect("opens a link, a document or a file:// URL on this machine, and reveals what it can't open", () =>
    here(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const opened = yield* Opened
        yield* fs.writeFileString(`${folder}/report.html`, "<h1>hi</h1>")
        yield* fs.writeFileString(`${folder}/run.command`, "echo hi")
        const results = yield* Effect.all([
          openHere("https://example.com/", Option.none(), false),
          openHere(`${folder}/report.html`, Option.some(Title.make("Report")), false),
          openHere(`file://${folder}/report.html`, Option.none(), false),
          openHere(`${folder}/run.command`, Option.none(), true)
        ])
        const refused = yield* Effect.flip(openHere(`${folder}/run.command`, Option.none(), false))
        const notLink = yield* Effect.flip(openHere("ftp://example.com/", Option.none(), false))
        const all = yield* opened.all

        assert.deepStrictEqual(
          results.map((result) => result._tag),
          ["Url", "File", "File", "File"]
        )
        assert.include(refused.message, "never opened where it could run")
        assert.isDefined(notLink)
        assert.deepStrictEqual(all, [
          "url https://example.com/",
          `file ${folder}/report.html Report`,
          `file ${folder}/report.html -`,
          `reveal ${folder}/run.command`
        ])
      })
    )
  )
})
