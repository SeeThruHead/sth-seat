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
import { Envelope, EnvelopeId, RemotePath, SessionId } from "@sth-seat/protocol/Remote.ts"
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
import { Opened, machineIn, recordingDesktop, testMe, writePolicy } from "../../testing/Seat.testing.ts"
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
      askSecret: () => Effect.fail(new CommandFailed({ command: "zenity", problem: "exit code 1" }))
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
