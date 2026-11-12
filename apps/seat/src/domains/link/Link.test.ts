import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, FileSystem, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Link, linkProblem } from "./Link.ts"

const inFolder = <A, E>(use: (folder: string) => Effect.Effect<A, E, Link | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* use(folder).pipe(Effect.provide(Link.layer(`${folder}/state`)))
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer))

const problemNow = Effect.gen(function* () {
  const state = yield* Link.use((link) => link.state)
  const now = yield* DateTime.now

  return Option.getOrElse(linkProblem(state, now), () => "linked")
})

describe("Link", () => {
  it.effect("is never linked before the daemon reports, and linked while it keeps reporting", () =>
    inFolder(
      Effect.fnUntraced(function* () {
        const link = yield* Link
        const before = yield* problemNow
        yield* link.connected
        const after = yield* problemNow

        assert.include(before, "has never linked to the hub")
        assert.strictEqual(after, "linked")
      })
    )
  )

  it.effect("says the daemon stopped when it hasn't reported for a minute", () =>
    inFolder(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const link = yield* Link
        yield* link.connected
        yield* fs.utimes(`${folder}/state/link`, 0, 0)
        yield* TestClock.adjust("3 hours")
        const problem = yield* problemNow

        assert.include(problem, "hasn't reported to the hub since 3 h ago (it isn't running)")
      })
    )
  )

  it.effect("keeps when and why the link was first lost until it comes back", () =>
    inFolder(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const link = yield* Link
        yield* link.connected
        yield* link.lost("Can't reach the hub")
        yield* fs.utimes(`${folder}/state/link`, 0, 0)
        yield* link.lost("socket closed")
        yield* TestClock.adjust("90 seconds")
        const lost = yield* problemNow
        yield* TestClock.adjust("3 days")
        const later = yield* problemNow
        yield* link.connected
        const back = yield* problemNow

        assert.include(lost, "lost its link to the hub 90s ago (Can't reach the hub) and is still trying")
        assert.include(later, "3 days ago")
        assert.strictEqual(back, "linked")
      })
    )
  )

  it.effect("only logs when the state folder can't be written", () =>
    Link.use((link) => link.connected).pipe(
      Effect.provide(Link.layer("/proc/no-such/state").pipe(Layer.provide(BunServices.layer)))
    )
  )
})
