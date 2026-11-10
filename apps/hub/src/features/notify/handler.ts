import { Effect, Option } from "effect"
import type { Notified, NotifyRequest } from "@sth-seat/protocol/Actions.ts"
import { nobodyConnected, seatOf } from "../../domains/presence/Seat.ts"
import { done, failed } from "../dispatch/dispatch.ts"
import { sightings } from "../where/handler.ts"

export const notify = Effect.fn("Notify.notify")(function* (request: NotifyRequest) {
  const found = yield* sightings
  const seat = seatOf(found)
  if (Option.isNone(seat)) return yield* failed(nobodyConnected)
  yield* Effect.annotateCurrentSpan({ seat: seat.value.name })
  yield* done(seat.value, { _tag: "Notify", title: request.title, message: request.message }, "15 seconds")
  const notified: Notified = {
    machine: seat.value.name,
    label: seat.value.label,
    message: `Showed "${request.title}" on ${seat.value.label}.`
  }

  return notified
})
