import { assert, describe, it } from "@effect/vitest"
import { DateTime, HashMap, Result } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { EnvelopeId, SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Envelope } from "@sth-seat/protocol/Remote.ts"
import { admit } from "./Admission.ts"

const cube = MachineName.make("cube")

const now = DateTime.makeUnsafe(1_000_000)

const envelope: Envelope = {
  id: EnvelopeId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e61"),
  session: SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60"),
  from: MachineName.make("tower"),
  to: cube,
  issuedAt: 1_000_000,
  request: { _tag: "Cancel" }
}

const arrival = { me: cube, now, seen: HashMap.empty<string, DateTime.Utc>() }

describe("admit", () => {
  it("lets in a fresh command for this machine once, and remembers it", () => {
    const first = admit(envelope, arrival)
    const again = Result.isSuccess(first) ? admit(envelope, { ...arrival, seen: first.success }) : first

    assert.isTrue(Result.isSuccess(first))
    assert.deepStrictEqual(again, Result.fail("The command was already run once."))
  })

  it("turns away a command meant for another machine, or older than a minute", () => {
    assert.deepStrictEqual(
      admit({ ...envelope, to: MachineName.make("tower") }, arrival),
      Result.fail("The command was meant for tower.")
    )
    assert.deepStrictEqual(
      admit({ ...envelope, issuedAt: 900_000 }, arrival),
      Result.fail("The command is too old or from the future; check the clocks.")
    )
  })
})
