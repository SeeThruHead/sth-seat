import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { Hostname, MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import { machines } from "../../testing/Hub.testing.ts"
import { Roster } from "./Roster.ts"

const nameFor = (hostname: string) =>
  Roster.use((roster) =>
    Effect.succeed(Option.map(roster.byHostname(Hostname.make(hostname)), (machine) => machine.name))
  ).pipe(Effect.provide(Roster.layer(machines)))

describe("Roster", () => {
  it.effect("finds a machine by its name or any hostname, ignoring case and local suffixes", () =>
    Effect.gen(function* () {
      const found = yield* Effect.forEach(["tower", "Tower", "Office-Cube.local", "office-cube.lan."], nameFor)

      assert.deepStrictEqual(found, [
        Option.some(MachineName.make("tower")),
        Option.some(MachineName.make("tower")),
        Option.some(MachineName.make("cube")),
        Option.some(MachineName.make("cube"))
      ])
    })
  )

  it.effect("matches its own name and every hostname it lists, not a name with more after it", () =>
    Effect.gen(function* () {
      const studio = {
        name: MachineName.make("studio"),
        label: MachineLabel.make("Studio"),
        hostnames: [Hostname.make("studio-old"), Hostname.make("studio-new")],
        publicKey: Option.none(),
        secrets: "seat" as const,
        side: "default"
      }
      const found = yield* Effect.forEach(
        ["studio", "studio-new", "studio-new.local", "studio-new.localdomain"],
        (hostname) =>
          Roster.use((roster) => Effect.succeed(Option.isSome(roster.byHostname(Hostname.make(hostname))))).pipe(
            Effect.provide(Roster.layer([studio]))
          )
      )

      assert.deepStrictEqual(found, [true, true, true, false])
    })
  )

  it.effect("knows nothing of other hostnames", () =>
    Effect.gen(function* () {
      const found = yield* nameFor("laptop")

      assert.deepStrictEqual(found, Option.none())
    })
  )

  it.effect("finds a machine by name", () =>
    Effect.gen(function* () {
      const roster = yield* Roster

      assert.strictEqual(
        Option.map(roster.find(MachineName.make("cube")), (m) => m.label).pipe(Option.getOrThrow),
        "Cube"
      )
      assert.isTrue(Option.isNone(roster.find(MachineName.make("laptop"))))
    }).pipe(Effect.provide(Roster.layer(machines)))
  )
})
