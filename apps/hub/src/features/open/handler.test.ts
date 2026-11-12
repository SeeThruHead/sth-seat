import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { HubCommand, Outcome } from "@sth-seat/protocol/Daemon.ts"
import { FileName, FilePath, Hostname, MachineLabel, MachineName, Title, WebUrl } from "@sth-seat/protocol/Ids.ts"
import {
  cube,
  desk,
  deskMachine,
  devMachine,
  done,
  fakeDaemon,
  hubServices,
  macMachine,
  sidedServices,
  sitAt,
  tower
} from "../../testing/Hub.testing.ts"
import { knownMachine } from "../where/handler.ts"
import { open, openFromAgent } from "./handler.ts"

const report = FilePath.make("/home/user/tmp/report.html")

const bytes = new TextEncoder().encode("<h1>report</h1>")

const servesReport = (command: HubCommand): Outcome =>
  command._tag === "ReadFile" ? { _tag: "FileRead", name: FileName.make("report.html"), bytes } : done

const tags = (commands: ReadonlyArray<HubCommand>) => commands.map((command) => command._tag)

const failureOf = <A, R>(effect: Effect.Effect<A, { readonly message: string }, R>) =>
  Effect.map(Effect.flip(effect), (error) => error.message)

const originOf = (command: HubCommand | undefined): string | undefined =>
  command !== undefined && "origin" in command ? command.origin : undefined

