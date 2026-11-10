import { Effect, Result, Schema } from "effect"
import { Signature } from "effect/crypto"
import { Base64Url } from "effect/encoding"
import type { MachinePrivateKey, MachinePublicKey } from "./Keys.ts"

export const Sealed = Schema.Struct({ payload: Schema.String, signature: Schema.String })
export type Sealed = typeof Sealed.Type

export type Purpose = "hello" | "command" | "reply"

export class SealBroken extends Schema.TaggedError<SealBroken, { readonly brand: unique symbol }>()("SealBroken", {
  reason: Schema.String
}) {
  override get message() {
    return this.reason
  }
}

const signedBytes = (purpose: Purpose, payload: string): Uint8Array =>
  new TextEncoder().encode(`sth-seat/${purpose}\n${payload}`)

export const seal = Effect.fnUntraced(function* <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  key: MachinePrivateKey,
  purpose: Purpose,
  value: S["Type"]
) {
  const signer = yield* Signature.Signature
  const payload = yield* Schema.encodeEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.mapError((error) => new SealBroken({ reason: `can't encode the ${purpose}: ${error.message}` }))
  )
  const signature = yield* signer.sign(key, signedBytes(purpose, payload)).pipe(Effect.orDie)
  const sealed: Sealed = { payload, signature: Base64Url.encode(signature) }

  return sealed
})

const isSignedBy = Effect.fnUntraced(function* (key: MachinePublicKey, purpose: Purpose, sealed: Sealed) {
  const signer = yield* Signature.Signature
  const signature = Base64Url.decode(sealed.signature)
  if (Result.isFailure(signature)) return false

  return yield* signer
    .verify(key, signature.success, signedBytes(purpose, sealed.payload))
    .pipe(Effect.orElseSucceed(() => false))
})

export const peek = <S extends Schema.Codec<unknown, unknown>>(schema: S, purpose: Purpose, sealed: Sealed) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(sealed.payload).pipe(
    Effect.mapError((error) => new SealBroken({ reason: `the ${purpose} doesn't read: ${error.message}` }))
  )

export const unseal = Effect.fnUntraced(function* <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  key: MachinePublicKey,
  purpose: Purpose,
  sealed: Sealed
) {
  const signed = yield* isSignedBy(key, purpose, sealed)
  if (!signed) return yield* new SealBroken({ reason: `the ${purpose}'s signature doesn't match the sender's key` })

  return yield* peek(schema, purpose, sealed)
})
