import { DateTime, Effect, HashMap, Layer, Option, Ref } from "effect"
import { Digest, Signature } from "effect/crypto"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ConnectedMachine, DaemonAuth, DaemonRefused } from "@sth-seat/protocol/Daemon.ts"
import { firstSighting, isFresh } from "@sth-seat/protocol/Freshness.ts"
import type { Seen } from "@sth-seat/protocol/Freshness.ts"
import { Hello, sealedHello } from "@sth-seat/protocol/Hello.ts"
import { publicKeyOf } from "@sth-seat/protocol/Keys.ts"
import { peek, unseal } from "@sth-seat/protocol/Sealed.ts"
import { tokenHash } from "@sth-seat/protocol/Tokens.ts"
import type { HubSettings, MachineSettings } from "./HubSettings.ts"

const bearerFrom = (headers: Headers.Headers): Option.Option<string> =>
  Headers.get(headers, "authorization").pipe(
    Option.filter((value) => value.startsWith("Bearer ")),
    Option.map((value) => value.slice("Bearer ".length).trim()),
    Option.filter((token) => token.length > 0)
  )

const hashOf = Effect.fnUntraced(function* (headers: Headers.Headers) {
  const token = bearerFrom(headers)
  if (Option.isNone(token)) return Option.none<string>()

  const hash = yield* tokenHash(token.value)

  return Option.some(hash)
})

const refused = (reason: string) => new DaemonRefused({ reason })

const byHello = Effect.fnUntraced(function* (settings: HubSettings, header: string, seen: Ref.Ref<Seen>) {
  const sealed = yield* sealedHello(header).pipe(Effect.mapError((error) => refused(error.message)))
  const claimed = yield* peek(Hello, "hello", sealed).pipe(Effect.mapError((error) => refused(error.message)))
  const machine = settings.machines.find((known) => known.name === claimed.machine)
  if (machine?.publicKey === undefined) return yield* refused(`The hub has no public key for ${claimed.machine}.`)
  const key = yield* publicKeyOf(machine.publicKey).pipe(Effect.mapError((error) => refused(error.message)))
  const hello = yield* unseal(Hello, key, "hello", sealed).pipe(
    Effect.mapError(() => refused(`This hello isn't signed by ${claimed.machine}'s key.`))
  )
  const now = yield* DateTime.now
  if (!isFresh(hello.issuedAt, now)) return yield* refused("This hello is too old or from the future; check the clock.")
  const first = yield* Ref.modify(seen, (before) => firstSighting(before, hello.nonce, now))
  if (!first) return yield* refused("This hello was already used.")

  return machine
})

const notSignedIn = refused(
  "Sign in with this machine's key: run `sth-seat key --name <name>` and add its public key to the hub's config."
)

const machineFrom = Effect.fnUntraced(function* (settings: HubSettings, headers: Headers.Headers, seen: Ref.Ref<Seen>) {
  const hello = Option.filter(Headers.get(headers, "authorization"), (value) => value.startsWith("Sth-Seat "))
  if (Option.isNone(hello)) return yield* notSignedIn

  return yield* byHello(settings, hello.value, seen)
})

export const daemonAuthLayer = (settings: HubSettings) =>
  Layer.effect(
    DaemonAuth,
    Effect.gen(function* () {
      const context = yield* Effect.context<Digest.Digest | Signature.Signature>()
      const seen = yield* Ref.make<Seen>(HashMap.empty())

      return DaemonAuth.of(
        Effect.fnUntraced(function* (effect, { headers }) {
          const machine: MachineSettings = yield* machineFrom(settings, headers, seen).pipe(
            Effect.provideContext(context)
          )

          return yield* Effect.provideService(effect, ConnectedMachine, ConnectedMachine.of({ name: machine.name }))
        })
      )
    })
  )

const unauthorized = HttpServerResponse.text("The MCP endpoint needs the router's bearer token.", { status: 401 })

export const mcpAuth = (settings: HubSettings) =>
  HttpRouter.middleware(
    Effect.gen(function* () {
      const digests = yield* Digest.Digest

      return (httpEffect) =>
        HttpServerRequest.HttpServerRequest.use((request) =>
          hashOf(request.headers).pipe(
            Effect.provideService(Digest.Digest, digests),
            Effect.flatMap((hash) =>
              Option.contains(hash, settings.mcpTokenHash) ? httpEffect : Effect.succeed(unauthorized)
            )
          )
        )
    })
  )
