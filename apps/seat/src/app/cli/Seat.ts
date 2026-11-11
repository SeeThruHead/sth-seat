import { Duration, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Notified, Opened, SecretStored, Whereabouts } from "@sth-seat/protocol/Actions.ts"
import type { AskSecretRequest } from "@sth-seat/protocol/Actions.ts"
import { SecretName, Title } from "@sth-seat/protocol/Ids.ts"
import { Files } from "../../domains/files/Files.ts"
import { localTarget } from "../../domains/files/LocalTarget.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import { keepsSecrets } from "../../domains/policy/Policy.ts"
import { askHere } from "../../features/secrets/handler.ts"
import { platformLayer } from "../../platform/Platform.ts"
import { askHub } from "../Hub.ts"
import { requireIdentity } from "../Identity.ts"
import { shareGrant } from "../Remote.ts"
import { jsonFlag, report } from "./Output.ts"
import { hubUrlOf, settings, withHub } from "./Settings.ts"
import type { Settings } from "./Settings.ts"

const promptWait = Duration.minutes(4)

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
    const found = yield* withHub
    const resolved = localTarget(target, process.cwd(), found.home)
    const opened = yield* askHub(
      found,
      Effect.fnUntraced(function* (hub, me) {
        const grant = resolved.startsWith("/") ? yield* Effect.asSome(shareGrant(me, resolved)) : Option.none()

        return yield* hub.Open({
          target: resolved,
          ...(Option.isSome(title) ? { title: title.value } : {}),
          ...(reveal ? { reveal } : {}),
          ...(Option.isSome(grant) ? { grant: grant.value } : {})
        })
      })
    )

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
    const found = yield* withHub
    const whereabouts = yield* askHub(found, (hub) => hub.Where())

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
    const found = yield* withHub
    const notified = yield* askHub(found, (hub) => hub.Notify({ title, message }))

    yield* report(Notified, json, notified, notified.message)
  })
).pipe(
  Command.withDescription(
    "Show a desktop notification on the machine the user is sitting at, for what they should know soon"
  )
)

const askOnThisMachine = Effect.fnUntraced(function* (found: Settings, request: AskSecretRequest) {
  const me = yield* requireIdentity(found.identity)

  return yield* askHere(request, me.name).pipe(
    Effect.provide([
      platformLayer({ os: process.platform, handoff: found.handoff, ...found.session }),
      Files.layer(found.inbox, found.secrets)
    ])
  )
})

const askOnSeat = Effect.fnUntraced(function* (found: Settings, request: AskSecretRequest) {
  const hubUrl = yield* hubUrlOf(found)

  return yield* askHub({ ...found, hubUrl }, (hub) => hub.AskSecret(request), promptWait)
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
