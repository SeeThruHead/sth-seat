import { DateTime, Effect, Result, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { Base64Url } from "effect/encoding"
import { MachineName } from "./Ids.ts"
import type { MachinePrivateKey } from "./Keys.ts"
import { Sealed, SealBroken, seal } from "./Sealed.ts"

export const Hello = Schema.Struct({
  machine: MachineName,
  issuedAt: Schema.Int,
  nonce: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22}$/))
})
export type Hello = typeof Hello.Type

const scheme = "Sth-Seat "

const SealedJson = Schema.fromJsonString(Sealed)

export const helloHeader = Effect.fnUntraced(function* (machine: MachineName, key: MachinePrivateKey) {
  const random = yield* SecureRandom.SecureRandom
  const now = yield* DateTime.now
  const nonceBytes = yield* random.randomBytes(16)
  const nonce = Base64Url.encode(nonceBytes)
  const sealed = yield* seal(Hello, key, "hello", { machine, issuedAt: DateTime.toEpochMillis(now), nonce })
  const text = yield* Schema.encodeEffect(SealedJson)(sealed).pipe(Effect.orDie)

  return `${scheme}${Base64Url.encode(text)}`
})

const broken = new SealBroken({ reason: "the hello isn't a signed sth-seat hello" })

export const sealedHello = Effect.fnUntraced(function* (header: string) {
  if (!header.startsWith(scheme)) return yield* broken
  const bytes = Base64Url.decode(header.slice(scheme.length).trim())
  if (Result.isFailure(bytes)) return yield* broken

  return yield* Schema.decodeEffect(SealedJson)(new TextDecoder().decode(bytes.success)).pipe(
    Effect.mapError(() => broken)
  )
})
