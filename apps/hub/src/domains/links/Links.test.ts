import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { CommandId, WebUrl } from "@sth-seat/protocol/Ids.ts"
import { done, fakeDaemon, hubServices, cube, tower } from "../../testing/Hub.testing.ts"
import { Links } from "./Links.ts"

const url = WebUrl.make("https://example.com/")

describe("Links", () => {
  it.effect("sends a command to the attached machine and returns its answer", () =>
    Effect.gen(function* () {
      const links = yield* Links
      const daemon = yield* fakeDaemon(cube)
      const outcome = yield* links.call(cube, { _tag: "OpenUrl", url }, "5 seconds")
      const seen = yield* daemon.seen

      assert.deepStrictEqual(outcome, done)
      assert.deepStrictEqual(
        seen.map((command) => command._tag === "OpenUrl" && command.url),
        [url]
      )
      const online = yield* links.online

      assert.deepStrictEqual(online, [cube])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("fails at once for a machine that isn't attached", () =>
    Effect.gen(function* () {
      const links = yield* Links
      const error = yield* Effect.flip(links.call(tower, { _tag: "OpenUrl", url }, "5 seconds"))

      assert.deepStrictEqual([error.machine, error.reason], [tower, "not connected"])
    }).pipe(Effect.provide(hubServices))
  )

  it.effect("gives up when the machine doesn't answer in time", () =>
    Effect.gen(function* () {
      const links = yield* Links
      yield* links.attach(cube).pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
      const call = yield* Effect.forkChild(Effect.flip(links.call(cube, { _tag: "OpenUrl", url }, "5 seconds")))
      yield* TestClock.adjust("6 seconds")
      const error = yield* Fiber.join(call)

      assert.strictEqual(error.reason, "no answer")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("fails what is waiting when a machine leaves, and forgets it", () =>
    Effect.gen(function* () {
      const links = yield* Links
      const link = yield* links.attach(cube).pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }))
      const call = yield* Effect.forkChild(Effect.flip(links.call(cube, { _tag: "OpenUrl", url }, "1 minute")))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(link)
      const error = yield* Fiber.join(call)

      const online = yield* links.online

      assert.strictEqual(error.reason, "not connected")
      assert.deepStrictEqual(online, [])
    }).pipe(Effect.provide(hubServices))
  )

  it.effect("fails only the leaving machine's waiting calls", () =>
    Effect.gen(function* () {
      const links = yield* Links
      const devCommands = yield* Queue.unbounded<CommandId>()
      const mac = yield* links.attach(cube).pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }))
      yield* links.attach(tower).pipe(
        Stream.runForEach((command) => Queue.offer(devCommands, command.id)),
        Effect.forkChild({ startImmediately: true })
      )
      const toMac = yield* Effect.forkChild(Effect.flip(links.call(cube, { _tag: "OpenUrl", url }, "1 minute")))
      const toDev = yield* Effect.forkChild(links.call(tower, { _tag: "OpenUrl", url }, "1 minute"))
      const devCommand = yield* Queue.take(devCommands)
      yield* Fiber.interrupt(mac)
      const macError = yield* Fiber.join(toMac)
      yield* links.answer(devCommand, done)
      const devOutcome = yield* Fiber.join(toDev)

      assert.strictEqual(macError.reason, "not connected")
      assert.deepStrictEqual(devOutcome, done)
    }).pipe(Effect.provide(hubServices))
  )

  it.effect("keeps a machine's newer link when its older one closes", () =>
    Effect.gen(function* () {
      const links = yield* Links
      const older = yield* links.attach(cube).pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }))
      yield* fakeDaemon(cube)
      yield* Fiber.interrupt(older)

      const outcome = yield* links.call(cube, { _tag: "OpenUrl", url }, "5 seconds")

      assert.deepStrictEqual(outcome, done)
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("ignores an answer nobody is waiting for", () =>
    Effect.gen(function* () {
      const links = yield* Links

      yield* links.answer(CommandId.make("01a1a546-373d-7506-84ae-c8403ccc0cef"), done)
    }).pipe(Effect.provide(hubServices))
  )
})
