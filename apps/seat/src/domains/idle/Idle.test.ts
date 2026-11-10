import { assert, describe, it } from "@effect/vitest"
import { DateTime, Option } from "effect"
import { afterLine, idleAt, idleFromIoreg, unknown } from "./Idle.ts"

const at = (millis: number) => DateTime.makeUnsafe(millis)

describe("idleFromIoreg", () => {
  it("reads HIDIdleTime nanoseconds as whole milliseconds", () => {
    const output = '    | |   "HIDIdleTime" = 27173893125\n    | |   "HIDIdleTime" = 1\n'

    assert.deepStrictEqual(idleFromIoreg(output), Option.some(27_173))
  })

  it("finds nothing in output without it", () => {
    assert.deepStrictEqual(idleFromIoreg("+-o IOHIDSystem"), Option.none())
  })
})

describe("swayidle lines", () => {
  it("doesn't count the first idle after starting as input, since the machine may have been idle for hours", () => {
    assert.deepStrictEqual(afterLine(unknown, "idle", at(60_000)), unknown)
  })

  it("counts idle time from the watcher's threshold before it said idle, and none once active", () => {
    const idled = afterLine(afterLine(unknown, "active", at(50_000)), "idle\n", at(60_000))
    const resumed = afterLine(idled, "active", at(90_000))

    assert.deepStrictEqual(idleAt(idled, at(70_000)), Option.some(15_000))
    assert.deepStrictEqual(idleAt(resumed, at(95_000)), Option.some(0))
  })

  it("knows nothing until the watcher has said something", () => {
    assert.deepStrictEqual(idleAt(unknown, at(1_000)), Option.none())
  })

  it("ignores lines it doesn't know", () => {
    const idled = afterLine({ _tag: "Active" }, "idle", at(60_000))

    assert.deepStrictEqual(afterLine(idled, "Failed to parse BlockInhibited", at(61_000)), idled)
  })

  it("never reports negative idle time", () => {
    assert.deepStrictEqual(idleAt({ _tag: "IdleSince", since: at(10_000) }, at(5_000)), Option.some(0))
  })
})
