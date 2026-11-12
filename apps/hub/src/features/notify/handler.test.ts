import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Hostname, MachineName, Title } from "@sth-seat/protocol/Ids.ts"
import { Links } from "../../domains/links/Links.ts"
import {
  cube,
  desk,
  deskMachine,
  devMachine,
  fakeDaemon,
  hubServices,
  sidedServices,
  sitAt,
  tower
} from "../../testing/Hub.testing.ts"
import { linkLost, lostGrace, notify, notifyFromAgent } from "./handler.ts"

const request = { title: Title.make("Build finished"), message: "The release build passed." }

describe("notify", () => {
  it.effect("shows the notification on the machine the user used last, saying where it came from", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const dev = yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])
      const notified = yield* notify(request, devMachine)
      const macSaw = yield* mac.seen
      const devSaw = yield* dev.seen

      assert.strictEqual(notified.message, 'Showed "Build finished" on Cube.')
      assert.deepStrictEqual(
        macSaw.map((command) => (command._tag === "Notify" ? [command.title, command.message, command.origin] : [])),
        [["Build finished", "The release build passed.", tower]]
      )
      assert.deepStrictEqual(devSaw, [])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("shows nothing anywhere when the caller isn't connected, and keeps to the caller's side", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      yield* sitAt(cube, [desk])
      const error = yield* Effect.flip(notify(request, deskMachine))
      const work = yield* fakeDaemon(desk)
      const notified = yield* notifyFromAgent({ ...request, from: Hostname.make("Work-Desk") })
      const macSaw = yield* mac.seen
      const workSaw = yield* work.seen

      assert.include(error.message, "Desk isn't connected to the hub")
      assert.strictEqual(notified.machine, desk)
      assert.deepStrictEqual(macSaw, [])
      assert.strictEqual(workSaw.length, 1)
    }).pipe(Effect.scoped, Effect.provide(sidedServices))
  )

  it.effect("names the machines it knows when the agent's hostname is unknown", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(notifyFromAgent({ ...request, from: Hostname.make("laptop") }))

      assert.include(error.message, "doesn't know a machine called laptop")
    }).pipe(Effect.provide(hubServices))
  )
})

describe("linkLost", () => {
  it.effect("tells the seat on the same side when a machine stays gone, and nobody on the other side", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const work = yield* fakeDaemon(desk)
      yield* sitAt(cube, [desk])
      const watching = yield* Effect.forkScoped(
        Effect.all([linkLost(tower), linkLost(desk)], { concurrency: "unbounded" }),
        {
          startImmediately: true
        }
      )
      yield* TestClock.adjust(lostGrace)
      yield* Fiber.join(watching)
      const macSaw = yield* mac.seen
      const workSaw = yield* work.seen

      assert.deepStrictEqual(
        macSaw.map((command) => (command._tag === "Notify" ? [command.origin, command.message] : [])),
        [
          [
            tower,
            "Tower lost its link to the hub 2m ago and hasn't come back, so nothing opens or shows there. Run `sth-seat doctor` on it."
          ]
        ]
      )
      assert.deepStrictEqual(workSaw, [])
    }).pipe(Effect.scoped, Effect.provide(sidedServices))
  )

  it.effect("says nothing when the machine came back, is unknown, or nobody else is there to see it", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube, () => ({ _tag: "Refused", reason: "busy" }))
      yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])
      const links = yield* Links
      yield* links.attach(desk).pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
      const watching = yield* Effect.forkScoped(
        Effect.all([linkLost(tower), linkLost(MachineName.make("stranger")), linkLost(desk), linkLost(cube)], {
          concurrency: "unbounded"
        }),
        { startImmediately: true }
      )
      yield* TestClock.adjust(lostGrace)
      yield* Fiber.join(watching)
      const macSaw = yield* mac.seen

      assert.deepStrictEqual(macSaw, [])
    }).pipe(Effect.scoped, Effect.provide(sidedServices))
  )

  it.effect("only logs when the seat won't show that a link was lost", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube, () => ({ _tag: "Refused", reason: "busy" }))
      yield* sitAt(cube)
      const watching = yield* Effect.forkScoped(linkLost(tower), { startImmediately: true })
      yield* TestClock.adjust(lostGrace)
      yield* Fiber.join(watching)
      const macSaw = yield* mac.seen

      assert.strictEqual(macSaw.length, 1)
    }).pipe(Effect.scoped, Effect.provide(sidedServices))
  )
})
