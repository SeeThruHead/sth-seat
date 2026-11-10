import { Effect } from "effect"
export const wrapped = (n: number) => Effect.gen(function* () {
  const m = yield* Effect.succeed(n)
  return m + 1
})
