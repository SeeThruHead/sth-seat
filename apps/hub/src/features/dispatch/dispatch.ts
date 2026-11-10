import { Effect } from "effect"
import type { Duration } from "effect"
import { ActionFailed } from "@sth-seat/protocol/Actions.ts"
import type { Outcome } from "@sth-seat/protocol/Daemon.ts"
import type { MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import { Links } from "../../domains/links/Links.ts"
import type { CommandBody, MachineUnreachable } from "../../domains/links/Links.ts"

export type Named = { readonly name: MachineName; readonly label: MachineLabel }

export const failed = (message: string) => new ActionFailed({ message })

export const unknownHostname = (hostname: string, known: ReadonlyArray<{ readonly name: MachineName }>) =>
  failed(
    `The hub doesn't know a machine called ${hostname}. It knows ${known.map((machine) => machine.name).join(", ")}.`
  )

const reasonText = { "not connected": "isn't connected to the hub", "no answer": "didn't answer in time" } as const

export const command = Effect.fn("Dispatch.command")(function* (
  machine: Named,
  body: CommandBody,
  timeout: Duration.Input
) {
  const links = yield* Links
  const outcome = yield* links
    .call(machine.name, body, timeout)
    .pipe(Effect.mapError((error: MachineUnreachable) => failed(`${machine.label} ${reasonText[error.reason]}.`)))
  if (outcome._tag === "Refused") return yield* failed(`${machine.label} couldn't do it: ${outcome.reason}`)

  return outcome
})

export const answered = <const Tag extends Outcome["_tag"]>(
  outcome: Outcome,
  tag: Tag
): Effect.Effect<Extract<Outcome, { readonly _tag: Tag }>, ActionFailed> =>
  isTagged(outcome, tag)
    ? Effect.succeed(outcome)
    : Effect.fail(failed(`The daemon answered ${outcome._tag} where ${tag} was expected.`))

const isTagged = <const Tag extends Outcome["_tag"]>(
  outcome: Outcome,
  tag: Tag
): outcome is Extract<Outcome, { readonly _tag: Tag }> => outcome._tag === tag

export const done = Effect.fn("Dispatch.done")(function* (machine: Named, body: CommandBody, timeout: Duration.Input) {
  const outcome = yield* command(machine, body, timeout)

  yield* answered(outcome, "Done")
})
