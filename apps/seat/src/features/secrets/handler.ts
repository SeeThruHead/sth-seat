import { Effect, Option } from "effect"
import type { AskSecretRequest, SecretStored } from "@sth-seat/protocol/Actions.ts"
import { storedSecretPath } from "@sth-seat/protocol/Daemon.ts"
import { MachineLabel } from "@sth-seat/protocol/Ids.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { Files } from "../../domains/files/Files.ts"
import { Desktop } from "../../platform/Desktop.ts"

export const askHere = Effect.fn("Secrets.askHere")(function* (request: AskSecretRequest, machine: MachineName) {
  const desktop = yield* Desktop
  const files = yield* Files
  const destination = { machine: MachineLabel.make(machine), file: storedSecretPath(request.name) }
  const value = yield* desktop.askSecret(request.name, request.question, Option.some(destination))
  const path = yield* files.storeSecret(request.name, value)

  const result: SecretStored = {
    machine,
    path,
    message: `The user answered on ${machine}, and the secret never left it: it is in ${path}. Read it from there; don't print it.`
  }

  return result
})
