import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { PolicyFile, defaultPolicy } from "./Policy.ts"

export class PolicyInvalid extends Schema.TaggedError<PolicyInvalid, { readonly brand: unique symbol }>()(
  "PolicyInvalid",
  { path: Schema.String, problem: Schema.String }
) {
  override get message() {
    return `${this.path} can't be used, so this machine refuses everything until it is fixed: ${this.problem}`
  }
}

const invalidAt = (path: string) => (problem: string) => new PolicyInvalid({ path, problem })

const parseYaml = (path: string, text: string) =>
  Effect.try({
    try: (): unknown => Bun.YAML.parse(text),
    catch: (error) => new PolicyInvalid({ path, problem: String(error) })
  })

export class Policies extends Context.Service<
  Policies,
  { readonly current: Effect.Effect<PolicyFile, PolicyInvalid> }
>()("seat/domains/policy/Policies") {
  static readonly layer = (path: string) =>
    Layer.effect(
      Policies,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        const invalid = invalidAt(path)
        const current = Effect.gen(function* () {
          const present = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false))
          if (!present) return defaultPolicy
          const text = yield* fs.readFileString(path).pipe(Effect.mapError((error) => invalid(error.message)))
          const raw = yield* parseYaml(path, text)

          return yield* Schema.decodeUnknownEffect(PolicyFile)(raw).pipe(
            Effect.mapError((error) => invalid(error.message))
          )
        }).pipe(Effect.withSpan("Policies.current"))

        return Policies.of({ current })
      })
    )
}
