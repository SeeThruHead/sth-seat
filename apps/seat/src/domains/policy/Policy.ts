import { Effect, Option, Result, Schema } from "effect"
import { SecretsKept } from "@sth-seat/protocol/Daemon.ts"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { PublicKeyText } from "@sth-seat/protocol/Keys.ts"

export const received = [
  "open-url",
  "open-file",
  "reveal",
  "notify",
  "ask-secret",
  "store-secret",
  "open-tunnelled-page"
] as const
export type Received = (typeof received)[number]

export const Capability = Schema.Literals(["shell", "read", "write", "tunnel", "receive", ...received])
export type Capability = typeof Capability.Type

export const hub = "hub"

const Caller = Schema.Union([MachineName, Schema.Literal(hub), Schema.Literal("*")])

const Rule = Schema.Struct({
  from: Schema.Array(Caller),
  can: Schema.Array(Capability),
  folders: Schema.optionalKey(Schema.Array(Schema.String))
})
export type Rule = typeof Rule.Type

const Messages = Schema.Struct({
  from: Schema.Array(Schema.Union([MachineName, Schema.Literal("*")])),
  clipboard: Schema.optionalKey(Schema.Boolean)
})

export const PolicyFile = Schema.Struct({
  machines: Schema.Record(MachineName, PublicKeyText).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  allow: Schema.Array(Rule).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  secrets: Schema.optionalKey(SecretsKept),
  messages: Schema.optionalKey(Messages)
})
export type PolicyFile = typeof PolicyFile.Type

export const defaultPolicy: PolicyFile = { machines: {}, allow: [{ from: [hub], can: ["receive"] }] }

export type Caller = MachineName | typeof hub

export type Ask = { readonly caller: Caller; readonly capability: Capability; readonly path: Option.Option<string> }

export const expandHome = (path: string, home: string): string => {
  if (path === "~") return home
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`

  return path
}

const trimmed = (folder: string): string => (folder.length > 1 && folder.endsWith("/") ? folder.slice(0, -1) : folder)

const isInside = (path: string, folder: string): boolean => {
  if (folder === "/") return true
  if (path === folder) return true

  return path.startsWith(`${folder}/`)
}

const callerMatches = (rule: Rule, caller: Caller): boolean =>
  rule.from.some((named) => named === caller || (named === "*" && caller !== hub))

const coversPath = (rule: Rule, path: Option.Option<string>, home: string): boolean =>
  Option.match(path, {
    onNone: () => true,
    onSome: (wanted) => (rule.folders ?? ["~"]).some((folder) => isInside(wanted, trimmed(expandHome(folder, home))))
  })

const isReceived = (capability: Capability): boolean => received.some((one) => one === capability)

const grants = (rule: Rule, capability: Capability): boolean => {
  if (rule.can.includes(capability)) return true
  if (!isReceived(capability)) return false

  return rule.can.includes("receive")
}

const allows = (rule: Rule, ask: Ask, home: string): boolean => {
  if (!callerMatches(rule, ask.caller)) return false
  if (!grants(rule, ask.capability)) return false

  return coversPath(rule, ask.path, home)
}

const named = (caller: Caller): string => (caller === hub ? "the hub" : caller)

const doing: Record<Capability, string> = {
  shell: "shell",
  read: "read",
  write: "write",
  tunnel: "tunnel",
  receive: "receive",
  "open-url": "open-url (open a link in the browser)",
  "open-file": "open-file (open a file sent to or kept on this machine)",
  reveal: "reveal (show a file in the file manager)",
  notify: "notify (show a notification)",
  "ask-secret": "ask-secret (prompt for a secret, whose answer leaves this machine)",
  "store-secret": "store-secret (store a secret this machine asked for)",
  "open-tunnelled-page":
    "open-tunnelled-page (open another machine's localhost page through a tunnel, which carries data both ways)"
}

export const decide = (policy: PolicyFile, ask: Ask, home: string): Result.Result<void, string> => {
  if (policy.allow.some((rule) => allows(rule, ask, home))) return Result.succeed(undefined)
  const where = Option.match(ask.path, { onNone: () => "", onSome: (path) => ` on ${path}` })

  return Result.fail(
    `This machine's policy doesn't let ${named(ask.caller)} ${doing[ask.capability]}${where} (~/.config/sth-seat/policy.yaml).`
  )
}

export const hubDelivers = (policy: PolicyFile, home: string): ReadonlyArray<Received> =>
  received.filter((capability) =>
    Result.isSuccess(decide(policy, { caller: hub, capability, path: Option.none() }, home))
  )

const joined = (capabilities: ReadonlyArray<Received>): string =>
  capabilities.length === 0 ? "nothing" : capabilities.join(", ")

export const deliveriesOf = (policy: PolicyFile, home: string): string => {
  const taken = hubDelivers(policy, home)
  const refused = received.filter((capability) => !taken.includes(capability))

  return `the hub may ${joined(taken)}; refused: ${joined(refused)}`
}

export const keepsSecrets = (policy: PolicyFile): boolean => policy.secrets === "here"

export const acceptsMessagesFrom = (policy: PolicyFile, sender: MachineName): boolean =>
  (policy.messages?.from ?? []).some((listed) => listed === sender || listed === "*")

export const copiesMessages = (policy: PolicyFile): boolean => policy.messages?.clipboard === true

export const keyOf = (policy: PolicyFile, machine: MachineName): Option.Option<PublicKeyText> =>
  Option.fromNullishOr(policy.machines[machine])
