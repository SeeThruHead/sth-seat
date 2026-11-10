import { Context, Duration, Effect, Layer, Option, Redacted } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { SecretDestination } from "@sth-seat/protocol/Daemon.ts"
import type { SecretName, Title, WebUrl } from "@sth-seat/protocol/Ids.ts"
import { focusedFromHyprctl, isPlaying, readyToOpen } from "../domains/focus/Focus.ts"
import { CommandFailed, run } from "./Processes.ts"
import type { Environment } from "./Processes.ts"
import { DesktopSession, nobodyLoggedIn } from "./Session.ts"

const launchTimeout = "15 seconds"

const answerTimeout = "170 seconds"

const focusTimeout = "5 seconds"

const focusedWindow = ["-i", "0", "activewindow", "-j"]

const promptEnvironment: Environment = { HERDR_SECRET_WAIT: "160" }

const promptUnavailable = 3

const promptArgs = (name: SecretName, question: string, to: SecretDestination): ReadonlyArray<string> => [
  "--stdout",
  "--machine",
  to.machine,
  "--file",
  to.file,
  "--",
  name,
  question
]

const fallsBack = (error: CommandFailed): boolean =>
  error.ending === promptUnavailable || error.ending === "didn't start"

const questionFor = (question: string, destination: Option.Option<SecretDestination>): string =>
  Option.match(destination, {
    onNone: () => question,
    onSome: (to) => `${question}\n\nGoes to: ${to.machine}\nFile: ${to.file}`
  })

const notificationScript = [
  "-e",
  "on run argv",
  "-e",
  "display notification (item 2 of argv) with title (item 1 of argv)",
  "-e",
  "end run"
]

const secretScript = [
  "-e",
  "on run argv",
  "-e",
  'text returned of (display dialog (item 1 of argv) default answer "" with hidden answer with title (item 2 of argv))',
  "-e",
  "end run"
]

const detachedOpener = [
  "said=$(mktemp)",
  'setsid "$0" "$1" </dev/null >/dev/null 2>"$said" & opener=$!',
  'for tick in $(seq "$2"); do kill -0 "$opener" 2>/dev/null || { wait "$opener"; code=$?; cat "$said" >&2; rm -f "$said"; exit $code; }; sleep 0.1; done',
  'rm -f "$said"'
].join("; ")

export const openerWindow = Duration.seconds(3)

const ticksIn = (window: Duration.Duration): string => String(Math.max(1, Math.round(Duration.toMillis(window) / 100)))

const detached = (opener: string, target: string, window: Duration.Duration): ReadonlyArray<string> => [
  "-c",
  detachedOpener,
  opener,
  target,
  ticksIn(window)
]

const asOpener = (opener: string, target: string) => (error: CommandFailed) =>
  new CommandFailed({ command: `${opener} ${target}`, problem: error.problem })

const fileUri = (path: string): string =>
  `file://${path.split("/").map(encodeURIComponent).join("/").replaceAll("'", "%27")}`

const showItems = (path: string): ReadonlyArray<string> => [
  "call",
  "--session",
  "--dest",
  "org.freedesktop.FileManager1",
  "--object-path",
  "/org/freedesktop/FileManager1",
  "--method",
  "org.freedesktop.FileManager1.ShowItems",
  `['${fileUri(path)}']`,
  ""
]

const dirnameOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf("/")))

const titleArgs = (title: Option.Option<Title>): ReadonlyArray<string> =>
  Option.match(title, { onNone: () => [], onSome: (found) => ["--title", found] })

const answerIn = (output: string): Redacted.Redacted =>
  Redacted.make(output.endsWith("\n") ? output.slice(0, -1) : output)

type Run = (
  command: string,
  args: ReadonlyArray<string>,
  timeout: Duration.Input
) => Effect.Effect<string, CommandFailed>

const runner = (environment: Effect.Effect<Option.Option<Environment>>) =>
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner): Run =>
    Effect.fnUntraced(function* (command, args, timeout) {
      const found = yield* environment
      if (Option.isNone(found))
        return yield* new CommandFailed({ command: [command, ...args].join(" "), problem: nobodyLoggedIn })

      return yield* run(command, args, timeout, found.value).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
    })
  )

const noExtraEnvironment: Environment = {}

const everywhere = Effect.succeedSome(noExtraEnvironment)

