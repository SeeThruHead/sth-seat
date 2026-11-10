import { Duration, Effect, Layer, Option, Ref, Schedule, Stream } from "effect"
import { RpcClient } from "effect/rpc"
import { DaemonRpcs } from "@sth-seat/protocol/Daemon.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import type { HubCommand } from "@sth-seat/protocol/Daemon.ts"
import { Me } from "../domains/identity/Me.ts"
import { problemOf } from "../domains/problem/Problem.ts"
import { Sessions } from "../domains/sessions/Sessions.ts"
import { execute } from "../features/commands/handler.ts"
import type { HubMade } from "../features/commands/handler.ts"
import { aborted, freshSeen, relayed } from "../features/remote/handler.ts"
import type { RemoteSettings } from "../features/remote/handler.ts"
import { Idle } from "../platform/Idle.ts"
import { hubFor } from "./Hub.ts"
import { tunnelsLayer } from "./Tunnels.ts"
import { requireIdentity } from "./Identity.ts"
import type { Identity, IdentityFiles } from "./Identity.ts"

const reportEvery = Duration.seconds(10)

export type DaemonSettings = {
  readonly hubUrl: string
  readonly identity: IdentityFiles
  readonly remote: RemoteSettings
}

const repeatedWarnings = Effect.map(Ref.make(Option.none<string>()), (last) => ({
  warn: (message: string) =>
    Ref.getAndSet(last, Option.some(message)).pipe(
      Effect.flatMap((before) => (Option.contains(before, message) ? Effect.void : Effect.logWarning(message)))
    ),
  clear: Ref.set(last, Option.none())
}))

const session = Effect.fn("Daemon.session")(function* (settings: DaemonSettings, identity: Identity, version: string) {
  const idle = yield* Idle
  const hub = yield* RpcClient.make(DaemonRpcs)
  const tunnels = yield* Layer.build(tunnelsLayer(hub, identity))
  const seen = yield* freshSeen
  const warnings = yield* repeatedWarnings

  const send = (sealed: Sealed) =>
    hub.Reply({ sealed }).pipe(Effect.catchCause((cause) => Effect.logWarning("can't send a reply", cause)))

  const answer = Effect.fnUntraced(function* (command: HubMade) {
    const outcome = yield* execute(command, settings.remote.home).pipe(Effect.provideContext(tunnels))

    yield* hub.Answer({ id: command.id, outcome })
  })

  const handle = Effect.fnUntraced(function* (command: HubCommand) {
    if (command._tag === "Relayed") return yield* relayed(command.sealed, send, seen, settings.remote)
    if (command._tag === "Abort") return yield* aborted(command.session)

    yield* Effect.forkScoped(answer(command))
  })

  const first = yield* idle.current.pipe(
    Effect.tapError((error) => warnings.warn(error.message)),
    Effect.option
  )
  const commands = hub
    .Attach({ version, ...(Option.isSome(first) ? { idle: first.value } : {}) })
    .pipe(Stream.runForEach(handle))

  const reports = idle.current.pipe(
    Effect.flatMap((current) => Effect.andThen(warnings.clear, hub.Presence({ idle: current }))),
    Effect.catchTag("IdleUnavailable", (error) => warnings.warn(error.message)),
    Effect.delay(reportEvery),
    Effect.forever
  )

  yield* Effect.logInfo("connecting to the hub", { hub: settings.hubUrl, version })

  return yield* Effect.raceFirst(commands, reports)
})

const backoff = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ output }) => Effect.succeed(Duration.min(output, Duration.seconds(30))))
)

const meOf = (identity: Identity) =>
  Layer.succeed(Me, Me.of({ name: identity.name, key: identity.key, publicKey: identity.publicKey }))

export const daemon = Effect.fn("Daemon.daemon")(function* (settings: DaemonSettings, version: string) {
  const identity = yield* requireIdentity(settings.identity)

  return yield* session(settings, identity, version).pipe(
    Effect.provide([hubFor(settings.hubUrl, identity), Sessions.layer]),
    Effect.scoped,
    Effect.tapCause((cause) =>
      Effect.logWarning(
        "hub link dropped; reconnecting",
        Option.getOrElse(problemOf(cause), () => "interrupted")
      )
    ),
    Effect.sandbox,
    Effect.retry(backoff),
    Effect.repeat(Schedule.spaced("2 seconds")),
    Effect.provide(meOf(identity))
  )
})
