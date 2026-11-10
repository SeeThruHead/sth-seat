import { Result } from "effect"
import type { DateTime } from "effect"
import { firstSighting, isFresh } from "@sth-seat/protocol/Freshness.ts"
import type { Seen } from "@sth-seat/protocol/Freshness.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { Envelope } from "@sth-seat/protocol/Remote.ts"

export type Arrival = { readonly me: MachineName; readonly now: DateTime.Utc; readonly seen: Seen }

export const admit = (envelope: Envelope, arrival: Arrival): Result.Result<Seen, string> => {
  if (envelope.to !== arrival.me) return Result.fail(`The command was meant for ${envelope.to}.`)
  if (!isFresh(envelope.issuedAt, arrival.now))
    return Result.fail("The command is too old or from the future; check the clocks.")
  const [first, seen] = firstSighting(arrival.seen, envelope.id, arrival.now)
  if (!first) return Result.fail("The command was already run once.")

  return Result.succeed(seen)
}

export const unknownCaller = (me: MachineName, caller: MachineName): string =>
  `${me} doesn't know ${caller}'s key; add it under machines in its policy.yaml.`

export const locked = "This machine is locked; run `sth-seat unlock` on it."
