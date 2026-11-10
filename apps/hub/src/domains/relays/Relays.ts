import { Cause, Context, Effect, HashMap, Layer, Option, Queue, Ref, Stream } from "effect"
import { RelayFailed } from "@sth-seat/protocol/Daemon.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"

type Session = {
  readonly owner: MachineName
  readonly target: MachineName
  readonly replies: Queue.Queue<Sealed, RelayFailed | Cause.Done>
}

export type Route = { readonly session: SessionId; readonly owner: MachineName; readonly target: MachineName }

export class Relays extends Context.Service<
  Relays,
  {
    open(route: Route): Effect.Effect<Stream.Stream<Sealed, RelayFailed>, RelayFailed>
    isOpen(route: Route): Effect.Effect<boolean>
    deliver(session: SessionId, from: MachineName, sealed: Sealed, last: boolean): Effect.Effect<void>
    close(session: SessionId): Effect.Effect<boolean>
    machineLeft(target: MachineName): Effect.Effect<void>
  }
>()("hub/domains/relays/Relays") {
  static readonly layer = Layer.effect(
    Relays,
    Effect.gen(function* () {
      const sessions = yield* Ref.make(HashMap.empty<SessionId, Session>())

      const open = Effect.fn("Relays.open")(function* (route: Route) {
        const current = yield* Ref.get(sessions)
        if (HashMap.has(current, route.session))
          return yield* new RelayFailed({ reason: "That session is already running." })
        const replies = yield* Queue.unbounded<Sealed, RelayFailed | Cause.Done>()
        const session: Session = { owner: route.owner, target: route.target, replies }
        yield* Ref.update(sessions, HashMap.set(route.session, session))

        return Stream.fromQueue(replies)
      })

      const isOpen = (route: Route) =>
        Effect.map(Ref.get(sessions), (current) =>
          Option.exists(
            HashMap.get(current, route.session),
            (found) => found.owner === route.owner && found.target === route.target
          )
        )

      const deliver = Effect.fn("Relays.deliver")(function* (
        session: SessionId,
        from: MachineName,
        sealed: Sealed,
        last: boolean
      ) {
        const current = yield* Ref.get(sessions)
        const found = Option.filter(HashMap.get(current, session), (entry) => entry.target === from)
        if (Option.isNone(found)) return
        yield* Queue.offer(found.value.replies, sealed)
        if (!last) return
        yield* Ref.update(sessions, HashMap.remove(session))
        yield* Queue.end(found.value.replies)
      })

      const close = (session: SessionId) =>
        Ref.modify(sessions, (current) => [HashMap.has(current, session), HashMap.remove(current, session)])

      const machineLeft = Effect.fn("Relays.machineLeft")(function* (target: MachineName) {
        const gone = yield* Ref.modify(sessions, (current) => [
          HashMap.filter(current, (entry) => entry.target === target),
          HashMap.filter(current, (entry) => entry.target !== target)
        ])

        yield* Effect.forEach(
          HashMap.values(gone),
          (entry) => Queue.fail(entry.replies, new RelayFailed({ reason: `${target} disconnected from the hub.` })),
          { discard: true }
        )
      })

      return Relays.of({ open, isOpen, deliver, close, machineLeft })
    })
  )
}
