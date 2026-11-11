import { BunCrypto, BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Exit, FileSystem, Layer, Option, Predicate, Queue, Ref, Sink, Stdio, Stream } from "effect"
import { RpcTest } from "effect/rpc"
import { ConnectedMachine, DaemonAuth, DaemonRpcs, daemonAuthClient } from "@sth-seat/protocol/Daemon.ts"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { newKeyPair, textOf } from "@sth-seat/protocol/Keys.ts"
import { RemotePath, Reply, isLast } from "@sth-seat/protocol/Remote.ts"
import { peek } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Me } from "../domains/identity/Me.ts"
import { Messages } from "../domains/messages/Messages.ts"
import { Policies } from "../domains/policy/Policies.ts"
import { Sessions } from "../domains/sessions/Sessions.ts"
import { freshSeen, relayed } from "../features/remote/handler.ts"
import { Ports } from "../platform/Ports.ts"
import { Shell } from "../platform/Shell.ts"
import { machineIn, recordingDesktop, writePolicy } from "../testing/Seat.testing.ts"
import { download, linkTo, outcomeOf, runOn, sendMessage, upload } from "./Remote.ts"

const cube = MachineName.make("cube")

const tower = MachineName.make("tower")

const twoMachines = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectoryScoped()
  const mac = yield* newKeyPair
  const dev = yield* newKeyPair
  const macText = yield* textOf(mac.publicKey)
  const devText = yield* textOf(dev.publicKey)
  yield* fs.makeDirectory(`${root}/mac`)
  yield* fs.makeDirectory(`${root}/dev`)
  yield* writePolicy(
    `${root}/mac`,
    `machines:\n  tower: ${devText}\nallow:\n  - from: [tower]\n    can: [shell, read, write]\n`
  )
  yield* writePolicy(`${root}/dev`, `machines:\n  cube: ${macText}\n`)

  return { root, mac, dev, devText }
})

type Machines = Effect.Success<typeof twoMachines>

const macSide = (machines: Machines) =>
  Layer.mergeAll(
    machineIn(`${machines.root}/mac`),
    Layer.succeed(Me, Me.of({ name: cube, key: machines.mac.privateKey, publicKey: machines.mac.publicKey })),
    Shell.layer("/bin/sh"),
    Ports.layer,
    Sessions.layer,
    recordingDesktop
  )

const fakeHub = (machines: Machines) =>
  Effect.gen(function* () {
    const seen = yield* freshSeen
    const replies = yield* Queue.unbounded<Sealed>()
    const context = yield* Effect.context<Effect.Services<ReturnType<typeof relayed>>>()
    const deliver = (sealed: Sealed) =>
      relayed(sealed, (reply) => Queue.offer(replies, reply), seen, {
        home: `${machines.root}/mac`,
        maxRun: Duration.seconds(30)
      }).pipe(Effect.provideContext(context))
    const untilLast = Stream.fromQueue(replies).pipe(
      Stream.takeUntilEffect((reply) =>
        peek(Reply, "reply", reply).pipe(
          Effect.map((one) => isLast(one.event)),
          Effect.orDie
        )
      )
    )

    return DaemonRpcs.toLayer(
      Effect.succeed(
        DaemonRpcs.of({
          Attach: () => Stream.empty,
          Presence: () => Effect.void,
          Answer: () => Effect.void,
          Open: () => Effect.die("unused"),
          Where: () => Effect.die("unused"),
          Notify: () => Effect.die("unused"),
          AskSecret: () => Effect.die("unused"),
          Relay: ({ sealed }) => Stream.unwrap(Effect.as(deliver(sealed), untilLast)),
          RelayMore: ({ sealed }) => deliver(sealed),
          Reply: () => Effect.void
        })
      )
    )
  }).pipe(Layer.unwrap, Layer.provide(macSide(machines)))

const devIdentity = (machines: Machines) => ({
  name: tower,
  key: machines.dev.privateKey,
  publicKey: machines.dev.publicKey,
  publicText: machines.devText
})

const fromDev = <A, E, R>(use: (machines: Machines, written: Ref.Ref<string>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const machines = yield* twoMachines
    const written = yield* Ref.make("")
    const stdio = Stdio.layerTest({
      stdout: () =>
        Sink.forEach((chunk) =>
          Ref.update(written, (all) => all + (Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk)))
        )
    })
    const serverAuth = Layer.succeed(
      DaemonAuth,
      DaemonAuth.of((effect) => Effect.provideService(effect, ConnectedMachine, ConnectedMachine.of({ name: tower })))
    )

    return yield* use(machines, written).pipe(
      Effect.provide([
        fakeHub(machines),
        serverAuth,
        daemonAuthClient(Effect.succeed("test")),
        Policies.layer(`${machines.root}/dev/policy.yaml`),
        stdio
      ])
    )
  }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))

