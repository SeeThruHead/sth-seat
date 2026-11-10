import { BunSocket } from "@effect/platform-bun"
import { Duration, Effect, Layer, Schema } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { DaemonRpcs, daemonAuthClient } from "@sth-seat/protocol/Daemon.ts"
import { helloHeader } from "@sth-seat/protocol/Hello.ts"
import { requireIdentity } from "./Identity.ts"
import type { Identity, IdentityFiles } from "./Identity.ts"

export class HubUnreachable extends Schema.TaggedError<HubUnreachable, { readonly brand: unique symbol }>()(
  "HubUnreachable",
  { url: Schema.String, problem: Schema.String }
) {
  override get message() {
    return `Can't reach the hub at ${this.url}: ${this.problem}`
  }
}

export type HubSettings = { readonly hubUrl: string; readonly identity: IdentityFiles }

export const hubProtocol = (hubUrl: string) =>
  RpcClient.layerProtocolSocket({ pingInterval: "10 seconds", pingTimeout: "30 seconds" }).pipe(
    Layer.provide(Layer.effect(Socket.Socket, Socket.makeWebSocket(hubUrl, { openTimeout: "10 seconds" }))),
    Layer.provide([BunSocket.layerWebSocketConstructor, RpcSerialization.layerNdjson])
  )

export const signedIn = (me: Identity) => daemonAuthClient(helloHeader(me.name, me.key).pipe(Effect.orDie))

export const hubFor = (hubUrl: string, me: Identity) => Layer.mergeAll(hubProtocol(hubUrl), signedIn(me))

const hubClient = RpcClient.make(DaemonRpcs)

export type HubClient = Effect.Success<typeof hubClient>

const usualWait = Duration.seconds(90)

export const askHub = Effect.fn("Hub.askHub")(function* <A, E, R>(
  settings: HubSettings,
  ask: (hub: HubClient, me: Identity) => Effect.Effect<A, E, R>,
  wait: Duration.Duration = usualWait
) {
  const me = yield* requireIdentity(settings.identity)

  return yield* Effect.scoped(Effect.flatMap(hubClient, (hub) => ask(hub, me))).pipe(
    Effect.provide(hubFor(settings.hubUrl, me)),
    Effect.timeoutOrElse({
      duration: wait,
      orElse: () =>
        Effect.fail(new HubUnreachable({ url: settings.hubUrl, problem: `no answer within ${Duration.format(wait)}` }))
    })
  )
})