export class Desktop extends Context.Service<
  Desktop,
  {
    openUrl(url: WebUrl): Effect.Effect<void, CommandFailed>
    openFile(path: string, title: Option.Option<Title>): Effect.Effect<void, CommandFailed>
    revealFile(path: string): Effect.Effect<void, CommandFailed>
    notify(title: Title, message: string): Effect.Effect<void, CommandFailed>
    askSecret(
      name: SecretName,
      question: string,
      destination: Option.Option<SecretDestination>
    ): Effect.Effect<Redacted.Redacted, CommandFailed>
  }
>()("seat/platform/Desktop") {
  static readonly darwin = (commands: {
    readonly open: string
    readonly handoff: string
    readonly osascript: string
    readonly secretPrompt: string
  }) =>
    Layer.effect(
      Desktop,
      Effect.gen(function* () {
        const launch = yield* runner(everywhere)
        const prompt = yield* runner(Effect.succeedSome(promptEnvironment))

        const askInDialog = (name: SecretName, question: string, destination: Option.Option<SecretDestination>) =>
          launch(
            commands.osascript,
            [...secretScript, questionFor(question, destination), `sth-seat: ${name}`],
            answerTimeout
          )

        return Desktop.of({
          openUrl: (url) =>
            launch(commands.open, [url], launchTimeout).pipe(Effect.asVoid, Effect.withSpan("Desktop.openUrl")),

          openFile: (path, title) =>
            launch(commands.handoff, [path, ...titleArgs(title)], launchTimeout).pipe(
              Effect.asVoid,
              Effect.withSpan("Desktop.openFile")
            ),

          revealFile: (path) =>
            launch(commands.open, ["-R", path], launchTimeout).pipe(
              Effect.andThen(launch(commands.open, ["-a", "Finder"], launchTimeout)),
              Effect.asVoid,
              Effect.withSpan("Desktop.revealFile")
            ),

          notify: (title, message) =>
            launch(commands.osascript, [...notificationScript, title, message], launchTimeout).pipe(
              Effect.asVoid,
              Effect.withSpan("Desktop.notify")
            ),

          askSecret: (name, question, destination) =>
            Option.match(destination, {
              onNone: () => askInDialog(name, question, destination),
              onSome: (to) =>
                prompt(commands.secretPrompt, promptArgs(name, question, to), answerTimeout).pipe(
                  Effect.catchIf(fallsBack, () => askInDialog(name, question, destination))
                )
            }).pipe(Effect.map(answerIn), Effect.withSpan("Desktop.askSecret"))
        })
      })
    )

  static readonly linux = (commands: {
    readonly open: string
    readonly notifySend: string
    readonly zenity: string
    readonly gdbus: string
    readonly hyprctl: string
    readonly shell: string
    readonly openerWindow: Duration.Duration
  }) =>
    Layer.effect(
      Desktop,
      Effect.gen(function* () {
        const session = yield* DesktopSession
        const launch = yield* runner(session.environment)

        const opened = (target: string) =>
          launch(commands.shell, detached(commands.open, target, commands.openerWindow), launchTimeout).pipe(
            Effect.mapError(asOpener(commands.open, target)),
            Effect.asVoid
          )

        const notified = (title: string, message: string) =>
          launch(commands.notifySend, ["--app-name=sth-seat", "--", title, message], launchTimeout).pipe(Effect.asVoid)

        const playing = launch(commands.hyprctl, focusedWindow, focusTimeout).pipe(
          Effect.map((output) => Option.exists(focusedFromHyprctl(output), isPlaying)),
          Effect.orElseSucceed(() => false)
        )

        const unlessPlaying = (target: string, show: Effect.Effect<void, CommandFailed>) =>
          Effect.flatMap(playing, (busy) => (busy ? notified("sth-seat", readyToOpen(target)) : show))

        return Desktop.of({
          openUrl: (url) => unlessPlaying(url, opened(url)).pipe(Effect.withSpan("Desktop.openUrl")),

          openFile: (path) => unlessPlaying(path, opened(path)).pipe(Effect.withSpan("Desktop.openFile")),

          revealFile: (path) =>
            unlessPlaying(
              path,
              launch(commands.gdbus, showItems(path), launchTimeout).pipe(
                Effect.catch(() => opened(dirnameOf(path))),
                Effect.asVoid
              )
            ).pipe(Effect.withSpan("Desktop.revealFile")),

          notify: (title, message) => notified(title, message).pipe(Effect.withSpan("Desktop.notify")),

          askSecret: (name, question, destination) =>
            launch(
              commands.zenity,
              ["--entry", "--hide-text", `--title=sth-seat: ${name}`, `--text=${questionFor(question, destination)}`],
              answerTimeout
            ).pipe(Effect.map(answerIn), Effect.withSpan("Desktop.askSecret"))
        })
      })
    )
}
