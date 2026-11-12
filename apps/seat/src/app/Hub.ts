import { BunSocket } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { DaemonRpcs, daemonAuthClient } from "@sth-seat/protocol/Daemon.ts"
import { helloHeader } from "@sth-seat/protocol/Hello.ts"
import type { Identity } from "./Identity.ts"

export const hubProtocol = (hubUrl: string) =>
  RpcClient.layerProtocolSocket({ pingInterval: "10 seconds", pingTimeout: "30 seconds" }).pipe(
    Layer.provide(Layer.effect(Socket.Socket, Socket.makeWebSocket(hubUrl, { openTimeout: "10 seconds" }))),
    Layer.provide([BunSocket.layerWebSocketConstructor, RpcSerialization.layerNdjson])
  )

export const signedIn = (me: Identity) => daemonAuthClient(helloHeader(me.name, me.key).pipe(Effect.orDie))

export const hubFor = (hubUrl: string, me: Identity) => Layer.mergeAll(hubProtocol(hubUrl), signedIn(me))

const hubClient = RpcClient.make(DaemonRpcs)

export type HubClient = Effect.Success<typeof hubClient>
