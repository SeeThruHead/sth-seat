import { Effect, Layer, Option, Ref, Stream } from "effect"
import { SecureRandom } from "effect/crypto"
import type { HubCommand, Outcome } from "@sth-seat/protocol/Daemon.ts"
import { Hostname, IdleMillis, MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import { newKeyPair, textOf } from "@sth-seat/protocol/Keys.ts"
import { Links } from "../domains/links/Links.ts"
import { Presence } from "../domains/presence/Presence.ts"
import { Relays } from "../domains/relays/Relays.ts"
import { Roster } from "../domains/roster/Roster.ts"
import type { Machine } from "../domains/roster/Roster.ts"

export const cube = MachineName.make("cube")
export const tower = MachineName.make("tower")

export const macMachine: Machine = {
  name: cube,
  label: MachineLabel.make("Cube"),
  hostnames: [Hostname.make("Office-Cube")],
  publicKey: Option.none(),
  secrets: "seat",
  side: "default"
}

export const devMachine: Machine = {
  name: tower,
  label: MachineLabel.make("Tower"),
  hostnames: [Hostname.make("Tower")],
  publicKey: Option.none(),
  secrets: "seat",
  side: "default"
}

export const desk = MachineName.make("desk")

export const deskMachine: Machine = {
  name: desk,
  label: MachineLabel.make("Desk"),
  hostnames: [Hostname.make("Work-Desk")],
  publicKey: Option.none(),
  secrets: "here",
  side: "work"
}

export const machines: ReadonlyArray<Machine> = [macMachine, devMachine]

export const seededRandom = Layer.succeed(
  SecureRandom.SecureRandom,
  SecureRandom.make((size) => Uint8Array.from({ length: size }, (_, index) => (index * 37) % 256))
)

export const hubServices = Layer.mergeAll(Links.layer, Presence.layer, Relays.layer, Roster.layer(machines)).pipe(
  Layer.provide(seededRandom)
)

export const idle = (millis: number) => IdleMillis.make(millis)

export const done: Outcome = { _tag: "Done" }

export const fakeDaemon = Effect.fnUntraced(function* (
  name: MachineName,
  answer: (command: HubCommand) => Outcome = () => done
) {
  const links = yield* Links
  const seen = yield* Ref.make<ReadonlyArray<HubCommand>>([])
  yield* links.attach(name).pipe(
    Stream.runForEach((command) =>
      Ref.update(seen, (all) => [...all, command]).pipe(Effect.andThen(links.answer(command.id, answer(command))))
    ),
    Effect.forkScoped({ startImmediately: true })
  )

  return { seen: Ref.get(seen) }
})

export const sitAt = Effect.fnUntraced(function* (name: MachineName, others: ReadonlyArray<MachineName> = []) {
  const presence = yield* Presence
  yield* Effect.forEach(others, (other) => presence.report(other, idle(600_000)), { discard: true })
  yield* presence.report(name, idle(1_000))
})

export const keyedMachines = Effect.gen(function* () {
  const mac = yield* newKeyPair
  const dev = yield* newKeyPair
  const macText = yield* textOf(mac.publicKey)
  const devText = yield* textOf(dev.publicKey)
  const roster: ReadonlyArray<Machine> = [
    { ...macMachine, publicKey: Option.some(macText) },
    { ...devMachine, publicKey: Option.some(devText) }
  ]

  return { roster, macKey: mac.privateKey, devKey: dev.privateKey, macText, devText }
})

export const servicesFor = (roster: ReadonlyArray<Machine>) =>
  Layer.mergeAll(Links.layer, Presence.layer, Relays.layer, Roster.layer(roster)).pipe(Layer.provide(seededRandom))

export const sidedServices = servicesFor([macMachine, devMachine, deskMachine])
