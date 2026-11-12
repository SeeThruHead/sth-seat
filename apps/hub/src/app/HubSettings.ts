import { Effect, FileSystem, Schema } from "effect"
import { Hostname, MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import { SecretsKept } from "@sth-seat/protocol/Daemon.ts"
import { PublicKeyText } from "@sth-seat/protocol/Keys.ts"

export const TokenHash = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)).pipe(Schema.brand("TokenHash"))
export type TokenHash = typeof TokenHash.Type

export const defaultSide = "default"

export const Side = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/))

export const MachineSettings = Schema.Struct({
  name: MachineName,
  label: MachineLabel,
  hostnames: Schema.Array(Hostname).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  publicKey: Schema.optionalKey(PublicKeyText),
  secrets: SecretsKept.pipe(Schema.withDecodingDefaultKey(Effect.succeed("seat" as const))),
  side: Side.pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultSide)))
})
export type MachineSettings = typeof MachineSettings.Type

export const HubSettings = Schema.Struct({
  machines: Schema.Array(MachineSettings),
  mcpTokenHash: TokenHash
})
export type HubSettings = typeof HubSettings.Type

export class SettingsInvalid extends Schema.TaggedError<SettingsInvalid, { readonly brand: unique symbol }>()(
  "SettingsInvalid",
  { path: Schema.String, problem: Schema.String }
) {
  override get message() {
    return `The settings file ${this.path} can't be used: ${this.problem}`
  }
}

const parseYaml = (path: string, text: string) =>
  Effect.try({
    try: (): unknown => Bun.YAML.parse(text),
    catch: (error) => new SettingsInvalid({ path, problem: String(error) })
  })

export const readSettings = Effect.fn("HubSettings.readSettings")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((error) => new SettingsInvalid({ path, problem: error.message })))
  const raw = yield* parseYaml(path, text)

  return yield* Schema.decodeUnknownEffect(HubSettings)(raw).pipe(
    Effect.mapError((error) => new SettingsInvalid({ path, problem: error.message }))
  )
})
