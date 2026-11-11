import { Context, Layer, Option } from "effect"
import type { Hostname, MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import type { SecretsKept } from "@sth-seat/protocol/Daemon.ts"
import type { PublicKeyText } from "@sth-seat/protocol/Keys.ts"

export type Machine = {
  readonly name: MachineName
  readonly label: MachineLabel
  readonly hostnames: ReadonlyArray<Hostname>
  readonly publicKey: Option.Option<PublicKeyText>
  readonly secrets: SecretsKept
}

const normalized = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/\.(local|lan|home|internal)$/, "")

const answersTo = (machine: Machine, hostname: Hostname): boolean => {
  const wanted = normalized(hostname)
  if (machine.name === wanted) return true

  return machine.hostnames.some((known) => normalized(known) === wanted)
}

export class Roster extends Context.Service<
  Roster,
  {
    readonly machines: ReadonlyArray<Machine>
    find(name: MachineName): Option.Option<Machine>
    byHostname(hostname: Hostname): Option.Option<Machine>
  }
>()("hub/domains/roster/Roster") {
  static readonly layer = (machines: ReadonlyArray<Machine>) =>
    Layer.succeed(
      Roster,
      Roster.of({
        machines,
        find: (name) => Option.fromNullishOr(machines.find((machine) => machine.name === name)),
        byHostname: (hostname) => Option.fromNullishOr(machines.find((machine) => answersTo(machine, hostname)))
      })
    )
}
