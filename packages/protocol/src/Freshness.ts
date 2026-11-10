import { DateTime, Duration, HashMap } from "effect"

export const freshFor = Duration.seconds(60)

export type Seen = HashMap.HashMap<string, DateTime.Utc>

export const isFresh = (issuedAt: number, now: DateTime.Utc): boolean =>
  Math.abs(DateTime.toEpochMillis(now) - issuedAt) <= Duration.toMillis(freshFor)

export const forget = (seen: Seen, now: DateTime.Utc): Seen =>
  HashMap.filter(
    seen,
    (at) => DateTime.toEpochMillis(now) - DateTime.toEpochMillis(at) <= 2 * Duration.toMillis(freshFor)
  )

export const firstSighting = (seen: Seen, id: string, now: DateTime.Utc): readonly [boolean, Seen] => {
  const kept = forget(seen, now)
  if (HashMap.has(kept, id)) return [false, kept]

  return [true, HashMap.set(kept, id, now)]
}
