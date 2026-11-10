import { Cause, Context, Effect, Fiber, HashMap, Layer, Option, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { SessionId } from "@sth-seat/protocol/Remote.ts"

type Running = {
  readonly owner: MachineName
  readonly input: Queue.Queue<Uint8Array, Cause.Done>
  readonly fiber: Fiber.Fiber<void>
}

export type Work = (input: Stream.Stream<Uint8Array>) => Effect.Effect<void>

export class Sessions extends Context.Service<
  Sessions,
  {
    start(session: SessionId, owner: MachineName, work: Work): Effect.Effect<boolean>
    feed(session: SessionId, owner: MachineName, bytes: Uint8Array): Effect.Effect<boolean>
    endInput(session: SessionId, owner: MachineName): Effect.Effect<boolean>
    stop(session: SessionId, owner: Option.Option<MachineName>): Effect.Effect<boolean>
  }
>()("seat/domains/sessions/Sessions") {
  static readonly layer: Layer.Layer<Sessions, never, Scope.Scope> = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const running = yield* Ref.make(HashMap.empty<SessionId, Running>())

      const find = (session: SessionId, owner: Option.Option<MachineName>) =>
        Effect.map(Ref.get(running), (all) =>
          Option.filter(HashMap.get(all, session), (entry) =>
            Option.match(owner, { onNone: () => true, onSome: (name) => name === entry.owner })
          )
        )

      const start = Effect.fn("Sessions.start")(function* (session: SessionId, owner: MachineName, work: Work) {
        const all = yield* Ref.get(running)
        if (HashMap.has(all, session)) return false
        const input = yield* Queue.unbounded<Uint8Array, Cause.Done>()
        const fiber = yield* work(Stream.fromQueue(input)).pipe(
          Effect.ensuring(Ref.update(running, HashMap.remove(session))),
          Effect.forkIn(scope, { startImmediately: true })
        )
        yield* Ref.update(running, HashMap.set(session, { owner, input, fiber }))

        return true
      })

      const feed = Effect.fn("Sessions.feed")(function* (session: SessionId, owner: MachineName, bytes: Uint8Array) {
        const found = yield* find(session, Option.some(owner))
        if (Option.isNone(found)) return false

        return yield* Queue.offer(found.value.input, bytes)
      })

      const endInput = Effect.fn("Sessions.endInput")(function* (session: SessionId, owner: MachineName) {
        const found = yield* find(session, Option.some(owner))
        if (Option.isNone(found)) return false

        return yield* Queue.end(found.value.input)
      })

      const stop = Effect.fn("Sessions.stop")(function* (session: SessionId, owner: Option.Option<MachineName>) {
        const found = yield* find(session, owner)
        if (Option.isNone(found)) return false
        yield* Fiber.interrupt(found.value.fiber)

        return true
      })

      return Sessions.of({ start, feed, endInput, stop })
    })
  )
}
