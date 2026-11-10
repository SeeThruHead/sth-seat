import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Ref, Stream } from "effect"
import type { HubCommand } from "@sth-seat/protocol/Daemon.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { MachinePrivateKey } from "@sth-seat/protocol/Keys.ts"
import { Envelope, EnvelopeId, Port, RemotePath, Reply, SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Event, Request } from "@sth-seat/protocol/Remote.ts"
import { peek, seal } from "@sth-seat/protocol/Sealed.ts"
import { Links } from "../../domains/links/Links.ts"
import { Relays } from "../../domains/relays/Relays.ts"
import { hubServices, keyedMachines, cube, servicesFor, tower } from "../../testing/Hub.testing.ts"
import { relay, relayMore, reply } from "./handler.ts"

const session = SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60")

const sessions = [
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e70",
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e80",
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e90"
].map((id) => SessionId.make(id))

const envelopeId = EnvelopeId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e61")

const run: Request = { _tag: "Run", command: "uname -a" }

type Route = { readonly from: MachineName; readonly to: MachineName }

const fromDev: Route = { from: tower, to: cube }

const command = (key: MachinePrivateKey, request: Request, route: Route = fromDev) =>
  seal(Envelope, key, "command", { id: envelopeId, session, ...route, issuedAt: 1, request })

const answer = (key: MachinePrivateKey, seq: number, event: Event) =>
  seal(Reply, key, "reply", { session, seq, from: cube, to: tower, issuedAt: 1, event })

const recordingDaemon = Effect.fnUntraced(function* (name: MachineName) {
  const links = yield* Links
  const seen = yield* Ref.make<ReadonlyArray<HubCommand>>([])
  yield* links.attach(name).pipe(
    Stream.runForEach((received) => Ref.update(seen, (all) => [...all, received])),
    Effect.forkScoped({ startImmediately: true })
  )

  return { seen: Ref.get(seen) }
})

const tagsOf = (commands: ReadonlyArray<HubCommand>) => commands.map((received) => received._tag)

const withKeys = <A, E, R>(test: (keys: Effect.Success<typeof keyedMachines>) => Effect.Effect<A, E, R>) =>
  keyedMachines.pipe(
    Effect.flatMap((keys) => test(keys).pipe(Effect.provide(servicesFor(keys.roster)))),
    Effect.scoped,
    Effect.provide(BunCrypto.layer)
  )

