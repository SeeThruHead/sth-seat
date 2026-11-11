import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import type { HubCommand, Outcome } from "@sth-seat/protocol/Daemon.ts"
import { Hostname, MachineName, SecretName } from "@sth-seat/protocol/Ids.ts"
import { devMachine, done, fakeDaemon, hubServices, cube, sitAt, tower } from "../../testing/Hub.testing.ts"
import { askSecret, askSecretFromAgent, askSecretFromMachine } from "./handler.ts"

const request = { name: SecretName.make("plex-token"), question: "Plex token for the media stack?" }

const seatAnswers = (command: HubCommand): Outcome =>
  command._tag === "AskSecret" ? { _tag: "SecretGiven", value: Redacted.make("s3cret") } : done

const originStores = (command: HubCommand): Outcome =>
  command._tag === "StoreSecret"
    ? { _tag: "Stored", path: `/home/user/.local/share/sth-seat/secrets/${command.name}` }
    : done

describe("askSecret", () => {
  it.effect("asks on the seat, stores on the asking machine, and hands back only the path", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube, seatAnswers)
      const dev = yield* fakeDaemon(tower, originStores)
      yield* sitAt(cube, [tower])
      const stored = yield* askSecretFromAgent({ ...request, from: Hostname.make("Tower") })
      const macSaw = yield* mac.seen
      const devSaw = yield* dev.seen

      assert.strictEqual(stored.path, "/home/user/.local/share/sth-seat/secrets/plex-token")
      assert.notInclude(`${stored.path} ${stored.message} ${stored.machine}`, "s3cret")
      assert.deepStrictEqual(
        macSaw.map((command) => (command._tag === "AskSecret" ? command.destination : command._tag)),
        [{ machine: devMachine.label, file: "~/.local/share/sth-seat/secrets/plex-token" }]
      )
      assert.deepStrictEqual(
        devSaw.map((command) => (command._tag === "StoreSecret" ? Redacted.value(command.value) : command._tag)),
        ["s3cret"]
      )
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect(
    "says when the user cancels, nobody is connected, a machine answers oddly, or the hostname is unknown",
    () =>
      Effect.gen(function* () {
        const nobody = yield* Effect.flip(askSecret(request, devMachine))
        yield* fakeDaemon(cube, (command) =>
          command._tag === "AskSecret" ? { _tag: "Refused", reason: "The user cancelled" } : done
        )
        yield* sitAt(cube)
        const cancelled = yield* Effect.flip(askSecret(request, devMachine))
        const unknown = yield* Effect.flip(askSecretFromAgent({ ...request, from: Hostname.make("nowhere") }))

        assert.include(nobody.message, "None of the user's machines")
        assert.include(cancelled.message, "The user cancelled")
        assert.include(unknown.message, "doesn't know a machine called nowhere")
      }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("fails when the seat or the asking machine answers with something else", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube)
      yield* sitAt(cube)
      const odd = yield* Effect.flip(askSecret(request, devMachine))
      yield* fakeDaemon(tower)
      const oddStore = yield* Effect.flip(askSecret(request, { ...devMachine, name: cube }))

      assert.include(odd.message, "where SecretGiven was expected")
      assert.include(oddStore.message, "where SecretGiven was expected")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("asks for the machine that called over RPC, and refuses one the hub doesn't know", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube, seatAnswers)
      yield* fakeDaemon(tower, originStores)
      yield* sitAt(cube, [tower])
      const stored = yield* askSecretFromMachine(request, tower)
      const stranger = yield* Effect.flip(askSecretFromMachine(request, MachineName.make("stranger")))

      assert.strictEqual(stored.machine, tower)
      assert.strictEqual(stranger.message, "The hub doesn't know stranger.")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("refuses a machine whose secrets stay on it before asking the seat", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube, seatAnswers)
      yield* fakeDaemon(tower, originStores)
      yield* sitAt(cube, [tower])
      const kept = { ...devMachine, secrets: "here" as const }
      const refused = yield* Effect.flip(askSecret(request, kept))
      const macSaw = yield* mac.seen

      assert.include(refused.message, "Secrets asked from Tower stay on it")
      assert.deepStrictEqual(macSaw, [])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )
})
