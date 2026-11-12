import { Schema } from "effect"
import { action, actionWithoutInput } from "./Action.ts"
import { Hostname, MachineLabel, MachineName, SecretName, Title, WebUrl } from "./Ids.ts"
import { Sealed } from "./Sealed.ts"

export const Target = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(8192)).annotate({
  description: "What to open: an http(s) URL, a file:// URL, or an absolute path to a file"
})

export const OpenedKind = Schema.Literals(["url", "file"])

export const Opened = Schema.Struct({
  machine: MachineName,
  label: MachineLabel,
  kind: OpenedKind,
  url: Schema.optionalKey(WebUrl),
  message: Schema.String
})
export type Opened = typeof Opened.Type

export const MachinePresence = Schema.Struct({
  name: MachineName,
  label: MachineLabel,
  online: Schema.Boolean,
  seat: Schema.Boolean,
  idleSeconds: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
})
export type MachinePresence = typeof MachinePresence.Type

export const Whereabouts = Schema.Struct({
  seat: Schema.optionalKey(MachineName),
  machines: Schema.Array(MachinePresence),
  message: Schema.String
})
export type Whereabouts = typeof Whereabouts.Type

export class ActionFailed extends Schema.TaggedError<ActionFailed, { readonly brand: unique symbol }>()(
  "ActionFailed",
  {
    message: Schema.String,
    offline: Schema.optionalKey(Schema.Boolean)
  }
) {}

const machineYouRunOn = (why: string) =>
  Hostname.annotate({ description: `The machine you run on (the output of \`hostname\`); ${why}` })

export const openForUser = action({
  tool: "open_for_user",
  rpc: "Open",
  description:
    "Open a URL or a file for the user on the machine they are using right now. A URL opens in that machine's browser; a file is copied there and shown in Handoff (macOS) or opened (Linux), or with `reveal` shown selected in Finder or the file manager. A localhost URL opens through a tunnel to the machine it came from, so a dev server can stay on localhost. Always pass `from`: things open only on a machine on the same side as yours.",
  request: {
    target: Target,
    title: Schema.optionalKey(
      Title.annotate({ description: "A short human title for a file (what it is, for what), shown in Handoff" })
    ),
    reveal: Schema.optionalKey(
      Schema.Boolean.annotate({
        description: "For a file: show it selected in Finder (macOS) or the file manager (Linux) instead of opening it"
      })
    )
  },
  fromAgent: { from: machineYouRunOn("things open only on machines on its side") },
  fromMachine: { grant: Schema.optionalKey(Sealed) },
  success: Opened,
  failure: ActionFailed
})

export type OpenRequest = typeof openForUser.request.Type
export type OpenFromAgent = typeof openForUser.agentRequest.Type
export type OpenFromMachine = typeof openForUser.machineRequest.Type

export const whereIsUser = actionWithoutInput({
  tool: "where_is_user",
  rpc: "Where",
  description:
    "Which of the user's machines they are using right now (the seat), and how long since they last used each one.",
  success: Whereabouts
})

export const Notified = Schema.Struct({ machine: MachineName, label: MachineLabel, message: Schema.String })
export type Notified = typeof Notified.Type

export const notifyUser = action({
  tool: "notify_user",
  rpc: "Notify",
  description:
    "Show the user a desktop notification on the machine they are using right now. Use it for what they should know soon (a long job finished or failed, something needs their decision), never for routine progress.",
  request: {
    title: Title.annotate({ description: "A short heading: what happened, for what" }),
    message: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(500)).annotate({
      description: "One or two plain sentences: what the user should know or decide"
    })
  },
  fromAgent: { from: machineYouRunOn("the notification shows only on a machine on its side") },
  fromMachine: {},
  success: Notified,
  failure: ActionFailed
})

export type NotifyRequest = typeof notifyUser.request.Type
export type NotifyFromAgent = typeof notifyUser.agentRequest.Type

export const SecretStored = Schema.Struct({ machine: MachineName, path: Schema.String, message: Schema.String })
export type SecretStored = typeof SecretStored.Type

export const askUserSecret = action({
  tool: "ask_user_secret",
  rpc: "AskSecret",
  description:
    "Ask the user for a secret (a token, a password) on the machine they are using. They type it into a hidden prompt there; it is written to a mode-600 file on your machine and only the path comes back. Read it from that file where it's needed; never print it or put it in the conversation.",
  request: {
    name: SecretName.annotate({ description: "A file name for the secret, such as api-token" }),
    question: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(300)).annotate({
      description: "What the user is asked, naming the service and what it's for"
    })
  },
  fromAgent: { from: machineYouRunOn("the secret is written there") },
  fromMachine: {},
  success: SecretStored,
  failure: ActionFailed
})

export type AskSecretRequest = typeof askUserSecret.request.Type
export type AskSecretFromAgent = typeof askUserSecret.agentRequest.Type
