import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Title } from "@sth-seat/protocol/Ids.ts"
import { fakeDaemon, hubServices, cube, sitAt, tower } from "../../testing/Hub.testing.ts"
import { notify } from "./handler.ts"

const request = { title: Title.make("Build finished"), message: "The release build passed." }

describe("notify", () => {
  it.effect("shows the notification on the machine the user used last", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const dev = yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])
      const notified = yield* notify(request)
      const macSaw = yield* mac.seen
      const devSaw = yield* dev.seen

      assert.strictEqual(notified.message, 'Showed "Build finished" on Cube.')
      assert.deepStrictEqual(
        macSaw.map((command) => (command._tag === "Notify" ? [command.title, command.message] : [])),
        [["Build finished", "The release build passed."]]
      )
      assert.deepStrictEqual(devSaw, [])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("says so when no machine is connected", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(notify(request))

      assert.include(error.message, "None of the user's machines")
    }).pipe(Effect.provide(hubServices))
  )
})
