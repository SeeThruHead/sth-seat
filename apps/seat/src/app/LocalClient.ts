import { BunSocket } from "@effect/platform-bun"
import { Duration, Effect, Layer, Runtime, Schema } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { LocalRpcs, localSocketName } from "@sth-seat/protocol/Local.ts"
import { machineName } from "./Identity.ts"
import type { IdentityFiles } from "./Identity.ts"

export class SeatOff extends Schema.TaggedError<SeatOff, { readonly brand: unique symbol }>()("SeatOff", {
  socket: Schema.String
}) {
  override get message() {
    return "sth-seat is off on this machine: its daemon isn't running, so no sth-seat command works here and nothing is sent anywhere. Start it with `sth-seat install`."
  }

  override get [Runtime.errorExitCode]() {
    return 3
  }
}

export class DaemonSilent extends Schema.TaggedError<DaemonSilent, { readonly brand: unique symbol }>()(
  "DaemonSilent",
  { wait: Schema.String }
) {
  override get message() {
    return `This machine's daemon didn't answer within ${this.wait}; run \`sth-seat doctor\`.`
  }
}

export type DaemonSettings = { readonly stateDir: string; readonly identity: IdentityFiles }

export const socketOf = (stateDir: string): string => `${stateDir}/${localSocketName}`

const connects = (socket: string): Promise<void> =>
  Bun.connect({ unix: socket, socket: { data: () => undefined } }).then((open) => {
    open.end()
  })

export const requireDaemon = Effect.fn("LocalClient.requireDaemon")(function* (settings: DaemonSettings) {
  const socket = socketOf(settings.stateDir)

  yield* Effect.tryPromise({ try: () => connects(socket), catch: () => new SeatOff({ socket }) }).pipe(
    Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.fail(new SeatOff({ socket })) })
  )
})

const daemonProtocol = (socket: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.effect(Socket.Socket, BunSocket.makeNet({ path: socket, openTimeout: "5 seconds" }))),
    Layer.provide(RpcSerialization.layerNdjson)
  )

const localClient = RpcClient.make(LocalRpcs)

export type LocalClient = Effect.Success<typeof localClient>

const usualWait = Duration.seconds(90)

export const askDaemon = Effect.fn("LocalClient.askDaemon")(function* <A, E, R>(
  settings: DaemonSettings,
  ask: (daemon: LocalClient, me: MachineName) => Effect.Effect<A, E, R>,
  wait: Duration.Duration = usualWait
) {
  yield* requireDaemon(settings)
  const me = yield* machineName(settings.identity)

  return yield* Effect.scoped(Effect.flatMap(localClient, (daemon) => ask(daemon, me))).pipe(
    Effect.provide(daemonProtocol(socketOf(settings.stateDir))),
    Effect.timeoutOrElse({
      duration: wait,
      orElse: () => Effect.fail(new DaemonSilent({ wait: Duration.format(wait) }))
    })
  )
})
