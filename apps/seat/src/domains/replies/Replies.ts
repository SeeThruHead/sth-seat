import { Result } from "effect"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { Event, Reply, SessionId } from "@sth-seat/protocol/Remote.ts"

export type Expected = {
  readonly session: SessionId
  readonly from: MachineName
  readonly to: MachineName
  readonly seq: number
}

export const checkedReply = (reply: Reply, expected: Expected): Result.Result<Event, string> => {
  if (reply.session !== expected.session) return Result.fail("A reply belonged to another session; stopping.")
  if (reply.from !== expected.from) return Result.fail(`A reply came from ${reply.from}, not ${expected.from}.`)
  if (reply.to !== expected.to) return Result.fail(`A reply was meant for ${reply.to}.`)
  if (reply.seq !== expected.seq) return Result.fail("A reply arrived out of order; stopping.")

  return Result.succeed(reply.event)
}
