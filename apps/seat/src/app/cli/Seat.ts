import { Duration, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Notified, Opened, SecretStored, Whereabouts } from "@sth-seat/protocol/Actions.ts"
import type { ActionFailed, AskSecretRequest } from "@sth-seat/protocol/Actions.ts"
import { MachineLabel, SecretName, Title } from "@sth-seat/protocol/Ids.ts"
import { Files } from "../../domains/files/Files.ts"
import { localTarget } from "../../domains/files/LocalTarget.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import { keepsSecrets } from "../../domains/policy/Policy.ts"
import { openHere } from "../../features/local/handler.ts"
import { askHere } from "../../features/secrets/handler.ts"
import { platformLayer } from "../../platform/Platform.ts"
import { askDaemon, requireDaemon } from "../LocalClient.ts"
import { machineName } from "../Identity.ts"
import { jsonFlag, report } from "./Output.ts"
import { settings, warnIfUnlinked, withDaemon } from "./Settings.ts"
import type { Settings } from "./Settings.ts"

const promptWait = Duration.minutes(4)

export class OpenedNowhere extends Schema.TaggedError<OpenedNowhere, { readonly brand: unique symbol }>()(
  "OpenedNowhere",
  { reason: Schema.String, problem: Schema.String }
) {
  override get message() {
    return `${this.reason} It wasn't opened on this machine either: ${this.problem}`
  }
}

type Showing = { readonly title: Option.Option<Title>; readonly reveal: boolean }

type Here = Pick<Settings, "identity" | "session" | "handoff" | "home" | "inbox" | "secrets">

const hasDisplay = (found: Here): boolean =>
  process.platform === "darwin" || Option.isSome(found.session.waylandDisplay)

const openedHereFrom = Effect.fnUntraced(function* (found: Here, target: string, showing: Showing, reason: string) {
  if (!hasDisplay(found)) return yield* new OpenedNowhere({ reason, problem: "it has no display." })
  const me = yield* machineName(found.identity)
  const here = yield* openHere(target, showing.title, showing.reveal).pipe(
    Effect.provide([
      platformLayer({ os: process.platform, handoff: found.handoff, home: found.home, ...found.session }),
      Files.layer(found.inbox, found.secrets)
    ]),
    Effect.mapError((error) => new OpenedNowhere({ reason, problem: error.message }))
  )
  const opened: Opened = {
    machine: me,
    label: MachineLabel.make(me),
    kind: here._tag === "Url" ? "url" : "file",
    ...(here._tag === "Url" ? { url: here.url } : {}),
    message: `${reason} Opened it on this machine instead.`
  }

  return opened
})

const openedHereWhenOffline = (found: Here, target: string, showing: Showing) =>
  Effect.fnUntraced(function* (failure: ActionFailed) {
    if (failure.offline !== true) return yield* failure

    return yield* openedHereFrom(found, target, showing, failure.message)
  })

const open = Command.make(
  "open",
  {
    target: Argument.String("target").pipe(
      Argument.withDescription("A URL (http, https, or localhost on this machine) or a file on this machine")
    ),
    title: Flag.String("title").pipe(
      Flag.withSchema(Title),
      Flag.withDescription("For a file: a short description of what it is, shown in Handoff"),
      Flag.optional
    ),
    reveal: Flag.Boolean("reveal").pipe(
      Flag.withDescription(
        "For a file: show it selected in Finder (macOS) or the file manager (Linux) instead of opening it"
      ),
      Flag.withDefault(false)
    ),
    json: jsonFlag
  },
  Effect.fn("Cli.open")(function* ({ target, title, reveal, json }) {
    const found = yield* withDaemon
    const resolved = localTarget(target, process.cwd(), found.home)
    const opened = yield* askDaemon(found, (daemon) =>
      daemon.Open({
        target: resolved,
        ...(Option.isSome(title) ? { title: title.value } : {}),
        ...(reveal ? { reveal } : {})
      })
    ).pipe(Effect.catchTag("ActionFailed", openedHereWhenOffline(found, resolved, { title, reveal })))

    yield* report(Opened, json, opened, opened.message)
  })
).pipe(
  Command.withDescription(
    "Open a URL or a file on the machine the user is sitting at. Use it instead of open, xdg-open or printing a path."
  )
)

const where = Command.make(
  "where",
  { json: jsonFlag },
  Effect.fn("Cli.where")(function* ({ json }) {
    const found = yield* withDaemon
    const whereabouts = yield* askDaemon(found, (daemon) => daemon.Where())

    yield* report(Whereabouts, json, whereabouts, whereabouts.message)
  })
).pipe(
  Command.withDescription("Which machine the user is sitting at, which are connected, and when each was last used")
)

const notify = Command.make(
  "notify",
  {
    message: Argument.String("message").pipe(
      Argument.withDescription("One or two plain sentences: what the user should know or decide")
    ),
    title: Flag.String("title").pipe(
      Flag.withSchema(Title),
      Flag.withDescription("A short heading"),
      Flag.withDefault(Title.make("sth-seat"))
    ),
    json: jsonFlag
  },
  Effect.fn("Cli.notify")(function* ({ message, title, json }) {
    const found = yield* withDaemon
    const notified = yield* askDaemon(found, (daemon) => daemon.Notify({ title, message }))

    yield* report(Notified, json, notified, notified.message)
  })
).pipe(
  Command.withDescription(
    "Show a desktop notification on the machine the user is sitting at, for what they should know soon"
  )
)

const askOnThisMachine = Effect.fnUntraced(function* (found: Settings, request: AskSecretRequest) {
  yield* requireDaemon(found)
  const me = yield* machineName(found.identity)

  return yield* askHere(request, me).pipe(
    Effect.provide([
      platformLayer({ os: process.platform, handoff: found.handoff, home: found.home, ...found.session }),
      Files.layer(found.inbox, found.secrets)
    ])
  )
})

const askOnSeat = Effect.fnUntraced(function* (found: Settings, request: AskSecretRequest) {
  yield* requireDaemon(found)
  yield* warnIfUnlinked(found)

  return yield* askDaemon(found, (daemon) => daemon.AskSecret(request), promptWait)
})

const askSecret = Command.make(
  "ask-secret",
  {
    name: Argument.String("name").pipe(
      Argument.withSchema(SecretName),
      Argument.withDescription("A file name for the secret, such as api-token")
    ),
    question: Argument.String("question").pipe(
      Argument.withDescription("What the user is asked, naming the service and what it's for")
    ),
    json: jsonFlag
  },
  Effect.fn("Cli.askSecret")(function* ({ name, question, json }) {
    const found = yield* settings
    const policy = yield* Policies.use((policies) => policies.current).pipe(
      Effect.provide(Policies.layer(found.policyFile))
    )
    const request = { name, question }
    const stored = keepsSecrets(policy) ? yield* askOnThisMachine(found, request) : yield* askOnSeat(found, request)

    yield* report(SecretStored, json, stored, stored.path)
  })
).pipe(
  Command.withDescription(
    "Ask the user for a secret in a hidden prompt on their seat (on this machine itself when its policy says secrets: here); it lands in a mode-600 file here and only the path is printed"
  )
)

export const seatCommands = [open, where, notify, askSecret] as const
