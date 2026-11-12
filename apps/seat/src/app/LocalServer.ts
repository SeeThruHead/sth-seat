import { BunSocketServer } from "@effect/platform-bun"
import { Effect, FileSystem, Layer, Option, Ref, Schema, Stream } from "effect"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { ActionFailed } from "@sth-seat/protocol/Actions.ts"
import type { OpenFromMachine } from "@sth-seat/protocol/Actions.ts"
import { RelayFailed } from "@sth-seat/protocol/Daemon.ts"
import { LocalRpcs } from "@sth-seat/protocol/Local.ts"
import type { Envelope } from "@sth-seat/protocol/Remote.ts"
import type { HubClient } from "./Hub.ts"
import type { Identity } from "./Identity.ts"
import { shareGrant, throughHub } from "./Remote.ts"

export type HubSlot = Ref.Ref<Option.Option<HubClient>>

export const notLinked =
  "This machine's daemon isn't linked to the hub right now, so the hub can't open or show anything for it; run `sth-seat doctor`."

const asFailed = (error: { readonly message: string }): ActionFailed =>
  Schema.is(ActionFailed)(error) ? error : new ActionFailed({ message: error.message, offline: true })

const asRelayFailed = (error: { readonly message: string }): RelayFailed =>
  Schema.is(RelayFailed)(error) ? error : new RelayFailed({ reason: error.message })

const handlers = (slot: HubSlot, me: Identity) =>
  LocalRpcs.toLayer(
    Effect.sync(() => {
      const linked = Ref.get(slot).pipe(
        Effect.flatMap((hub) => Effect.fromOption(hub)),
        Effect.mapError(() => new ActionFailed({ message: notLinked, offline: true }))
      )

      const fromMe = Effect.fnUntraced(function* (envelope: Envelope) {
        if (envelope.from !== me.name)
          return yield* new RelayFailed({ reason: `This daemon sends only as ${me.name}, not ${envelope.from}.` })

        return envelope
      })

      const withGrant = Effect.fnUntraced(function* (request: OpenFromMachine) {
        const { grant: _ignored, ...asked } = request
        if (!asked.target.startsWith("/")) return asked
        const grant = yield* shareGrant(me, asked.target).pipe(Effect.mapError(asFailed))

        return { ...asked, grant }
      })

      return LocalRpcs.of({
        Open: (request) =>
          Effect.all([linked, withGrant(request)]).pipe(
            Effect.flatMap(([hub, asked]) => hub.Open(asked)),
            Effect.mapError(asFailed)
          ),
        Where: () =>
          linked.pipe(
            Effect.flatMap((hub) => hub.Where()),
            Effect.mapError(asFailed)
          ),
        Notify: (request) =>
          linked.pipe(
            Effect.flatMap((hub) => hub.Notify(request)),
            Effect.mapError(asFailed)
          ),
        AskSecret: (request) =>
          linked.pipe(
            Effect.flatMap((hub) => hub.AskSecret(request)),
            Effect.mapError(asFailed)
          ),
        Relay: ({ envelope }) =>
          Stream.unwrap(
            Effect.all([linked.pipe(Effect.mapError(asRelayFailed)), fromMe(envelope)]).pipe(
              Effect.map(([hub, mine]) => throughHub(hub, me).relay(mine).pipe(Stream.mapError(asRelayFailed)))
            )
          ),
        RelayMore: ({ envelope }) =>
          Effect.all([linked.pipe(Effect.mapError(asRelayFailed)), fromMe(envelope)]).pipe(
            Effect.flatMap(([hub, mine]) => throughHub(hub, me).more(mine)),
            Effect.mapError(asRelayFailed)
          )
      })
    })
  )

export const privateFolder = Effect.fnUntraced(function* (folder: string, socket: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(folder, { recursive: true, mode: 0o700 })
  yield* fs.chmod(folder, 0o700)
  yield* fs.remove(socket, { force: true })
})

export const localServer = (folder: string, socket: string, slot: HubSlot, me: Identity) =>
  RpcServer.layer(LocalRpcs).pipe(
    Layer.provide(handlers(slot, me)),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide([BunSocketServer.layer({ path: socket }), RpcSerialization.layerNdjson]),
    Layer.provide(Layer.effectDiscard(privateFolder(folder, socket)))
  )
