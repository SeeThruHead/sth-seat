import { Effect, Schema } from "effect"
import { SecureRandom } from "effect/crypto"

export const newId = Effect.fnUntraced(function* <S extends Schema.Codec<string, string>>(schema: S) {
  const random = yield* SecureRandom.SecureRandom
  const raw = yield* random.uuidV7()

  return yield* Schema.decodeEffect(schema)(raw).pipe(Effect.orDie)
})

export const MachineName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/)).pipe(
  Schema.brand("MachineName")
)
export type MachineName = typeof MachineName.Type

export const MachineLabel = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(60)).pipe(
  Schema.brand("MachineLabel")
)
export type MachineLabel = typeof MachineLabel.Type

export const Hostname = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/)).pipe(
  Schema.brand("Hostname")
)
export type Hostname = typeof Hostname.Type

export const CommandId = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("CommandId"))
export type CommandId = typeof CommandId.Type

export const WebUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i), Schema.isMaxLength(8192)).pipe(
  Schema.brand("WebUrl")
)
export type WebUrl = typeof WebUrl.Type

export const FilePath = Schema.String.check(Schema.isPattern(/^\/[^\0]*$/), Schema.isMaxLength(4096)).pipe(
  Schema.brand("FilePath")
)
export type FilePath = typeof FilePath.Type

export const FileName = Schema.String.check(Schema.isPattern(/^(?!\.{1,2}$)[^/\\\0]{1,200}$/)).pipe(
  Schema.brand("FileName")
)
export type FileName = typeof FileName.Type

export const Title = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)).pipe(Schema.brand("Title"))
export type Title = typeof Title.Type

export const maxFileBytes = 32 * 1024 * 1024

export const FileBytes = Schema.Uint8Array.check(Schema.isMaxLength(maxFileBytes))
export type FileBytes = typeof FileBytes.Type

export const SecretName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)).pipe(
  Schema.brand("SecretName")
)
export type SecretName = typeof SecretName.Type

export const SecretValue = Schema.Redacted(Schema.String.check(Schema.isMaxLength(4096)))
export type SecretValue = typeof SecretValue.Type

export const IdleMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("IdleMillis"))
export type IdleMillis = typeof IdleMillis.Type
