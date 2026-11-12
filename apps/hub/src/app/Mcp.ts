import { Effect, Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { toolkit } from "@sth-seat/protocol/Action.ts"
import { askUserSecret, notifyUser, openForUser, whereIsUser } from "@sth-seat/protocol/Actions.ts"
import { Links } from "../domains/links/Links.ts"
import { Presence } from "../domains/presence/Presence.ts"
import { Roster } from "../domains/roster/Roster.ts"
import { notifyFromAgent } from "../features/notify/handler.ts"
import { openFromAgent } from "../features/open/handler.ts"
import { askSecretFromAgent } from "../features/secret/handler.ts"
import { where } from "../features/where/handler.ts"
import { mcpAuth } from "./Auth.ts"
import type { HubSettings } from "./HubSettings.ts"

export const mcpPath = "/mcp"

export const SeatToolkit = toolkit(openForUser.tool, whereIsUser.tool, notifyUser.tool, askUserSecret.tool)

const handlers = SeatToolkit.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Roster | Links | Presence>()

    return SeatToolkit.of({
      open_for_user: (request) => openFromAgent(request).pipe(Effect.provideContext(context)),
      where_is_user: () => where.pipe(Effect.provideContext(context)),
      notify_user: (request) => notifyFromAgent(request).pipe(Effect.provideContext(context)),
      ask_user_secret: (request) => askSecretFromAgent(request).pipe(Effect.provideContext(context))
    })
  })
)

const sessionNotFound = HttpServerResponse.jsonUnsafe(
  { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
  { status: 404 }
)

const isLostSession = (
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse
) => {
  if (response.status !== 404) return false
  if (response.body._tag !== "Empty") return false

  return request.headers["mcp-session-id"] !== undefined
}

const explainLostSessions = HttpRouter.middleware((httpEffect) =>
  Effect.ensuring(
    httpEffect,
    HttpEffect.appendPreResponseHandler((request, response) =>
      Effect.succeed(isLostSession(request, response) ? sessionNotFound : response)
    )
  )
)

export const mcpLayer = (settings: HubSettings, version: string) =>
  McpServer.toolkit(SeatToolkit).pipe(
    Layer.provide(handlers),
    Layer.provide(
      McpServer.layerHttp({
        name: "sth-seat",
        version,
        instructions: "Show the user links, files and notifications on the machine they are sitting at.",
        path: mcpPath,
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26]
      })
    ),
    Layer.provide(mcpAuth(settings).layer),
    Layer.provide(explainLostSessions.layer)
  )
