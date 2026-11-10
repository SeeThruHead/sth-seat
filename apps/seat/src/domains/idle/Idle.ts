import { DateTime, Duration, Option, Schema } from "effect"
import { IdleMillis } from "@sth-seat/protocol/Ids.ts"

const hidIdleTime = /"HIDIdleTime"\s*=\s*(\d+)/

const decodeIdle = Schema.decodeUnknownOption(IdleMillis)

export const idleFromIoreg = (output: string): Option.Option<IdleMillis> =>
  Option.fromNullishOr(hidIdleTime.exec(output)?.[1]).pipe(
    Option.flatMap((nanoseconds) => decodeIdle(Math.floor(Number(nanoseconds) / 1_000_000)))
  )

export type IdleState =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Active" }
  | { readonly _tag: "IdleSince"; readonly since: DateTime.Utc }

export const unknown: IdleState = { _tag: "Unknown" }

export const watcherThreshold = Duration.seconds(5)

export const afterLine = (state: IdleState, line: string, now: DateTime.Utc): IdleState => {
  if (line.trim() === "idle" && state._tag === "Unknown") return state
  if (line.trim() === "idle")
    return { _tag: "IdleSince", since: DateTime.subtract(now, { milliseconds: Duration.toMillis(watcherThreshold) }) }
  if (line.trim() === "active") return { _tag: "Active" }

  return state
}

const millisSince = (since: DateTime.Utc, now: DateTime.Utc): number =>
  Math.max(0, Math.floor(Duration.toMillis(DateTime.distance(since, now))))

export const idleAt = (state: IdleState, now: DateTime.Utc): Option.Option<IdleMillis> => {
  if (state._tag === "Unknown") return Option.none()
  if (state._tag === "Active") return Option.some(IdleMillis.make(0))

  return Option.some(IdleMillis.make(millisSince(state.since, now)))
}
