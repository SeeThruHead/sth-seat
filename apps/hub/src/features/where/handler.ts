import { DateTime, Effect, Option, Result } from "effect"
import { ActionFailed } from "@sth-seat/protocol/Actions.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { Links } from "../../domains/links/Links.ts"
import { Presence } from "../../domains/presence/Presence.ts"
import { seatFor, whereaboutsOf } from "../../domains/presence/Seat.ts"
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
      side: machine.side,
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

export const seatForCaller = Effect.fn("Where.seatForCaller")(function* (caller: MachineName) {
  const found = yield* sightings
  const seat = seatFor(found, caller)
  if (Result.isFailure(seat)) return yield* new ActionFailed({ message: seat.failure, offline: true })

  return seat.success
})

export const knownMachine = Effect.fn("Where.knownMachine")(function* (name: MachineName) {
  const roster = yield* Roster
  const machine = roster.find(name)
  if (Option.isNone(machine)) return yield* new ActionFailed({ message: `The hub doesn't know ${name}.` })

  return machine.value
})