const hubClient = RpcTest.makeClient(DaemonRpcs)

describe("sth-seat run", () => {
  it.live("prints the remote output and fails with the remote exit code", () =>
    fromDev(
      Effect.fnUntraced(function* (machines, written) {
        const hub = yield* hubClient
        const link = yield* linkTo(hub, devIdentity(machines), cube)
        const exit = yield* Effect.exit(
          runOn(link, {
            command: "echo hi; exit 3",
            cwd: Option.none(),
            timeoutSeconds: Option.some(20),
            input: false
          }).pipe(Effect.scoped)
        )
        const printed = yield* Ref.get(written)

        assert.strictEqual(printed, "hi\n")
        assert.deepStrictEqual(
          Exit.isFailure(exit) ? Exit.findErrorOption(exit).pipe(Option.map((error) => error._tag)) : Option.none(),
          Option.some("RemoteExited")
        )
      })
    )
  )

  it.live("passes this machine's input through and finishes cleanly", () =>
    fromDev(
      Effect.fnUntraced(function* (machines, written) {
        const hub = yield* hubClient
        const link = yield* linkTo(hub, devIdentity(machines), cube)
        yield* runOn(link, {
          command: "cat",
          cwd: Option.some(RemotePath.make("~")),
          timeoutSeconds: Option.none(),
          input: true
        }).pipe(
          Effect.scoped,
          Effect.provide(
            Stdio.layerTest({
              stdin: Stream.make(new TextEncoder().encode("through")),
              stdout: () =>
                Sink.forEach((chunk) =>
                  Ref.update(
                    written,
                    (all) => all + (Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk))
                  )
                )
            })
          )
        )
        const printed = yield* Ref.get(written)

        assert.strictEqual(printed, "through")
      })
    )
  )

  it.live("refuses a machine this one has no pinned key for", () =>
    fromDev(
      Effect.fnUntraced(function* (machines) {
        const hub = yield* hubClient
        const error = yield* Effect.flip(linkTo(hub, devIdentity(machines), MachineName.make("work-mac")))

        assert.include(error.message, "doesn't know work-mac's key")
      })
    )
  )
})

describe("sth-seat cp", () => {
  it.live("copies a file there and back", () =>
    fromDev(
      Effect.fnUntraced(function* (machines) {
        const fs = yield* FileSystem.FileSystem
        const hub = yield* hubClient
        const local = `${machines.root}/dev/notes.txt`
        yield* fs.writeFileString(local, "x".repeat(600_000))
        const up = yield* linkTo(hub, devIdentity(machines), cube)
        const sent = yield* upload(up, local, RemotePath.make("~/notes.txt")).pipe(Effect.scoped)
        const down = yield* linkTo(hub, devIdentity(machines), cube)
        const received = yield* download(down, RemotePath.make("~/notes.txt"), `${machines.root}/dev/back.txt`)
        const back = yield* fs.readFileString(`${machines.root}/dev/back.txt`)
        const missing = yield* linkTo(hub, devIdentity(machines), cube).pipe(
          Effect.flatMap((link) => download(link, RemotePath.make("~/gone.txt"), `${machines.root}/dev/gone.txt`)),
          Effect.flip
        )

        assert.deepStrictEqual([sent, received, back.length], [600_000, 600_000, 600_000])
        assert.include(missing.message, "doesn't exist on this machine")
      })
    )
  )

  it.effect("turns a refusal into a problem and a clean finish into nothing", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(outcomeOf({ _tag: "Denied", reason: "no" }))
      yield* outcomeOf({ _tag: "Finished", bytes: 1 })
      yield* outcomeOf({ _tag: "Exited", code: 0 })

      assert.strictEqual(refused.message, "no")
    })
  )
})

describe("sth-seat send", () => {
  it.live("puts a message in the other machine's inbox once its policy takes messages from this one", () =>
    fromDev(
      Effect.fnUntraced(function* (machines) {
        const hub = yield* hubClient
        const refused = yield* linkTo(hub, devIdentity(machines), cube).pipe(
          Effect.flatMap((link) => sendMessage(link, "hello")),
          Effect.flip
        )
        yield* writePolicy(
          `${machines.root}/mac`,
          `machines:\n  tower: ${machines.devText}\nmessages:\n  from: [tower]\n`
        )
        const bytes = yield* linkTo(hub, devIdentity(machines), cube).pipe(
          Effect.flatMap((link) => sendMessage(link, "hello"))
        )
        const inbox = yield* Messages.use((messages) => messages.unread).pipe(
          Effect.provide(Messages.layer(`${machines.root}/mac/state`))
        )

        assert.include(refused.message, "doesn't take messages from tower")
        assert.strictEqual(bytes, 5)
        assert.deepStrictEqual(
          inbox.map((message) => [message.from, message.text]),
          [[tower, "hello"]]
        )
      })
    )
  )
})
