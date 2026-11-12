import { Effect, FiberSet, Stream } from "effect"
import type { Signature } from "effect/crypto"
import { ConnectedMachine, DaemonRpcs } from "@sth-seat/protocol/Daemon.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { Links } from "../domains/links/Links.ts"
import { Presence } from "../domains/presence/Presence.ts"
import { Relays } from "../domains/relays/Relays.ts"
import { Roster } from "../domains/roster/Roster.ts"
import { linkLost, notify } from "../features/notify/handler.ts"
import { open } from "../features/open/handler.ts"
import { relay, relayMore, reply } from "../features/relay/handler.ts"
import { askSecretFromMachine } from "../features/secret/handler.ts"
import { knownMachine, where } from "../features/where/handler.ts"

type HubServices = Roster | Links | Presence | Relays | Signature.Signature

export const DaemonHandlers = DaemonRpcs.toLayer(
  Effect.gen(function* () {
    const links = yield* Links
    const presence = yield* Presence
    const relays = yield* Relays
    const context = yield* Effect.context<HubServices>()
    const watching = yield* FiberSet.make()

    const asCaller = <A, E>(handle: (caller: MachineName) => Effect.Effect<A, E, HubServices>) =>
      ConnectedMachine.use((machine) => handle(machine.name).pipe(Effect.provideContext(context)))

    const left = (caller: MachineName) =>
      relays
        .machineLeft(caller)
        .pipe(Effect.andThen(FiberSet.run(watching, linkLost(caller).pipe(Effect.provideContext(context)))))

    const attach = (caller: MachineName, version: string) =>
      Effect.logInfo("daemon attached", { machine: caller, version }).pipe(
        Effect.as(links.attach(caller).pipe(Stream.ensuring(left(caller))))
      )

    return DaemonRpcs.of({
      Attach: ({ version, idle }) =>
        Stream.unwrap(
          asCaller((caller) =>
            (idle === undefined ? Effect.void : presence.report(caller, idle)).pipe(
              Effect.andThen(attach(caller, version))
            )
          )
        ),

      Presence: ({ idle }) => asCaller((caller) => presence.report(caller, idle)),

      Answer: ({ id, outcome }) => links.answer(id, outcome),

      Open: (request) => asCaller((caller) => Effect.flatMap(knownMachine(caller), (from) => open(request, from))),

      Where: () => where.pipe(Effect.provideContext(context)),

      Notify: (request) => asCaller((caller) => Effect.flatMap(knownMachine(caller), (from) => notify(request, from))),

      AskSecret: (request) => asCaller((caller) => askSecretFromMachine(request, caller)),

      Relay: ({ sealed }) => Stream.unwrap(asCaller((caller) => relay(caller, sealed))),

      RelayMore: ({ sealed }) => asCaller((caller) => relayMore(caller, sealed)),

      Reply: ({ sealed }) => asCaller((caller) => reply(caller, sealed))
    })
  })
)
