import { BunCrypto } from "@effect/platform-bun"
import { Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { DaemonRpcs, daemonPath } from "@sth-seat/protocol/Daemon.ts"
import { Links } from "../domains/links/Links.ts"
import { Presence } from "../domains/presence/Presence.ts"
import { Relays } from "../domains/relays/Relays.ts"
import { Roster } from "../domains/roster/Roster.ts"
import type { Machine } from "../domains/roster/Roster.ts"
import { daemonAuthLayer } from "./Auth.ts"
import { DaemonHandlers } from "./DaemonHandlers.ts"
import type { HubSettings, MachineSettings } from "./HubSettings.ts"
import { mcpLayer } from "./Mcp.ts"

const health = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))

const keepHeadersThroughUpgrade = HttpRouter.middleware(
  (httpEffect) =>
    HttpServerRequest.HttpServerRequest.use((request) =>
      Effect.andThen(
        Effect.sync(() => request.headers),
        httpEffect
      )
    ),
  { global: true }
)

const machineOf = (settings: MachineSettings): Machine => ({
  name: settings.name,
  label: settings.label,
  hostnames: settings.hostnames,
  publicKey: Option.fromNullishOr(settings.publicKey),
  secrets: settings.secrets,
  side: settings.side
})

const machinesOf = (settings: HubSettings) => settings.machines.map(machineOf)

const services = (settings: HubSettings) =>
  Layer.mergeAll(Links.layer, Presence.layer, Relays.layer, Roster.layer(machinesOf(settings)))

const daemonRpc = (settings: HubSettings) =>
  RpcServer.layerHttp({ group: DaemonRpcs, path: daemonPath, protocol: "websocket" }).pipe(
    Layer.provide([DaemonHandlers, daemonAuthLayer(settings)]),
    Layer.provide(RpcSerialization.layerNdjson)
  )

export const routes = (settings: HubSettings, revision: string) =>
  Layer.mergeAll(health, keepHeadersThroughUpgrade, daemonRpc(settings), mcpLayer(settings, revision)).pipe(
    Layer.provide(services(settings)),
    Layer.provide(BunCrypto.layer)
  )
