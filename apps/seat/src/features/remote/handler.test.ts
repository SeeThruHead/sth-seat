import { BunCrypto, BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Duration, Effect, FileSystem, Layer, Ref, Schedule, Stream } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { newKeyPair, textOf } from "@sth-seat/protocol/Keys.ts"
import type { MachinePrivateKey } from "@sth-seat/protocol/Keys.ts"
import { Envelope, EnvelopeId, Port, RemotePath, Reply, SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Event, Request } from "@sth-seat/protocol/Remote.ts"
import { peek, seal } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Audit } from "../../domains/audit/Audit.ts"
import { Messages } from "../../domains/messages/Messages.ts"
import { Sessions } from "../../domains/sessions/Sessions.ts"
import { Ports } from "../../platform/Ports.ts"
import { Shell } from "../../platform/Shell.ts"
import { Opened, machineIn, recordingDesktop, testMe, writePolicy } from "../../testing/Seat.testing.ts"
import { aborted, freshSeen, relayed } from "./handler.ts"

const cube = MachineName.make("cube")

const tower = MachineName.make("tower")

const sessionIds = [
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60",
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e70",
  "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e80"
].map((id) => SessionId.make(id))

const counter = Ref.makeUnsafe(0)

const nextId = Ref.getAndUpdate(counter, (count) => count + 1).pipe(
  Effect.map((count) => EnvelopeId.make(`019a5f3e-6a2b-7c4d-8e9f-${count.toString(16).padStart(12, "0")}`))
)

type Sending = {
  readonly key: MachinePrivateKey
  readonly session?: SessionId | undefined
  readonly to?: MachineName
  readonly issuedAt?: number
}

const envelope = Effect.fnUntraced(function* (sending: Sending, request: Request) {
  const id = yield* nextId
  const now = yield* DateTime.now

  return yield* seal(Envelope, sending.key, "command", {
    id,
    session: sending.session ?? sessionIds[0] ?? SessionId.make(""),
    from: tower,
    to: sending.to ?? cube,
    issuedAt: sending.issuedAt ?? DateTime.toEpochMillis(now),
    request
  })
})

const text = (events: ReadonlyArray<Event>) =>
  events.flatMap((event) => (event._tag === "Output" ? [new TextDecoder().decode(event.bytes)] : [])).join("")

const settled = (events: ReadonlyArray<Event>) => events.some((event) => event._tag !== "Output")

const onMac = <A, E, R>(test: (setup: Effect.Success<typeof setUp>) => Effect.Effect<A, E, R>) =>
  setUp.pipe(Effect.flatMap(test), Effect.scoped)

const setUp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const folder = yield* fs.makeTempDirectoryScoped()
  const dev = yield* newKeyPair
  const devText = yield* textOf(dev.publicKey)
  const sent = yield* Ref.make<ReadonlyArray<Sealed>>([])
  const seen = yield* freshSeen
  const policy = (rules: string) => writePolicy(folder, `machines:\n  tower: ${devText}\n${rules}`)
  const send = (sealed: Sealed) => Ref.update(sent, (all) => [...all, sealed])
  const settings = { home: folder, maxRun: Duration.seconds(30) }
  const deliver = (sealed: Sealed) => relayed(sealed, send, seen, settings)
  const events = Ref.get(sent).pipe(
    Effect.flatMap((all) => Effect.forEach(all, (one) => peek(Reply, "reply", one))),
    Effect.map((all) => all.filter((one) => one.event._tag !== "Started"))
  )
  const waitForEnd = events.pipe(
    Effect.repeat({ until: (all) => settled(all.map((one) => one.event)), schedule: Schedule.spaced("20 millis") }),
    Effect.timeout("10 seconds")
  )

  return { folder, devKey: dev.privateKey, policy, deliver, events, waitForEnd }
})

const layer = (folder: string) =>
  Layer.mergeAll(machineIn(folder), testMe(cube), Shell.layer("/bin/sh"), Ports.layer, Sessions.layer, recordingDesktop)

const machine = <A, E, R>(test: (setup: Effect.Success<typeof setUp>) => Effect.Effect<A, E, R>) =>
  onMac((setup) => test(setup).pipe(Effect.provide(layer(setup.folder)))).pipe(
    Effect.provide([BunServices.layer, BunCrypto.layer])
  )

