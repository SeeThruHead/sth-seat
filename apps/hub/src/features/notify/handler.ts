import { Duration, Effect, Option } from "effect"
import type { Notified, NotifyFromAgent, NotifyRequest } from "@sth-seat/protocol/Actions.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { Title } from "@sth-seat/protocol/Ids.ts"
import { seatOf } from "../../domains/presence/Seat.ts"
import { Roster } from "../../domains/roster/Roster.ts"
import type { Machine } from "../../domains/roster/Roster.ts"
import { done, unknownHostname } from "../dispatch/dispatch.ts"
import { seatForCaller, sightings } from "../where/handler.ts"

export const notify = Effect.fn("Notify.notify")(function* (request: NotifyRequest, from: Machine) {
  const seat = yield* seatForCaller(from.name)
  yield* Effect.annotateCurrentSpan({ seat: seat.name, caller: from.name })
  yield* done(seat, { _tag: "Notify", title: request.title, message: request.message, origin: from.name }, "15 seconds")
  const notified: Notified = {
    machine: seat.name,
    label: seat.label,
    message: `Showed "${request.title}" on ${seat.label}.`
  }

  return notified
})

export const notifyFromAgent = Effect.fn("Notify.notifyFromAgent")(function* (request: NotifyFromAgent) {
  const roster = yield* Roster
  const origin = roster.byHostname(request.from)
  if (Option.isNone(origin)) return yield* unknownHostname(request.from, roster.machines)

  return yield* notify({ title: request.title, message: request.message }, origin.value)
})

export const lostGrace = Duration.minutes(2)

const lostTitle = Title.make("sth-seat")

export const linkLost = Effect.fn("Notify.linkLost")(function* (name: MachineName) {
  yield* Effect.sleep(lostGrace)
  const roster = yield* Roster
  const machine = roster.find(name)
  if (Option.isNone(machine)) return
  const found = yield* sightings
  if (found.some((sighting) => sighting.name === name && sighting.online)) return
  const others = found.filter((sighting) => sighting.side === machine.value.side && sighting.name !== name)
  const seat = seatOf(others)
  if (Option.isNone(seat)) return
  const message = `${machine.value.label} lost its link to the hub ${Duration.format(lostGrace)} ago and hasn't come back, so nothing opens or shows there. Run \`sth-seat doctor\` on it.`

  yield* done(seat.value, { _tag: "Notify", title: lostTitle, message, origin: name }, "15 seconds").pipe(
    Effect.catchTag("ActionFailed", (error) => Effect.logWarning("couldn't say a link was lost", error.message))
  )
})
