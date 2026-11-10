import { Effect, Schema } from "effect"
import { KeyFormat, Signature } from "effect/crypto"

export const PublicKeyText = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)).pipe(
  Schema.brand("PublicKeyText")
)
export type PublicKeyText = typeof PublicKeyText.Type

export type MachinePublicKey = Signature.PublicKey<Signature.Ed25519>

export type MachinePrivateKey = Signature.PrivateKey<Signature.Ed25519>

export class KeyInvalid extends Schema.TaggedError<KeyInvalid, { readonly brand: unique symbol }>()("KeyInvalid", {
  problem: Schema.String
}) {
  override get message() {
    return `This machine key can't be used: ${this.problem}`
  }
}

const invalid = (error: { readonly message: string }) => new KeyInvalid({ problem: error.message })

export const publicKeyOf = (text: PublicKeyText): Effect.Effect<MachinePublicKey, KeyInvalid> =>
  KeyFormat.decodePublic(KeyFormat.jwk, Signature.ed25519, { kty: "OKP", crv: "Ed25519", x: text }).pipe(
    Effect.mapError(invalid)
  )

export const textOf = (key: MachinePublicKey): Effect.Effect<PublicKeyText, KeyInvalid> =>
  KeyFormat.encode(KeyFormat.jwk, key).pipe(
    Effect.mapError(invalid),
    Effect.flatMap((jwk) => Schema.decodeUnknownEffect(PublicKeyText)(jwk.x).pipe(Effect.mapError(invalid)))
  )

export const privateKeyFromPem = (pem: string): Effect.Effect<MachinePrivateKey, KeyInvalid> =>
  KeyFormat.decodePrivate(KeyFormat.pem(KeyFormat.pkcs8), Signature.ed25519, pem).pipe(Effect.mapError(invalid))

export const pemOf = (key: MachinePrivateKey): Effect.Effect<string, KeyInvalid> =>
  KeyFormat.encode(KeyFormat.pem(KeyFormat.pkcs8), key).pipe(Effect.mapError(invalid))

export const newKeyPair = Signature.Signature.use((signature) => signature.generateKeyPair(Signature.ed25519)).pipe(
  Effect.mapError(invalid)
)

export const publicKeyFrom = (key: MachinePrivateKey) =>
  Signature.Signature.use((signature) => signature.publicKeyOf(key)).pipe(Effect.mapError(invalid))
