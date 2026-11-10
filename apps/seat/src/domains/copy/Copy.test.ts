import { assert, describe, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { copyPlan, spotOf } from "./Copy.ts"

const desktop = MachineName.make("desktop")

describe("spotOf", () => {
  it("reads machine:path, and treats anything else as a local path", () => {
    assert.deepStrictEqual(spotOf("desktop:~/a.txt"), { machine: Option.some(desktop), path: "~/a.txt" })
    assert.deepStrictEqual(
      ["./a.txt", "C:/a.txt", "a-very-long-machine-name-over-thirty-two:x"].map((raw) => spotOf(raw).machine),
      [Option.none(), Option.none(), Option.none()]
    )
  })
})

const summary = (from: string, to: string) =>
  Result.match(copyPlan(from, to), {
    onFailure: (reason) => [reason],
    onSuccess: (plan) => [plan.direction, plan.machine, plan.remote, plan.local]
  })

describe("copyPlan", () => {
  it("downloads from a machine:path and uploads to one", () => {
    assert.deepStrictEqual(summary("desktop:~/log.txt", "./log.txt"), ["download", "desktop", "~/log.txt", "./log.txt"])
    assert.deepStrictEqual(summary("./log.txt", "desktop:/tmp/log.txt"), [
      "upload",
      "desktop",
      "/tmp/log.txt",
      "./log.txt"
    ])
  })

  it("needs exactly one remote side, with a path that starts at / or ~", () => {
    const oneSide = Result.fail("One side of sth-seat cp is machine:path and the other a local path.")

    assert.deepStrictEqual(copyPlan("a.txt", "b.txt"), oneSide)
    assert.deepStrictEqual(copyPlan("desktop:/a", "laptop:/b"), oneSide)
    assert.deepStrictEqual(
      copyPlan("desktop:logs/a.txt", "."),
      Result.fail("logs/a.txt needs to start with / or ~/ on desktop.")
    )
  })
})
