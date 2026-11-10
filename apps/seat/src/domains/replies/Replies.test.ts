import { assert, describe, it } from "@effect/vitest"
import { Result } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { SessionId } from "@sth-seat/protocol/Remote.ts"
import type { Reply } from "@sth-seat/protocol/Remote.ts"
import { checkedReply } from "./Replies.ts"

const desktop = MachineName.make("desktop")

const laptop = MachineName.make("laptop")

const session = SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60")

const reply: Reply = { session, seq: 2, from: desktop, to: laptop, issuedAt: 1, event: { _tag: "Exited", code: 0 } }

const expected = { session, from: desktop, to: laptop, seq: 2 }

describe("checkedReply", () => {
  it("passes on the event of the reply that was expected next", () => {
    assert.deepStrictEqual(checkedReply(reply, expected), Result.succeed({ _tag: "Exited", code: 0 }))
  })

  it("stops on a reply for another session, from another machine, for another machine, or out of order", () => {
    assert.deepStrictEqual(
      [
        checkedReply({ ...reply, session: SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e61") }, expected),
        checkedReply({ ...reply, from: laptop }, expected),
        checkedReply({ ...reply, to: desktop }, expected),
        checkedReply({ ...reply, seq: 3 }, expected)
      ],
      [
        Result.fail("A reply belonged to another session; stopping."),
        Result.fail("A reply came from laptop, not desktop."),
        Result.fail("A reply was meant for desktop."),
        Result.fail("A reply arrived out of order; stopping.")
      ]
    )
  })
})
