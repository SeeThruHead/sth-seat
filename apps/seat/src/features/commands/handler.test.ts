import { BunCrypto, BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Exit, FileSystem, Layer, Redacted } from "effect"
import type { SecureRandom, Signature } from "effect/crypto"
import {
  CommandId,
  FileName,
  FilePath,
  MachineLabel,
  MachineName,
  SecretName,
  Title,
  WebUrl
} from "@sth-seat/protocol/Ids.ts"
import { Envelope, EnvelopeId, Port, RemotePath, SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Request } from "@sth-seat/protocol/Remote.ts"
import { seal } from "@sth-seat/protocol/Sealed.ts"
import type { Outcome } from "@sth-seat/protocol/Daemon.ts"
import { Audit } from "../../domains/audit/Audit.ts"
import { Files } from "../../domains/files/Files.ts"
import { Me } from "../../domains/identity/Me.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import type { Tunnels } from "../../domains/tunnels/Tunnels.ts"
import { Desktop } from "../../platform/Desktop.ts"
import { CommandFailed } from "../../platform/Processes.ts"
import { shareGrant } from "../../app/Remote.ts"
import { Opened, machineIn, recordingDesktop, testMe, tower, writePolicy } from "../../testing/Seat.testing.ts"
import { execute } from "./handler.ts"

const id = CommandId.make("01a1a546-373d-7506-84ae-c8403ccc0cef")

const url = WebUrl.make("https://example.com/")

const home = "/home/user"

const reasonOf = (outcome: Outcome): string => (outcome._tag === "Refused" ? outcome.reason : "")

type Machine =
  | Files
  | Opened
  | FileSystem.FileSystem
  | Desktop
  | Audit
  | Policies
  | Me
  | Tunnels
  | Signature.Signature
  | SecureRandom.SecureRandom

const inMachine = <A, E>(use: (folder: string) => Effect.Effect<A, E, Machine>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* use(folder).pipe(Effect.provide([machineIn(folder), recordingDesktop, testMe()]))
  }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))

const desktopThat = (openUrl: Desktop["Service"]["openUrl"]) =>
  Layer.succeed(
    Desktop,
    Desktop.of({
      openUrl,
      openFile: () => Effect.void,
      revealFile: () => Effect.void,
      notify: () => Effect.void,
      askSecret: () => Effect.fail(new CommandFailed({ command: "zenity", problem: "exit code 1" })),
      copyText: () => Effect.void
    })
  )

const withDesktop = (desktop: Layer.Layer<Desktop>) =>
  Effect.fnUntraced(function* <A, E>(effect: Effect.Effect<A, E, Exclude<Machine, Opened>>) {
    const fs = yield* FileSystem.FileSystem
    const folder = yield* fs.makeTempDirectoryScoped()

    return yield* effect.pipe(Effect.provide([machineIn(folder), desktop, testMe()]))
  })

