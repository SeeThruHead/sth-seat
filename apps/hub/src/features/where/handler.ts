import { DateTime, Effect } from "effect"
import { Links } from "../../domains/links/Links.ts"
import { Presence } from "../../domains/presence/Presence.ts"
import { whereaboutsOf } from "../../domains/presence/Seat.ts"
import type { Sighting } from "../../domains/presence/Seat.ts"
import { Roster } from "../../domains/roster/Roster.ts"

export const sightings = Effect.gen(function* () {
  const roster = yield* Roster
  const links = yield* Links
  const presence = yield* Presence
  const online = yield* links.online

  return yield* Effect.forEach(roster.machines, (machine) =>
    Effect.map(presence.lastInputOf(machine.name), (lastInput): Sighting => ({
      name: machine.name,
      label: machine.label,
      online: online.includes(machine.name),
      lastInput
    }))
  )
}).pipe(Effect.withSpan("Where.sightings"))

export const where = Effect.gen(function* () {
  const found = yield* sightings
  const now = yield* DateTime.now

  return whereaboutsOf(found, now)
}).pipe(Effect.withSpan("Where.where"))
