import { Effect } from "effect"
export const doubled = Effect.fnUntraced(function* (xs: ReadonlyArray<number>) {
  if (xs.length === 0) return []
  const factor = yield* Effect.succeed(2)
  return xs.map((x) => x * factor).toSorted((a, b) => a - b)
})
export const tag = { _tag: "Clean" } as const
