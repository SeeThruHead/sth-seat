import { Console, Effect, Schema } from "effect"
import { Flag } from "effect/cli"

export const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON instead of text, for scripts and agents"),
  Flag.withDefault(false)
)

export const report = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  asJson: boolean,
  value: S["Type"],
  text: string
) =>
  asJson
    ? Schema.encodeEffect(Schema.fromJsonString(schema))(value).pipe(Effect.orDie, Effect.flatMap(Console.log))
    : Console.log(text)
