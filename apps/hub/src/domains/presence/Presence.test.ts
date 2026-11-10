import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import { cube, tower, idle } from "../../testing/Hub.testing.ts"
import { Presence } from "./Presence.ts"

describe("Presence", () => {
  it.effect("remembers when each machine last saw input, as now minus its idle time", () =>
    Effect.gen(function* () {
      const presence = yield* Presence
      yield* TestClock.setTime(60_000)
      yield* presence.report(cube, idle(15_000))
      yield* TestClock.adjust("10 seconds")
      yield* presence.report(cube, idle(2_000))

      const mac = yield* presence.lastInputOf(cube)
      const dev = yield* presence.lastInputOf(tower)

      assert.deepStrictEqual(mac, Option.some(DateTime.makeUnsafe(68_000)))
      assert.deepStrictEqual(dev, Option.none())
    }).pipe(Effect.provide(Presence.layer))
  )
})
