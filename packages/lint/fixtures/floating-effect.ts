import { Effect } from "effect"

export const program = Effect.gen(function* () {
  Effect.log("dropped")
  yield* Effect.void
})
