import { assert, describe, it } from "@effect/vitest"
import { DateTime, Option } from "effect"
import { MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"
import { ago, nobodyConnected, seatOf, whereaboutsOf } from "./Seat.ts"
import type { Sighting } from "./Seat.ts"

const at = (seconds: number) => DateTime.makeUnsafe(seconds * 1000)

const sighting = (name: string, online: boolean, lastInput?: number): Sighting => ({
  name: MachineName.make(name),
  label: MachineLabel.make(name.toUpperCase()),
  online,
  lastInput: lastInput === undefined ? Option.none() : Option.some(at(lastInput))
})

const seatName = (sightings: ReadonlyArray<Sighting>) => Option.map(seatOf(sightings), (found) => found.name)

describe("seatOf", () => {
  it("is the connected machine with the most recent input", () => {
    assert.deepStrictEqual(
      seatName([sighting("mac", true, 100), sighting("dev", true, 200), sighting("laptop", false, 300)]),
      Option.some(MachineName.make("dev"))
    )
  })

  it("prefers a machine with input over one with none, and the first listed on a tie", () => {
    assert.deepStrictEqual(
      seatName([sighting("mac", true), sighting("dev", true, 5)]),
      Option.some(MachineName.make("dev"))
    )
    assert.deepStrictEqual(
      seatName([sighting("mac", true, 5), sighting("dev", true)]),
      Option.some(MachineName.make("mac"))
    )
    assert.deepStrictEqual(
      seatName([sighting("mac", true, 5), sighting("dev", true, 5)]),
      Option.some(MachineName.make("mac"))
    )
    assert.deepStrictEqual(
      seatName([sighting("mac", true), sighting("dev", true)]),
      Option.some(MachineName.make("mac"))
    )
  })

  it("is nobody when no machine is connected", () => {
    assert.deepStrictEqual(seatName([sighting("mac", false, 100)]), Option.none())
  })
})

describe("ago", () => {
  it("rounds down to the largest whole unit", () => {
    assert.deepStrictEqual([0, 59, 60, 3599, 3600, 86_399, 86_400, 200_000].map(ago), [
      "0s ago",
      "59s ago",
      "1 min ago",
      "59 min ago",
      "1 h ago",
      "23 h ago",
      "1 days ago",
      "2 days ago"
    ])
  })
})

describe("whereaboutsOf", () => {
  it("names the seat first and says how long since each machine saw input", () => {
    const found = whereaboutsOf(
      [sighting("mac", true, 940), sighting("dev", true, 997), sighting("laptop", false)],
      at(1000)
    )

    assert.strictEqual(found.seat, MachineName.make("dev"))
    assert.deepStrictEqual(
      found.machines.map((machine) => [String(machine.name), machine.seat, machine.idleSeconds]),
      [
        ["mac", false, 60],
        ["dev", true, 3],
        ["laptop", false, undefined]
      ]
    )
    assert.strictEqual(
      found.message,
      "The user is at DEV (last input 3s ago). MAC: connected, last input 1 min ago. LAPTOP: not connected, no input seen yet."
    )
  })

  it("says nobody is connected when no machine is", () => {
    const found = whereaboutsOf([sighting("mac", false, 400)], at(1000))

    assert.isUndefined(found.seat)
    assert.strictEqual(found.message, `${nobodyConnected} MAC: not connected, last input 10 min ago.`)
  })

  it("never reports negative idle time for input stamped after now", () => {
    assert.strictEqual(whereaboutsOf([sighting("mac", true, 1005)], at(1000)).machines[0]?.idleSeconds, 0)
  })
})
