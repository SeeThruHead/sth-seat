import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { fakeDaemon, hubServices, cube, sitAt, tower } from "../../testing/Hub.testing.ts"
import { where } from "./handler.ts"

describe("where", () => {
  it.effect("reports the seat and every known machine", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(3_600_000)
      yield* fakeDaemon(tower)
      yield* sitAt(tower, [cube])
      const found = yield* where

      assert.strictEqual(found.seat, tower)
      assert.strictEqual(
        found.message,
        "The user is at Tower (last input 1s ago). Cube: not connected, last input 10 min ago."
      )
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )
})