describe("open", () => {
  it.effect("opens a URL in the browser of the machine the user used last, saying where it came from", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const dev = yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])
      const opened = yield* open({ target: "https://example.com" }, devMachine)

      assert.deepStrictEqual(opened, {
        machine: cube,
        label: MachineLabel.make("Cube"),
        kind: "url",
        url: WebUrl.make("https://example.com/"),
        message: "Opened https://example.com/ in the browser on Cube."
      })
      const macSaw = yield* mac.seen
      const devSaw = yield* dev.seen

      assert.deepStrictEqual(tags(macSaw), ["OpenUrl"])
      assert.strictEqual(originOf(macSaw[0]), tower)
      assert.deepStrictEqual(tags(devSaw), [])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("opens a localhost URL on the seat through a tunnel to the machine its server runs on", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])
      const opened = yield* open({ target: "http://0.0.0.0:6006/?path=/story/button#top" }, devMachine)
      const seen = yield* mac.seen

      assert.include(opened.message, "through a tunnel to Tower")
      assert.deepStrictEqual(
        seen.map((command) =>
          command._tag === "OpenTunnel" ? [command.origin, command.scheme, command.port, command.path] : []
        ),
        [["tower", "http", 6006, "/?path=/story/button#top"]]
      )
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("leaves a localhost URL alone when the user sits at the machine it came from", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(tower)
      yield* sitAt(tower)
      const opened = yield* open({ target: "http://localhost:5173/" }, devMachine)

      assert.strictEqual(opened.url, "http://localhost:5173/")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("refuses a URL too long for a browser", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube)
      yield* fakeDaemon(tower)
      yield* sitAt(cube)
      const long = `http://localhost:6006/?q=${"a".repeat(8200)}`
      const message = yield* failureOf(open({ target: long }, devMachine))

      assert.include(message, "isn't a URL a browser can open")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("copies a file from the machine it is on to the seat, with its title", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const dev = yield* fakeDaemon(tower, servesReport)
      yield* sitAt(cube, [tower])
      const opened = yield* open({ target: report, title: Title.make("Smoke report") }, devMachine)
      const macSaw = yield* mac.seen
      const devSaw = yield* dev.seen
      const received = macSaw[0]

      assert.strictEqual(opened.message, "Opened report.html on Cube.")
      assert.deepStrictEqual(tags(devSaw), ["ReadFile"])
      assert.deepStrictEqual(
        received?._tag === "ReceiveFile" ? [received.name, received.title, received.bytes, received.origin] : [],
        ["report.html", "Smoke report", bytes, tower]
      )
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("asks the seat to reveal a copied file instead of opening it, and says so", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      yield* fakeDaemon(tower, servesReport)
      yield* sitAt(cube, [tower])
      const opened = yield* open({ target: report, reveal: true }, devMachine)
      const macSaw = yield* mac.seen
      const received = macSaw[0]

      assert.strictEqual(opened.message, "Showed report.html in the file manager on Cube.")
      assert.deepStrictEqual(received?._tag === "ReceiveFile" ? [received.name, received.reveal] : [], [
        "report.html",
        true
      ])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("opens a file in place when the user sits at the machine it is on", () =>
    Effect.gen(function* () {
      const dev = yield* fakeDaemon(tower)
      yield* sitAt(tower)
      const opened = yield* open({ target: `file://${report}` }, devMachine)
      const seen = yield* dev.seen

      assert.strictEqual(opened.kind, "file")
      assert.deepStrictEqual(
        seen.map((command) => command._tag === "OpenFile" && [command.path, command.origin]),
        [[report, tower]]
      )
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("passes on why a machine refused", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube, () => ({ _tag: "Refused", reason: "xdg-open failed: exit code 4" }))
      const message = yield* failureOf(open({ target: "https://example.com" }, macMachine))

      assert.strictEqual(message, "Cube couldn't do it: xdg-open failed: exit code 4")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("opens nothing on another machine when the caller's own daemon isn't connected", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      yield* sitAt(cube, [tower])
      const error = yield* Effect.flip(open({ target: "https://example.com" }, devMachine))
      const file = yield* failureOf(open({ target: report }, devMachine))
      const seen = yield* mac.seen

      assert.include(error.message, "Tower isn't connected to the hub")
      assert.include(error.message, "opens nothing on another machine")
      assert.strictEqual(error.offline, true)
      assert.include(file, "Tower isn't connected to the hub")
      assert.deepStrictEqual(tags(seen), [])
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("keeps to the caller's side, whichever machine was used last", () =>
    Effect.gen(function* () {
      const mac = yield* fakeDaemon(cube)
      const work = yield* fakeDaemon(desk)
      yield* fakeDaemon(tower)
      yield* sitAt(cube, [desk, tower])
      const fromWork = yield* open({ target: "https://example.com/work" }, deskMachine)
      yield* sitAt(desk, [cube, tower])
      const fromHome = yield* open({ target: "https://example.com/home" }, devMachine)
      const macSaw = yield* mac.seen
      const workSaw = yield* work.seen

      assert.deepStrictEqual([fromWork.machine, fromHome.machine], [desk, cube])
      assert.deepStrictEqual(
        workSaw.map((command): ReadonlyArray<string | undefined> =>
          command._tag === "OpenUrl" ? [command.url, command.origin] : []
        ),
        [["https://example.com/work", desk]]
      )
      assert.deepStrictEqual(
        macSaw.map((command): ReadonlyArray<string | undefined> =>
          command._tag === "OpenUrl" ? [command.url, command.origin] : []
        ),
        [["https://example.com/home", tower]]
      )
    }).pipe(Effect.scoped, Effect.provide(sidedServices))
  )

  it.effect("rejects answers that don't fit the command", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube, () => ({ _tag: "FileRead", name: FileName.make("x"), bytes }))
      yield* fakeDaemon(tower)
      yield* sitAt(cube, [tower])

      const forUrl = yield* failureOf(open({ target: "https://example.com" }, macMachine))
      const forFile = yield* failureOf(open({ target: report }, devMachine))

      assert.include(forUrl, "where Done was expected")
      assert.include(forFile, "where FileRead was expected")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("refuses targets it can't open", () =>
    Effect.gen(function* () {
      const unknown = yield* failureOf(open({ target: "notes.txt" }, macMachine))

      assert.include(unknown, "neither a URL")
    }).pipe(Effect.provide(hubServices))
  )
})

describe("openFromAgent", () => {
  it.effect("finds the agent's machine from its hostname", () =>
    Effect.gen(function* () {
      yield* fakeDaemon(cube)
      yield* fakeDaemon(tower)
      yield* sitAt(cube)
      const opened = yield* openFromAgent({ target: "https://localhost/app", from: Hostname.make("Tower") })

      assert.include(opened.message, "from Tower")
    }).pipe(Effect.scoped, Effect.provide(hubServices))
  )

  it.effect("names the machines it knows when the hostname is unknown", () =>
    Effect.gen(function* () {
      const message = yield* failureOf(openFromAgent({ target: report, from: Hostname.make("laptop") }))

      assert.strictEqual(message, "The hub doesn't know a machine called laptop. It knows cube, tower.")
    }).pipe(Effect.provide(hubServices))
  )

  it.effect("refuses a calling machine the hub doesn't know", () =>
    Effect.gen(function* () {
      const message = yield* failureOf(knownMachine(MachineName.make("stranger")))

      assert.strictEqual(message, "The hub doesn't know stranger.")
    }).pipe(Effect.provide(hubServices))
  )
})
