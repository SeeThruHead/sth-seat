import { Context, Effect, Schema } from "effect"
import { Headers } from "effect/http"
import { RpcMiddleware } from "effect/rpc"
import { procedure, procedures } from "./Action.ts"
import { askUserSecret, notifyUser, openForUser, whereIsUser } from "./Actions.ts"
import {
  CommandId,
  FileBytes,
  FileName,
  FilePath,
  IdleMillis,
  MachineLabel,
  MachineName,
  SecretName,
  SecretValue,
  Title,
  WebUrl
} from "./Ids.ts"
import { Port, SessionId } from "./Remote.ts"
import { Sealed } from "./Sealed.ts"

const origin = { origin: Schema.optionalKey(MachineName) }

export const OpenUrl = Schema.TaggedStruct("OpenUrl", { id: CommandId, url: WebUrl, ...origin })

export const OpenFile = Schema.TaggedStruct("OpenFile", {
  id: CommandId,
  path: FilePath,
  title: Schema.optionalKey(Title),
  reveal: Schema.optionalKey(Schema.Boolean),
  ...origin
})

export const ReadFile = Schema.TaggedStruct("ReadFile", {
  id: CommandId,
  path: FilePath,
  grant: Schema.optionalKey(Sealed)
})

export const ReceiveFile = Schema.TaggedStruct("ReceiveFile", {
  id: CommandId,
  name: FileName,
  bytes: FileBytes,
  title: Schema.optionalKey(Title),
  reveal: Schema.optionalKey(Schema.Boolean),
  ...origin
})

export const OpenTunnel = Schema.TaggedStruct("OpenTunnel", {
  id: CommandId,
  origin: MachineName,
  scheme: Schema.Literals(["http", "https"]),
  port: Port,
  path: Schema.String.check(Schema.isPattern(/^\//), Schema.isMaxLength(8192))
})

export const Notify = Schema.TaggedStruct("Notify", { id: CommandId, ...notifyUser.request.fields, ...origin })

export const secretsFolder = [".local", "share", "sth-seat", "secrets"] as const

export const SecretsKept = Schema.Literals(["seat", "here"])
export type SecretsKept = typeof SecretsKept.Type

export const storedSecretPath = (name: SecretName): string => ["~", ...secretsFolder, name].join("/")

export const SecretDestination = Schema.Struct({
  machine: MachineLabel,
  file: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096))
})
export type SecretDestination = typeof SecretDestination.Type

export const AskSecret = Schema.TaggedStruct("AskSecret", {
  id: CommandId,
  ...askUserSecret.request.fields,
  destination: Schema.optionalKey(SecretDestination),
  ...origin
})

export const StoreSecret = Schema.TaggedStruct("StoreSecret", { id: CommandId, name: SecretName, value: SecretValue })

export const Relayed = Schema.TaggedStruct("Relayed", { id: CommandId, sealed: Sealed })

export const Abort = Schema.TaggedStruct("Abort", { id: CommandId, session: SessionId })

export const HubCommand = Schema.Union([
  OpenUrl,
  OpenFile,
  ReadFile,
  ReceiveFile,
  OpenTunnel,
  Notify,
  AskSecret,
  StoreSecret,
  Relayed,
  Abort
])
export type HubCommand = typeof HubCommand.Type

export const Done = Schema.TaggedStruct("Done", {})

export const FileRead = Schema.TaggedStruct("FileRead", { name: FileName, bytes: FileBytes })

export const Refused = Schema.TaggedStruct("Refused", { reason: Schema.String })

export const SecretGiven = Schema.TaggedStruct("SecretGiven", { value: SecretValue })

export const Stored = Schema.TaggedStruct("Stored", { path: Schema.String })

export const Outcome = Schema.Union([Done, FileRead, Refused, SecretGiven, Stored])
export type Outcome = typeof Outcome.Type

export class DaemonRefused extends Schema.TaggedError<DaemonRefused, { readonly brand: unique symbol }>()(
  "DaemonRefused",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason
  }
}

export class ConnectedMachine extends Context.Service<ConnectedMachine, { readonly name: MachineName }>()(
  "@sth-seat/protocol/Daemon/ConnectedMachine"
) {}

export class DaemonAuth extends RpcMiddleware.Service<DaemonAuth, { provides: ConnectedMachine }>()(
  "@sth-seat/protocol/Daemon/DaemonAuth",
  { error: DaemonRefused, requiredForClient: true }
) {}

export const daemonAuthClient = <R>(authorization: Effect.Effect<string, never, R>) =>
  RpcMiddleware.layerClient(DaemonAuth, ({ request, next }) =>
    Effect.flatMap(authorization, (value) =>
      next({ ...request, headers: Headers.set(request.headers, "authorization", value) })
    )
  )

export class RelayFailed extends Schema.TaggedError<RelayFailed, { readonly brand: unique symbol }>()("RelayFailed", {
  reason: Schema.String
}) {
  override get message() {
    return this.reason
  }
}

export const Attach = procedure("Attach", {
  payload: Schema.Struct({ version: Schema.String, idle: Schema.optionalKey(IdleMillis) }),
  success: HubCommand,
  stream: true
})

export const Presence = procedure("Presence", { payload: Schema.Struct({ idle: IdleMillis }) })

export const Answer = procedure("Answer", { payload: Schema.Struct({ id: CommandId, outcome: Outcome }) })

export const Relay = procedure("Relay", {
  payload: Schema.Struct({ sealed: Sealed }),
  success: Sealed,
  error: RelayFailed,
  stream: true
})

export const RelayMore = procedure("RelayMore", { payload: Schema.Struct({ sealed: Sealed }), error: RelayFailed })

export const Reply = procedure("Reply", { payload: Schema.Struct({ sealed: Sealed }) })

export const DaemonRpcs = procedures(
  Attach,
  Presence,
  Answer,
  openForUser.procedure,
  whereIsUser.procedure,
  notifyUser.procedure,
  askUserSecret.procedure,
  Relay,
  RelayMore,
  Reply
).middleware(DaemonAuth)

export const daemonPath = "/daemon"
