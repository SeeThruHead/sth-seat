import { Effect, Option, Result, Schema } from "effect"
import { SecretsKept } from "@sth-seat/protocol/Daemon.ts"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { PublicKeyText } from "@sth-seat/protocol/Keys.ts"

export const Capability = Schema.Literals(["shell", "read", "write", "tunnel", "receive"])
export type Capability = typeof Capability.Type

export const hub = "hub"

const Caller = Schema.Union([MachineName, Schema.Literal(hub), Schema.Literal("*")])

const Rule = Schema.Struct({
  from: Schema.Array(Caller),
  can: Schema.Array(Capability),
  folders: Schema.optionalKey(Schema.Array(Schema.String))
})
export type Rule = typeof Rule.Type

export const PolicyFile = Schema.Struct({
  machines: Schema.Record(MachineName, PublicKeyText).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  allow: Schema.Array(Rule).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  secrets: Schema.optionalKey(SecretsKept)
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

const allows = (rule: Rule, ask: Ask, home: string): boolean => {
  if (!callerMatches(rule, ask.caller)) return false
  if (!rule.can.includes(ask.capability)) return false

  return coversPath(rule, ask.path, home)
}

const named = (caller: Caller): string => (caller === hub ? "the hub" : caller)

export const decide = (policy: PolicyFile, ask: Ask, home: string): Result.Result<void, string> => {
  if (policy.allow.some((rule) => allows(rule, ask, home))) return Result.succeed(undefined)
  const where = Option.match(ask.path, { onNone: () => "", onSome: (path) => ` on ${path}` })

  return Result.fail(
    `This machine's policy doesn't let ${named(ask.caller)} ${ask.capability}${where} (~/.config/sth-seat/policy.yaml).`
  )
}

export const keepsSecrets = (policy: PolicyFile): boolean => policy.secrets === "here"

export const keyOf = (policy: PolicyFile, machine: MachineName): Option.Option<PublicKeyText> =>
  Option.fromNullishOr(policy.machines[machine])