describe("execute", () => {
  it.effect("lets an interruption through instead of answering it", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        withDesktop(desktopThat(() => Effect.interrupt))(execute({ _tag: "OpenUrl", id, url }, home))
      )

      assert.isTrue(Exit.hasInterrupts(exit))
    }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))
  )

  it.effect("answers with a refusal even when opening crashes, so the hub isn't left waiting", () =>
    Effect.gen(function* () {
      const outcome = yield* withDesktop(desktopThat(() => Effect.die("the opener crashed")))(
        execute({ _tag: "OpenUrl", id, url }, home)
      )

      assert.include(reasonOf(outcome), "the opener crashed")
    }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))
  )

  it.effect("opens URLs and local files on this machine's desktop, and logs each", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const opened = yield* Opened
        const audit = yield* Audit
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${folder}/a.html`, "<p>a</p>")
        const page = yield* execute({ _tag: "OpenUrl", id, url }, home)
        const file = yield* execute(
          { _tag: "OpenFile", id, path: FilePath.make(`${folder}/a.html`), title: Title.make("A") },
          home
        )
        const all = yield* opened.all
        const logged = yield* audit.recent(5)

        assert.deepStrictEqual([page, file], [{ _tag: "Done" }, { _tag: "Done" }])
        assert.deepStrictEqual(all, ["url https://example.com/", `file ${folder}/a.html A`])
        assert.deepStrictEqual(
          logged.map((entry) => [entry.caller, entry.action, entry.result]),
          [
            ["hub", "OpenUrl", "done"],
            ["hub", "OpenFile", "done"]
          ]
        )
      })
    )
  )

  it.effect("shows a notification on this machine's desktop", () =>
    inMachine(
      Effect.fnUntraced(function* () {
        const opened = yield* Opened
        const outcome = yield* execute({ _tag: "Notify", id, title: Title.make("Build"), message: "It passed." }, home)
        const all = yield* opened.all

        assert.deepStrictEqual(outcome, { _tag: "Done" })
        assert.deepStrictEqual(all, ["notify Build: It passed."])
      })
    )
  )

  it.effect("asks for a secret on this desktop, and stores one in a file only this user can read", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const audit = yield* Audit
        const name = SecretName.make("plex-token")
        const opened = yield* Opened
        const destination = { machine: MachineLabel.make("Tower"), file: "~/.local/share/sth-seat/secrets/plex-token" }
        const asked = yield* execute({ _tag: "AskSecret", id, name, question: "Plex token?", destination }, home)
        const stored = yield* execute({ _tag: "StoreSecret", id, name, value: Redacted.make("s3cret") }, home)
        const path = stored._tag === "Stored" ? stored.path : ""
        const content = yield* fs.readFileString(path)
        const info = yield* fs.stat(path)
        const logged = yield* audit.recent(5)
        const prompts = yield* opened.all

        assert.deepStrictEqual(prompts, [
          "ask plex-token: Plex token? (to Tower ~/.local/share/sth-seat/secrets/plex-token)"
        ])
        assert.deepStrictEqual(asked._tag === "SecretGiven" ? Redacted.value(asked.value) : "", "answer for plex-token")
        assert.strictEqual(path, `${folder}/secrets/plex-token`)
        assert.strictEqual(content, "s3cret")
        assert.strictEqual(info.mode & 0o777, 0o600)
        assert.notInclude(logged.map((entry) => `${entry.target} ${entry.result}`).join(" "), "s3cret")
      })
    )
  )

  it.effect("refuses to store a secret the hub carried when this machine keeps its secrets, and writes nothing", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        yield* writePolicy(folder, "secrets: here\nallow:\n  - from: [hub]\n    can: [receive]\n")
        const name = SecretName.make("plex-token")
        const stored = yield* execute({ _tag: "StoreSecret", id, name, value: Redacted.make("s3cret") }, home)
        const written = yield* fs.exists(`${folder}/secrets/plex-token`)

        assert.include(reasonOf(stored), "Secrets asked from this machine stay on it")
        assert.isFalse(written)
      })
    )
  )

  it.effect("takes only the deliveries its policy names, refusing a tunnelled page and secrets", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const opened = yield* Opened
        yield* writePolicy(folder, "allow:\n  - from: [hub]\n    can: [open-file, open-url, reveal, notify]\n")
        const bytes = new TextEncoder().encode("notes")
        const delivered = yield* Effect.forEach(
          [
            { _tag: "OpenUrl", id, url },
            { _tag: "Notify", id, title: Title.make("Build"), message: "It passed." },
            { _tag: "ReceiveFile", id, name: FileName.make("notes.txt"), bytes }
          ] as const,
          (command) => execute(command, home)
        )
        const page = yield* execute(
          {
            _tag: "OpenTunnel",
            id,
            origin: MachineName.make("cube"),
            scheme: "http",
            port: Port.make(6006),
            path: "/"
          },
          home
        )
        const name = SecretName.make("plex-token")
        const asked = yield* execute({ _tag: "AskSecret", id, name, question: "Plex token?" }, home)
        const stored = yield* execute({ _tag: "StoreSecret", id, name, value: Redacted.make("s3cret") }, home)
        const all = yield* opened.all

        assert.deepStrictEqual(
          delivered.map((outcome) => outcome._tag),
          ["Done", "Done", "Done"]
        )
        assert.include(reasonOf(page), "doesn't let the hub open-tunnelled-page (")
        assert.include(reasonOf(asked), "doesn't let the hub ask-secret (")
        assert.include(reasonOf(stored), "doesn't let the hub store-secret (")
        assert.strictEqual(all.length, 3)
      })
    )
  )

  it.effect("takes deliveries only for itself and the machines under deliveries: from", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const opened = yield* Opened
        yield* writePolicy(folder, "allow:\n  - from: [hub]\n    can: [receive, read]\ndeliveries:\n  from: [cube]\n")
        const work = MachineName.make("work")
        const bytes = new TextEncoder().encode("notes")
        const outcomes = yield* Effect.forEach(
          [
            { _tag: "OpenUrl", id, url, origin: MachineName.make("cube") },
            { _tag: "OpenUrl", id, url, origin: tower },
            { _tag: "OpenUrl", id, url, origin: work },
            { _tag: "OpenUrl", id, url },
            { _tag: "Notify", id, title: Title.make("Work"), message: "Secret plans.", origin: work },
            { _tag: "ReceiveFile", id, name: FileName.make("notes.txt"), bytes, origin: work },
            { _tag: "OpenTunnel", id, origin: work, scheme: "http", port: Port.make(6006), path: "/" },
            { _tag: "AskSecret", id, name: SecretName.make("t"), question: "Token?", origin: work }
          ] as const,
          (command) => execute(command, home)
        )
        const all = yield* opened.all

        assert.deepStrictEqual(
          outcomes.map((outcome) => outcome._tag),
          ["Done", "Done", "Refused", "Refused", "Refused", "Refused", "Refused", "Refused"]
        )
        assert.include(reasonOf(outcomes[2] ?? { _tag: "Done" }), "takes nothing the hub delivers for work")
        assert.include(reasonOf(outcomes[3] ?? { _tag: "Done" }), "didn't say which machine this came from")
        assert.deepStrictEqual(all, ["url https://example.com/", "url https://example.com/"])
      })
    )
  )

  it.effect("needs reveal to show a file in the file manager and open-file to open it", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const bytes = new TextEncoder().encode("notes")
        const notes = FileName.make("notes.txt")
        yield* writePolicy(folder, "allow:\n  - from: [hub]\n    can: [open-file]\n")
        const revealed = yield* execute({ _tag: "ReceiveFile", id, name: notes, bytes, reveal: true }, home)
        yield* writePolicy(folder, "allow:\n  - from: [hub]\n    can: [reveal]\n")
        const opened = yield* execute({ _tag: "ReceiveFile", id, name: notes, bytes }, home)
        const shown = yield* execute({ _tag: "ReceiveFile", id, name: notes, bytes, reveal: true }, home)

        assert.include(reasonOf(revealed), "doesn't let the hub reveal (")
        assert.include(reasonOf(opened), "doesn't let the hub open-file (")
        assert.deepStrictEqual(shown, { _tag: "Done" })
      })
    )
  )

  it.effect("opens only documents, never something that could run, and still reveals those", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const opened = yield* Opened
        const bytes = new TextEncoder().encode("#!/bin/sh\nsay hi\n")
        const launchers = ["run.command", "Calculator.webloc", "x.terminal", "x.fileloc", "tool.py", "README"]
        const received = yield* Effect.forEach(launchers, (one) =>
          execute({ _tag: "ReceiveFile", id, name: FileName.make(one), bytes }, home)
        )
        yield* fs.makeDirectory(`${folder}/Evil.app`)
        yield* fs.writeFileString(`${folder}/report.html`, "<p>hi</p>")
        yield* fs.chmod(`${folder}/report.html`, 0o755)
        const bundle = yield* execute({ _tag: "OpenFile", id, path: FilePath.make(`${folder}/Evil.app`) }, home)
        const runnable = yield* execute({ _tag: "OpenFile", id, path: FilePath.make(`${folder}/report.html`) }, home)
        const missing = yield* execute({ _tag: "OpenFile", id, path: FilePath.make(`${folder}/gone.pdf`) }, home)
        const revealed = yield* execute(
          { _tag: "ReceiveFile", id, name: FileName.make("run.command"), bytes, reveal: true },
          home
        )
        const all = yield* opened.all

        assert.deepStrictEqual(
          received.map((outcome) => reasonOf(outcome).includes("isn't a kind of document this machine opens")),
          [true, true, true, true, true, true]
        )
        assert.include(reasonOf(bundle), "is a folder or bundle, so it is only shown in the file manager")
        assert.include(reasonOf(runnable), "is executable")
        assert.include(reasonOf(missing), "can't be read")
        assert.deepStrictEqual(revealed, { _tag: "Done" })
        assert.deepStrictEqual(all, [`reveal ${folder}/inbox/${id}/run.command`])
      })
    )
  )

  it.effect("says the user didn't answer when the prompt is cancelled", () =>
    Effect.gen(function* () {
      const outcome = yield* withDesktop(desktopThat(() => Effect.void))(
        execute({ _tag: "AskSecret", id, name: SecretName.make("x"), question: "?" }, home)
      )

      assert.include(reasonOf(outcome), "The user didn't answer")
    }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))
  )

  it.effect("saves a received file in the inbox and opens it there", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const opened = yield* Opened
        const bytes = new TextEncoder().encode("<h1>report</h1>")
        const outcome = yield* execute({ _tag: "ReceiveFile", id, name: FileName.make("report.html"), bytes }, home)
        const all = yield* opened.all

        assert.deepStrictEqual(outcome, { _tag: "Done" })
        assert.deepStrictEqual(all, [`file ${folder}/inbox/${id}/report.html -`])
      })
    )
  )

  it.effect("saves a received file in the inbox and shows it in the file manager when asked to reveal it", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const opened = yield* Opened
        const bytes = new TextEncoder().encode("installer")
        const name = FileName.make("app.dmg")
        const received = yield* execute({ _tag: "ReceiveFile", id, name, bytes, reveal: true }, home)
        const inPlace = yield* execute(
          { _tag: "OpenFile", id, path: FilePath.make(`${folder}/notes.txt`), reveal: true },
          home
        )
        const all = yield* opened.all

        assert.deepStrictEqual([received, inPlace], [{ _tag: "Done" }, { _tag: "Done" }])
        assert.deepStrictEqual(all, [`reveal ${folder}/inbox/${id}/app.dmg`, `reveal ${folder}/notes.txt`])
      })
    )
  )

  it.effect("reads a file for the hub only where the policy lets it, and says why not", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${folder}/notes.txt`, "notes")
        const notes = FilePath.make(`${folder}/notes.txt`)
        const before = yield* execute({ _tag: "ReadFile", id, path: notes }, home)
        yield* writePolicy(folder, `allow:\n  - from: [hub]\n    can: [receive, read]\n    folders: ["${folder}"]\n`)
        const read = yield* execute({ _tag: "ReadFile", id, path: notes }, home)
        const missing = yield* execute({ _tag: "ReadFile", id, path: FilePath.make(`${folder}/gone.txt`) }, home)

        assert.include(reasonOf(before), "doesn't let the hub read")
        assert.strictEqual(read._tag === "FileRead" ? read.name : "", "notes.txt")
        assert.include(reasonOf(missing), `${folder}/gone.txt can't be read`)
      })
    )
  )

  it.effect("reads a file this machine shared itself, even without a read rule", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        const fs = yield* FileSystem.FileSystem
        const me = yield* Me
        yield* fs.writeFileString(`${folder}/report.html`, "<p>hi</p>")
        const path = FilePath.make(`${folder}/report.html`)
        const identity = { name: me.name, key: me.key }
        const grant = yield* shareGrant(identity, path)
        const other = yield* shareGrant(identity, `${folder}/other.html`)
        const shared = yield* execute({ _tag: "ReadFile", id, path, grant }, home)
        const mismatched = yield* execute({ _tag: "ReadFile", id, path, grant: other }, home)
        const forged = yield* execute({ _tag: "ReadFile", id, path, grant: { ...grant, signature: "" } }, home)

        const sealedBy = (issuedAt: number, from: typeof me.name, request: Request) =>
          seal(Envelope, me.key, "command", {
            id: EnvelopeId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e61"),
            session: SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60"),
            from,
            to: me.name,
            issuedAt,
            request
          })
        const share: Request = { _tag: "Share", path: RemotePath.make(path) }
        const now = yield* DateTime.now
        const stale = yield* sealedBy(DateTime.toEpochMillis(now) - 600_000, me.name, share)
        const otherMachine = yield* sealedBy(DateTime.toEpochMillis(now), MachineName.make("cube"), share)
        const notShare = yield* sealedBy(DateTime.toEpochMillis(now), me.name, {
          _tag: "Read",
          path: RemotePath.make(path)
        })
        const refusals = yield* Effect.forEach([stale, otherMachine, notShare], (one) =>
          execute({ _tag: "ReadFile", id, path, grant: one }, home)
        )

        assert.strictEqual(shared._tag, "FileRead")
        assert.include(reasonOf(mismatched), "doesn't let the hub read")
        assert.include(reasonOf(forged), "doesn't let the hub read")
        assert.deepStrictEqual(
          refusals.map((outcome) => outcome._tag),
          ["Refused", "Refused", "Refused"]
        )
      })
    )
  )

  it.effect("refuses everything while the machine is locked, and says how to unlock", () =>
    inMachine(
      Effect.fnUntraced(function* () {
        const audit = yield* Audit
        yield* audit.setLocked(true)
        const locked = yield* execute({ _tag: "OpenUrl", id, url }, home)
        yield* audit.setLocked(false)
        const unlocked = yield* execute({ _tag: "OpenUrl", id, url }, home)

        assert.include(reasonOf(locked), "sth-seat unlock")
        assert.deepStrictEqual(unlocked, { _tag: "Done" })
      })
    )
  )

  it.effect("refuses everything while the policy file can't be read", () =>
    inMachine(
      Effect.fnUntraced(function* (folder: string) {
        yield* writePolicy(folder, "allow: [nonsense")
        const outcome = yield* execute({ _tag: "OpenUrl", id, url }, home)

        assert.include(reasonOf(outcome), "refuses everything until it is fixed")
      })
    )
  )
})
