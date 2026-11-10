import { Effect, HashMap, Layer, Option, Ref, Scope, Stream } from "effect"
import type { SecureRandom, Signature } from "effect/crypto"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { Policies } from "../domains/policy/Policies.ts"
import type { Port } from "@sth-seat/protocol/Remote.ts"
import { TunnelFailed, Tunnels } from "../domains/tunnels/Tunnels.ts"
import { Ports } from "../platform/Ports.ts"
import type { Pipe } from "../platform/Ports.ts"
import type { HubClient } from "./Hub.ts"
import type { Identity } from "./Identity.ts"
import { linkTo, outcomeOf, sendInput, start, whenStarted } from "./Remote.ts"

export const tunnelsLayer = (hub: HubClient, me: Identity) =>
  Layer.effect(
    Tunnels,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const ports = yield* Ports
      const context = yield* Effect.context<Policies | SecureRandom.SecureRandom | Signature.Signature>()
      const open = yield* Ref.make(HashMap.empty<string, number>())

      const serve = (origin: MachineName, port: Port) => (pipe: Pipe) =>
        Effect.gen(function* () {
          const link = yield* linkTo(hub, me, origin)
          const feed = whenStarted(sendInput(link, pipe.incoming))

          yield* start(link, { _tag: "Tunnel", port }).pipe(
            Stream.runForEach((event) =>
              feed(event).pipe(
                Effect.andThen(event._tag === "Output" ? Effect.orDie(pipe.send(event.bytes)) : Effect.void),
                Effect.andThen(outcomeOf(event))
              )
            )
          )
        }).pipe(
          Effect.scoped,
          Effect.provideContext(context),
          Effect.catchCause((cause) => Effect.logInfo("a tunnel connection ended", { origin, port, cause }))
        )

      const localPortFor = Effect.fn("Tunnels.localPortFor")(function* (origin: MachineName, port: Port) {
        const key = `${origin}:${port}`
        const current = yield* Ref.get(open)
        const known = HashMap.get(current, key)
        if (Option.isSome(known)) return known.value
        const local = yield* ports.listen(serve(origin, port)).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError((error) => new TunnelFailed({ problem: error.message }))
        )
        yield* Ref.update(open, HashMap.set(key, local))

        return local
      })

      return Tunnels.of({ localPortFor })
    })
  )
