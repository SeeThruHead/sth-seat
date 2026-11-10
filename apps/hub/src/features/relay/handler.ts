import { Effect, Option, Stream } from "effect"
import { RelayFailed } from "@sth-seat/protocol/Daemon.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { publicKeyOf } from "@sth-seat/protocol/Keys.ts"
import { Envelope, Reply, isLast } from "@sth-seat/protocol/Remote.ts"
import type { Request } from "@sth-seat/protocol/Remote.ts"
import { peek, unseal } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Links } from "../../domains/links/Links.ts"
import { Relays } from "../../domains/relays/Relays.ts"
import type { Route } from "../../domains/relays/Relays.ts"
import { Roster } from "../../domains/roster/Roster.ts"

const failed = (reason: string) => new RelayFailed({ reason })

const startsSession = (request: Request): boolean =>
  request._tag === "Run" || request._tag === "Read" || request._tag === "Write" || request._tag === "Tunnel"

const signedBy = Effect.fnUntraced(function* (caller: MachineName, sealed: Sealed) {
  const roster = yield* Roster
  const machine = roster.find(caller)
  const key = Option.flatMap(machine, (found) => found.publicKey)
  if (Option.isNone(key)) return yield* failed(`The hub has no public key for ${caller}; run \`sth-seat key\` there.`)
  const publicKey = yield* publicKeyOf(key.value).pipe(Effect.mapError((error) => failed(error.message)))
  const envelope = yield* unseal(Envelope, publicKey, "command", sealed).pipe(
    Effect.mapError((error) => failed(`The command from ${caller} isn't sealed by it: ${error.message}`))
  )
  if (envelope.from !== caller) return yield* failed(`${caller} can't send commands as ${envelope.from}.`)

  return envelope
})

const routeOf = (envelope: Envelope): Route => ({
  session: envelope.session,
  owner: envelope.from,
  target: envelope.to
})

const forward = Effect.fnUntraced(function* (target: MachineName, sealed: Sealed) {
  const links = yield* Links

  yield* links
    .send(target, { _tag: "Relayed", sealed })
    .pipe(Effect.mapError(() => failed(`${target} isn't connected to the hub.`)))
})

const abandon = Effect.fnUntraced(function* (route: Route) {
  const relays = yield* Relays
  const links = yield* Links
  const open = yield* relays.close(route.session)
  if (!open) return

  yield* links.send(route.target, { _tag: "Abort", session: route.session }).pipe(Effect.ignore)
})

export const relay = Effect.fn("Relay.relay")(function* (caller: MachineName, sealed: Sealed) {
  const relays = yield* Relays
  const context = yield* Effect.context<Links | Relays>()
  const envelope = yield* signedBy(caller, sealed)
  if (!startsSession(envelope.request))
    return yield* failed(`A session starts with Run, Read, Write or Tunnel, not ${envelope.request._tag}.`)
  yield* Effect.annotateCurrentSpan({ from: caller, to: envelope.to, request: envelope.request._tag })
  const route = routeOf(envelope)
  const replies = yield* relays.open(route)
  yield* forward(envelope.to, sealed).pipe(Effect.tapError(() => relays.close(route.session)))

  return replies.pipe(Stream.ensuring(abandon(route).pipe(Effect.provideContext(context))))
})

export const relayMore = Effect.fn("Relay.relayMore")(function* (caller: MachineName, sealed: Sealed) {
  const relays = yield* Relays
  const envelope = yield* signedBy(caller, sealed)
  const open = yield* relays.isOpen(routeOf(envelope))
  if (!open) return yield* failed("That session isn't running any more.")

  yield* forward(envelope.to, sealed)
})

export const reply = Effect.fn("Relay.reply")(function* (target: MachineName, sealed: Sealed) {
  const relays = yield* Relays
  const answer = yield* peek(Reply, "reply", sealed).pipe(Effect.option)
  if (Option.isNone(answer)) return

  yield* relays.deliver(answer.value.session, target, sealed, isLast(answer.value.event))
})
