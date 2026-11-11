import { Schema } from "effect"
import { MachineName } from "./Ids.ts"

export const SessionId = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

export const EnvelopeId = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("EnvelopeId"))
export type EnvelopeId = typeof EnvelopeId.Type

export const RemotePath = Schema.String.check(Schema.isPattern(/^(\/|~\/|~$)[^\0]*$/), Schema.isMaxLength(4096)).pipe(
  Schema.brand("RemotePath")
)
export type RemotePath = typeof RemotePath.Type

export const maxChunkBytes = 512 * 1024

export const chunksOf = (bytes: Uint8Array): ReadonlyArray<Uint8Array> =>
  Array.from({ length: Math.max(1, Math.ceil(bytes.length / maxChunkBytes)) }, (_, index) =>
    bytes.subarray(index * maxChunkBytes, (index + 1) * maxChunkBytes)
  )

const Chunk = Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(maxChunkBytes))

export const Run = Schema.TaggedStruct("Run", {
  command: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(65_536)),
  cwd: Schema.optionalKey(RemotePath),
  timeoutSeconds: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 86_400 })))
})

export const Read = Schema.TaggedStruct("Read", { path: RemotePath })

export const Write = Schema.TaggedStruct("Write", { path: RemotePath })

export const Share = Schema.TaggedStruct("Share", { path: RemotePath })

export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })).pipe(Schema.brand("Port"))
export type Port = typeof Port.Type

export const Tunnel = Schema.TaggedStruct("Tunnel", { port: Port })

export const Input = Schema.TaggedStruct("Input", { bytes: Chunk })

export const InputEnd = Schema.TaggedStruct("InputEnd", {})

export const Cancel = Schema.TaggedStruct("Cancel", {})

export const maxMessageLength = 65_536

export const MessageText = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maxMessageLength))
export type MessageText = typeof MessageText.Type

export const Message = Schema.TaggedStruct("Message", { text: MessageText })

export const Request = Schema.Union([Run, Read, Write, Share, Tunnel, Input, InputEnd, Cancel, Message])
export type Request = typeof Request.Type

export const Envelope = Schema.Struct({
  id: EnvelopeId,
  session: SessionId,
  from: MachineName,
  to: MachineName,
  issuedAt: Schema.Int,
  request: Request
})
export type Envelope = typeof Envelope.Type

export const Output = Schema.TaggedStruct("Output", {
  channel: Schema.Literals(["stdout", "stderr"]),
  bytes: Chunk
})

export const Started = Schema.TaggedStruct("Started", {})

export const Exited = Schema.TaggedStruct("Exited", { code: Schema.Int })

export const Finished = Schema.TaggedStruct("Finished", { bytes: Schema.Int })

export const Denied = Schema.TaggedStruct("Denied", { reason: Schema.String })

export const Event = Schema.Union([Started, Output, Exited, Finished, Denied])
export type Event = typeof Event.Type

export const isLast = (event: Event): boolean => event._tag !== "Output" && event._tag !== "Started"

export const Reply = Schema.Struct({
  session: SessionId,
  seq: Schema.Int,
  from: MachineName,
  to: MachineName,
  issuedAt: Schema.Int,
  event: Event
})
export type Reply = typeof Reply.Type
