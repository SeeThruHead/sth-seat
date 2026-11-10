import { Context, DateTime, Effect, HashMap, Layer, Option, Ref } from "effect"
import type { IdleMillis, MachineName } from "@sth-seat/protocol/Ids.ts"

export class Presence extends Context.Service<
  Presence,
  {
    report(name: MachineName, idle: IdleMillis): Effect.Effect<void>
    lastInputOf(name: MachineName): Effect.Effect<Option.Option<DateTime.Utc>>
  }
>()("hub/domains/presence/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const lastInputs = yield* Ref.make(HashMap.empty<MachineName, DateTime.Utc>())

      const report = Effect.fn("Presence.report")(function* (name: MachineName, idle: IdleMillis) {
        yield* Effect.annotateCurrentSpan({ machine: name, "idle.ms": idle })
        const now = yield* DateTime.now
        yield* Ref.update(lastInputs, HashMap.set(name, DateTime.subtract(now, { milliseconds: idle })))
      })

      const lastInputOf = (name: MachineName) => Effect.map(Ref.get(lastInputs), HashMap.get(name))

      return Presence.of({ report, lastInputOf })
    })
  )
}
