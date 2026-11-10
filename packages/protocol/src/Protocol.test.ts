import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Opened, Whereabouts } from "./Actions.ts"
import { DaemonRefused, HubCommand, Outcome } from "./Daemon.ts"
import { FileName } from "./Ids.ts"

const Fixtures = Schema.fromJsonString(
  Schema.Struct({
    commands: Schema.Array(Schema.toCodecJson(HubCommand)),
    outcomes: Schema.Array(Schema.toCodecJson(Outcome)),
    opened: Opened,
    whereabouts: Whereabouts
  })
)

const v1 = Effect.flatMap(
  Effect.promise(() => Bun.file(new URL("../fixtures/v1.json", import.meta.url)).text()),
  Schema.decodeEffect(Fixtures)
)

describe("protocol", () => {
  it.effect("still decodes every message the first daemons and hubs sent", () =>
    Effect.gen(function* () {
      const fixtures = yield* v1
      const received = fixtures.commands[3]

      assert.deepStrictEqual(
        fixtures.commands.map((command) => command._tag),
        ["OpenUrl", "OpenFile", "ReadFile", "ReceiveFile"]
      )
      assert.deepStrictEqual(
        fixtures.outcomes.map((outcome) => outcome._tag),
        ["Done", "FileRead", "Refused"]
      )
      assert.strictEqual(
        new TextDecoder().decode(received?._tag === "ReceiveFile" ? received.bytes : new Uint8Array()),
        "<h1>hi</h1>"
      )
      assert.strictEqual(fixtures.whereabouts.machines[0]?.idleSeconds, 3)
    })
  )

  it("refuses file names that could leave the inbox", () => {
    const valid = Schema.is(FileName)

    assert.deepStrictEqual(["report.html", "..", ".", "a/b", "a\\b", ""].map(valid), [
      true,
      false,
      false,
      false,
      false,
      false
    ])
  })

  it("explains a refused daemon in its own words", () => {
    assert.strictEqual(new DaemonRefused({ reason: "unknown token" }).message, "unknown token")
  })
})
