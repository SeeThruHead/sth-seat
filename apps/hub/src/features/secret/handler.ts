import { Effect, Option } from "effect"
import type { AskSecretFromAgent, AskSecretRequest, SecretStored } from "@sth-seat/protocol/Actions.ts"
import { storedSecretPath } from "@sth-seat/protocol/Daemon.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { nobodyConnected, seatOf } from "../../domains/presence/Seat.ts"
import { Roster } from "../../domains/roster/Roster.ts"
import type { Machine } from "../../domains/roster/Roster.ts"
import { answered, command, failed, unknownHostname } from "../dispatch/dispatch.ts"
import { sightings } from "../where/handler.ts"

const answerTime = "180 seconds"

export const keptOn = (origin: Machine): string =>
  `Secrets asked from ${origin.label} stay on it: run \`sth-seat ask-secret\` there, which asks on that machine and never sends the secret through the hub.`

export const askSecret = Effect.fn("Secret.askSecret")(function* (request: AskSecretRequest, origin: Machine) {
  if (origin.secrets === "here") return yield* failed(keptOn(origin))
  const found = yield* sightings
  const seat = seatOf(found)
  if (Option.isNone(seat)) return yield* failed(nobodyConnected)

  yield* Effect.annotateCurrentSpan({ seat: seat.value.name, origin: origin.name, "secret.name": request.name })
  const destination = { machine: origin.label, file: storedSecretPath(request.name) }
  const prompt = { _tag: "AskSecret", name: request.name, question: request.question, destination } as const
  const asked = yield* command(seat.value, prompt, answerTime)
  const { value } = yield* answered(asked, "SecretGiven")

  const stored = yield* command(origin, { _tag: "StoreSecret", name: request.name, value }, "15 seconds")
  const { path } = yield* answered(stored, "Stored")

  const result: SecretStored = {
    machine: origin.name,
    path,
    message: `The user answered on ${seat.value.label}; the secret is in ${path} on ${origin.label}. Read it from there; don't print it.`
  }

  return result
})

export const askSecretFromAgent = Effect.fn("Secret.askSecretFromAgent")(function* (request: AskSecretFromAgent) {
  const roster = yield* Roster
  const origin = roster.byHostname(request.from)
  if (Option.isNone(origin)) return yield* unknownHostname(request.from, roster.machines)

  return yield* askSecret({ name: request.name, question: request.question }, origin.value)
})

export const askSecretFromMachine = Effect.fn("Secret.askSecretFromMachine")(function* (
  request: AskSecretRequest,
  machine: MachineName
) {
  const roster = yield* Roster
  const origin = roster.find(machine)
  if (Option.isNone(origin)) return yield* failed(`The hub doesn't know ${machine}.`)

  return yield* askSecret(request, origin.value)
})