describe("relay", () => {
  it.effect("forwards a sealed command to its target and streams the target's replies back until the last", () =>
    withKeys(
      Effect.fnUntraced(function* (keys) {
        const daemon = yield* recordingDaemon(cube)
        const sealed = yield* command(keys.devKey, run)
        const replies = yield* relay(tower, sealed)
        const collected = yield* replies.pipe(Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
        const output = yield* answer(keys.macKey, 0, {
          _tag: "Output",
          channel: "stdout",
          bytes: new TextEncoder().encode("Darwin\n")
        })
        const exited = yield* answer(keys.macKey, 1, { _tag: "Exited", code: 0 })
        const impostor = yield* answer(keys.macKey, 1, { _tag: "Exited", code: 9 })
        yield* reply(cube, output)
        yield* reply(tower, impostor)
        yield* reply(cube, exited)
        const received = yield* Fiber.join(collected)
        const events = yield* Effect.forEach(received, (one) => peek(Reply, "reply", one))
        const commands = yield* daemon.seen

        assert.deepStrictEqual(tagsOf(commands), ["Relayed"])
        assert.deepStrictEqual(
          events.map((one) => one.event),
          [
            { _tag: "Output", channel: "stdout", bytes: new TextEncoder().encode("Darwin\n") },
            { _tag: "Exited", code: 0 }
          ]
        )
      })
    )
  )

  it.effect("passes input on to a running session and aborts the session when the caller goes away", () =>
    withKeys(
      Effect.fnUntraced(function* (keys) {
        const daemon = yield* recordingDaemon(cube)
        const started = yield* command(keys.devKey, run)
        const input = yield* command(keys.devKey, { _tag: "Input", bytes: new TextEncoder().encode("hi") })
        const replies = yield* relay(tower, started)
        const draining = yield* replies.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* relayMore(tower, input)
        yield* Fiber.interrupt(draining)
        const late = yield* Effect.flip(relayMore(tower, input))
        const commands = yield* daemon.seen

        assert.deepStrictEqual(tagsOf(commands), ["Relayed", "Relayed", "Abort"])
        assert.strictEqual(late.reason, "That session isn't running any more.")
      })
    )
  )

  it.effect("refuses commands not sealed by the caller, sent as someone else, or that can't start a session", () =>
    withKeys(
      Effect.fnUntraced(function* (keys) {
        yield* recordingDaemon(cube)
        const forged = yield* command(keys.macKey, run)
        const posing = yield* command(keys.devKey, run, { from: cube, to: tower })
        const stray = yield* command(keys.devKey, { _tag: "Cancel" })
        const reasons = yield* Effect.forEach(
          [relay(tower, forged), relay(tower, posing), relay(tower, stray)],
          (attempt) => Effect.flip(attempt).pipe(Effect.map((error) => error.reason))
        )

        assert.include(reasons[0], "The command from tower isn't sealed by it")
        assert.strictEqual(reasons[1], "tower can't send commands as cube.")
        assert.strictEqual(reasons[2], "A session starts with Run, Read, Write or Tunnel, not Cancel.")
      })
    )
  )

  it.effect("says when the target isn't connected or leaves, and when a session id is reused", () =>
    withKeys(
      Effect.fnUntraced(function* (keys) {
        const sealed = yield* command(keys.devKey, run)
        const offline = yield* Effect.flip(relay(tower, sealed))
        const links = yield* Links
        const attached = yield* links.attach(cube).pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        const replies = yield* relay(tower, sealed)
        const reused = yield* Effect.flip(relay(tower, sealed))
        const collected = yield* replies.pipe(
          Stream.runCollect,
          Effect.flip,
          Effect.forkScoped({ startImmediately: true })
        )
        yield* Fiber.interrupt(attached)
        yield* Relays.use((relays) => relays.machineLeft(cube))
        const gone = yield* Fiber.join(collected)

        assert.strictEqual(offline.reason, "cube isn't connected to the hub.")
        assert.strictEqual(reused.reason, "That session is already running.")
        assert.strictEqual(gone.reason, "cube disconnected from the hub.")
      })
    )
  )

  it.effect("ignores replies that don't read", () => withKeys(() => reply(cube, { payload: "{", signature: "" })))
})

describe("relay sessions", () => {
  it.effect("start with Read, Write or Tunnel, and take input only from the machine that started them", () =>
    withKeys(
      Effect.fnUntraced(function* (keys) {
        const daemon = yield* recordingDaemon(cube)
        const requests: ReadonlyArray<Request> = [
          { _tag: "Read", path: RemotePath.make("~/a") },
          { _tag: "Write", path: RemotePath.make("~/b") },
          { _tag: "Tunnel", port: Port.make(6006) }
        ]
        const starts = yield* Effect.forEach(requests, (request, index) =>
          seal(Envelope, keys.devKey, "command", {
            id: envelopeId,
            session: sessions[index] ?? session,
            from: tower,
            to: cube,
            issuedAt: 1,
            request
          }).pipe(Effect.flatMap((sealed) => relay(tower, sealed)))
        )
        const intruding = yield* seal(Envelope, keys.macKey, "command", {
          id: envelopeId,
          session: sessions[0] ?? session,
          from: cube,
          to: cube,
          issuedAt: 1,
          request: { _tag: "Input", bytes: new TextEncoder().encode("x") }
        })
        const refused = yield* Effect.flip(relayMore(cube, intruding))
        const commands = yield* daemon.seen

        assert.strictEqual(starts.length, 3)
        assert.deepStrictEqual(tagsOf(commands), ["Relayed", "Relayed", "Relayed"])
        assert.strictEqual(refused.reason, "That session isn't running any more.")
      })
    )
  )

  it.effect("end only the sessions of the machine that left", () =>
    Effect.gen(function* () {
      const relays = yield* Relays
      const toMac = yield* relays.open({ session, owner: tower, target: cube })
      const toDev = yield* relays.open({ session: sessions[1] ?? session, owner: cube, target: tower })
      const macEnded = yield* toMac.pipe(Stream.runDrain, Effect.flip, Effect.forkScoped({ startImmediately: true }))
      yield* relays.machineLeft(cube)
      const gone = yield* Fiber.join(macEnded)
      const devStillOpen = yield* relays.isOpen({ session: sessions[1] ?? session, owner: cube, target: tower })
      const strangerSees = yield* relays.isOpen({ session: sessions[1] ?? session, owner: tower, target: tower })

      assert.strictEqual(gone.reason, "cube disconnected from the hub.")
      assert.deepStrictEqual([devStillOpen, strangerSees], [true, false])
      assert.isDefined(toDev)
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )
})

describe("relay without keys", () => {
  it.effect("tells a machine the hub has no key for to run sth-seat key", () =>
    Effect.gen(function* () {
      const keys = yield* keyedMachines
      const sealed = yield* command(keys.devKey, run)
      const error = yield* Effect.flip(relay(tower, sealed)).pipe(Effect.provide(hubServices))

      assert.strictEqual(error.reason, "The hub has no public key for tower; run `sth-seat key` there.")
    }).pipe(Effect.provide(BunCrypto.layer))
  )
})