describe("relayed commands", () => {
  it.live("run a shell command for a machine the policy names, and answer with sealed, numbered replies", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [shell]\n")
        yield* envelope({ key: setup.devKey }, { _tag: "Run", command: "echo hi; exit 4" }).pipe(
          Effect.flatMap(setup.deliver)
        )
        const replies = yield* setup.waitForEnd
        const audit = yield* Audit
        const logged = yield* audit
          .recent(5)
          .pipe(
            Effect.repeat({ until: (entries) => entries.length >= 2, schedule: Schedule.spaced("20 millis") }),
            Effect.timeout("10 seconds")
          )

        assert.strictEqual(text(replies.map((one) => one.event)), "hi\n")
        assert.deepStrictEqual(replies.at(-1)?.event, { _tag: "Exited", code: 4 })
        assert.deepStrictEqual(
          replies.map((one) => [one.seq, one.from, one.to]),
          replies.map((_, index) => [index + 1, cube, tower])
        )
        assert.deepStrictEqual(
          logged.map((entry) => entry.result),
          ["started", "exit 4"]
        )
      })
    )
  )

  it.live("refuse callers outside the policy or not signed by their pinned key, and a command already run", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const stranger = yield* newKeyPair
        const run: Request = { _tag: "Run", command: "true" }
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [read]\n")
        const once = yield* envelope(
          { key: setup.devKey, session: sessionIds[1] },
          { _tag: "Read", path: RemotePath.make("~/nothing") }
        )
        const attempts = [
          yield* envelope({ key: setup.devKey }, run),
          yield* envelope({ key: stranger.privateKey }, run),
          once,
          once
        ]
        yield* Effect.forEach(attempts, setup.deliver, { discard: true })
        const replies = yield* setup.events
        const reasons = replies.map((one) => (one.event._tag === "Denied" ? one.event.reason : one.event._tag))

        assert.deepStrictEqual(reasons, [
          "This machine's policy doesn't let tower shell (~/.config/sth-seat/policy.yaml).",
          "The command isn't signed by tower's key.",
          "~/nothing doesn't exist on this machine.",
          "The command was already run once."
        ])
      })
    )
  )

  it.live("take a message from a machine the policy names: into the inbox, a notification, the clipboard", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const audit = yield* Audit
        const messages = yield* Messages
        const opened = yield* Opened
        yield* setup.policy("messages:\n  from: [tower]\n  clipboard: true\n")
        const body = "Please rerun the staging deploy and tell me how it went."
        yield* envelope({ key: setup.devKey }, { _tag: "Message", text: body }).pipe(Effect.flatMap(setup.deliver))
        const replies = yield* setup.waitForEnd
        const inbox = yield* messages.unread
        const shown = yield* opened.all
        const logged = yield* audit.recent(1)

        assert.deepStrictEqual(
          replies.map((one) => one.event),
          [{ _tag: "Finished", bytes: 56 }]
        )
        assert.deepStrictEqual(
          inbox.map((message) => [message.from, message.text]),
          [[tower, body]]
        )
        assert.deepStrictEqual(shown, [`notify Message from tower: ${body}`, `copy ${body}`])
        assert.deepStrictEqual(
          logged.map((entry) => [entry.action, entry.target, entry.result]),
          [["message", "56 bytes", "delivered"]]
        )
      })
    )
  )

  it.live("refuse a message from a machine the policy doesn't take messages from, even one allowed a shell", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const messages = yield* Messages
        const opened = yield* Opened
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [shell]\nmessages:\n  from: [laptop]\n")
        yield* envelope({ key: setup.devKey }, { _tag: "Message", text: "rm -rf ~" }).pipe(
          Effect.flatMap(setup.deliver)
        )
        const replies = yield* setup.waitForEnd
        const inbox = yield* messages.all
        const shown = yield* opened.all

        assert.deepStrictEqual(
          replies.map((one) => one.event),
          [
            {
              _tag: "Denied",
              reason:
                "This machine's policy doesn't take messages from tower (messages: from in ~/.config/sth-seat/policy.yaml)."
            }
          ]
        )
        assert.deepStrictEqual(inbox, [])
        assert.deepStrictEqual(shown, [])
      })
    )
  )

  it.live("refuse a caller the policy doesn't list, everything while locked, and say why", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const audit = yield* Audit
        const run: Request = { _tag: "Run", command: "true" }
        const unknown = yield* envelope({ key: setup.devKey }, run)
        yield* setup.deliver(unknown)
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [shell]\n")
        yield* audit.setLocked(true)
        yield* envelope({ key: setup.devKey }, run).pipe(Effect.flatMap(setup.deliver))
        yield* setup.policy("allow: [nonsense")
        yield* audit.setLocked(false)
        yield* envelope({ key: setup.devKey }, run).pipe(Effect.flatMap(setup.deliver))
        yield* setup.deliver({ payload: "{", signature: "" })
        const replies = yield* setup.events
        const logged = yield* audit.recent(10)

        assert.deepStrictEqual(
          replies.map((one) => (one.event._tag === "Denied" ? one.event.reason.slice(0, 30) : "")),
          [
            "cube doesn't know tower's key;",
            "This machine is locked; run `s",
            `${setup.folder}/policy.yaml can't be used`.slice(0, 30)
          ]
        )
        assert.strictEqual(logged.at(-1)?.result, "refused: unreadable command")
      })
    )
  )

  it.live("send a file inside the policy's folders, and refuse one outside them or reached through a link", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(`${setup.folder}/shared`)
        yield* fs.writeFileString(`${setup.folder}/shared/notes.txt`, "notes")
        yield* fs.writeFileString(`${setup.folder}/secret.txt`, "secret")
        yield* fs.symlink(`${setup.folder}/secret.txt`, `${setup.folder}/shared/link.txt`)
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [read]\n    folders: [~/shared]\n")
        const read = (path: string, session: number) =>
          envelope(
            { key: setup.devKey, session: sessionIds[session] },
            { _tag: "Read", path: RemotePath.make(path) }
          ).pipe(Effect.flatMap(setup.deliver))
        yield* read("~/shared/notes.txt", 0)
        yield* setup.waitForEnd
        yield* read("~/secret.txt", 1)
        yield* read("~/shared/link.txt", 2)
        const replies = yield* setup.events
        const events = replies.map((one) => one.event)

        assert.strictEqual(text(events.slice(0, 1)), "notes")
        assert.deepStrictEqual(events[1], { _tag: "Finished", bytes: 5 })
        assert.include(events[2]?._tag === "Denied" ? events[2].reason : "", "doesn't let tower read on")
        assert.include(events[3]?._tag === "Denied" ? events[3].reason : "", "secret.txt")
      })
    )
  )

  it.live("write a file from the caller's input, and stop a command when told", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const fs = yield* FileSystem.FileSystem
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [write, shell]\n")
        const target = { key: setup.devKey, session: sessionIds[0] }
        yield* envelope(target, { _tag: "Write", path: RemotePath.make("~/copy.txt") }).pipe(
          Effect.flatMap(setup.deliver)
        )
        yield* envelope(target, { _tag: "Input", bytes: new TextEncoder().encode("copied") }).pipe(
          Effect.flatMap(setup.deliver)
        )
        yield* envelope(target, { _tag: "InputEnd" }).pipe(Effect.flatMap(setup.deliver))
        const written = yield* setup.waitForEnd
        const content = yield* fs.readFileString(`${setup.folder}/copy.txt`)
        const sleeper = { key: setup.devKey, session: sessionIds[1] }
        yield* envelope(sleeper, { _tag: "Run", command: "sleep 30" }).pipe(Effect.flatMap(setup.deliver))
        yield* envelope(sleeper, { _tag: "Run", command: "sleep 30" }).pipe(Effect.flatMap(setup.deliver))
        yield* envelope(sleeper, { _tag: "Cancel" }).pipe(Effect.flatMap(setup.deliver))
        const aborting = { key: setup.devKey, session: sessionIds[2] }
        yield* envelope(aborting, { _tag: "Run", command: "sleep 30" }).pipe(Effect.flatMap(setup.deliver))
        yield* aborted(sessionIds[2] ?? SessionId.make(""))
        const audit = yield* Audit
        const stopped = yield* audit.recent(20).pipe(
          Effect.repeat({
            until: (entries) => entries.filter((entry) => entry.result === "stopped").length >= 2,
            schedule: Schedule.spaced("20 millis")
          }),
          Effect.timeout("5 seconds")
        )
        yield* envelope(sleeper, { _tag: "Share", path: RemotePath.make("~/copy.txt") }).pipe(
          Effect.flatMap(setup.deliver)
        )
        const replies = yield* setup.events

        assert.strictEqual(stopped.filter((entry) => entry.result === "stopped").length, 2)
        assert.deepStrictEqual(written.at(-1)?.event, { _tag: "Finished", bytes: 6 })
        assert.strictEqual(content, "copied")
        assert.deepStrictEqual(
          replies.slice(1).map((one) => (one.event._tag === "Denied" ? one.event.reason : one.event._tag)),
          ["That session is already running.", "Share only travels as a grant with a file to open."]
        )
      })
    )
  )

  it.live("pipe a tunnel to a local port, and refuse a port nothing listens on or a caller without tunnel", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const ports = yield* Ports
        const echo = yield* ports.listen((pipe) => Stream.runForEach(pipe.incoming, pipe.send).pipe(Effect.ignore))
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [tunnel]\n")
        const target = { key: setup.devKey, session: sessionIds[0] }
        yield* envelope(target, { _tag: "Tunnel", port: Port.make(echo) }).pipe(Effect.flatMap(setup.deliver))
        yield* Effect.sleep("100 millis")
        yield* envelope(target, { _tag: "Input", bytes: new TextEncoder().encode("ping") }).pipe(
          Effect.flatMap(setup.deliver)
        )
        const echoed = yield* setup.events.pipe(
          Effect.repeat({
            until: (all) => text(all.map((one) => one.event)) === "ping",
            schedule: Schedule.spaced("20 millis")
          }),
          Effect.timeout("5 seconds")
        )
        yield* envelope(target, { _tag: "InputEnd" }).pipe(Effect.flatMap(setup.deliver))
        const closed = yield* setup.waitForEnd
        yield* envelope({ key: setup.devKey, session: sessionIds[1] }, { _tag: "Tunnel", port: Port.make(1) }).pipe(
          Effect.flatMap(setup.deliver)
        )
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [shell]\n")
        yield* envelope({ key: setup.devKey, session: sessionIds[2] }, { _tag: "Tunnel", port: Port.make(echo) }).pipe(
          Effect.flatMap(setup.deliver)
        )
        const replies = yield* setup.events.pipe(
          Effect.repeat({ until: (all) => all.length >= 4, schedule: Schedule.spaced("20 millis") }),
          Effect.timeout("5 seconds")
        )
        const reasons = replies.flatMap((one) => (one.event._tag === "Denied" ? [one.event.reason] : []))

        assert.strictEqual(text(echoed.map((one) => one.event)), "ping")
        assert.deepStrictEqual(closed.at(-1)?.event, { _tag: "Finished", bytes: 4 })
        assert.deepStrictEqual(reasons, [
          "Nothing answers on port 1 there.",
          "This machine's policy doesn't let tower tunnel (~/.config/sth-seat/policy.yaml)."
        ])
      })
    )
  )

  it.live("refuse to send a folder, and stop a command at the machine's longest run even when asked for more", () =>
    machine(
      Effect.fnUntraced(function* (setup) {
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(`${setup.folder}/shared`)
        yield* setup.policy("allow:\n  - from: [tower]\n    can: [read, shell]\n")
        yield* envelope(
          { key: setup.devKey, session: sessionIds[0] },
          { _tag: "Read", path: RemotePath.make("~/shared") }
        ).pipe(Effect.flatMap(setup.deliver))
        const folder = yield* setup.waitForEnd
        const short = yield* freshSeen.pipe(
          Effect.flatMap((seen) =>
            envelope(
              { key: setup.devKey, session: sessionIds[1] },
              { _tag: "Run", command: "sleep 30", timeoutSeconds: 600 }
            ).pipe(
              Effect.flatMap((sealed) =>
                relayed(sealed, () => Effect.void, seen, { home: setup.folder, maxRun: Duration.millis(300) })
              )
            )
          )
        )
        const audit = yield* Audit
        const ended = yield* audit.recent(10).pipe(
          Effect.repeat({
            until: (entries) => entries.some((entry) => entry.result === "exit 124"),
            schedule: Schedule.spaced("50 millis")
          }),
          Effect.timeout("5 seconds")
        )

        const last = folder.at(-1)?.event

        assert.include(last?._tag === "Denied" ? last.reason : "", "isn't a regular file")
        assert.isUndefined(short)
        assert.isTrue(ended.some((entry) => entry.result === "exit 124"))
      })
    )
  )
})
