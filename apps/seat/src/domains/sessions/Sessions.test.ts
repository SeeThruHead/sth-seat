import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Option, Stream } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { SessionId } from "@sth-seat/protocol/Remote.ts"
import { Sessions } from "./Sessions.ts"

const session = SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60")

const tower = MachineName.make("tower")

const cube = MachineName.make("cube")

describe("Sessions", () => {
  it.effect("feed input only from the session's owner, and stop only for the owner or the hub", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const received = yield* Deferred.make<string>()
      const started = yield* sessions.start(session, tower, (input) =>
        Stream.mkString(Stream.decodeText(input)).pipe(Effect.flatMap((text) => Deferred.succeed(received, text)))
      )
      const twice = yield* sessions.start(session, tower, () => Effect.void)
      const fromOther = yield* sessions.feed(session, cube, new TextEncoder().encode("no"))
      yield* sessions.feed(session, tower, new TextEncoder().encode("yes"))
      const endedByOther = yield* sessions.endInput(session, cube)
      yield* sessions.endInput(session, tower)
      const text = yield* Deferred.await(received)
      const stoppedByOther = yield* sessions.stop(session, Option.some(cube))

      assert.deepStrictEqual(
        [started, twice, fromOther, endedByOther, stoppedByOther],
        [true, false, false, false, false]
      )
      assert.strictEqual(text, "yes")
    }).pipe(Effect.provide(Sessions.layer), Effect.scoped)
  )
})
