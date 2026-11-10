import { assert, describe, it } from "@effect/vitest"
import { Cause, Option, Schema } from "effect"
import { problemOf } from "./Problem.ts"

class Plain extends Schema.TaggedError<Plain, { readonly brand: unique symbol }>()("Plain", {}) {}

describe("problemOf", () => {
  it("is the error's own message when it has one", () => {
    assert.deepStrictEqual(problemOf(Cause.fail(new Error("hub unreachable"))), Option.some("hub unreachable"))
  })

  it("falls back to the whole cause when the error has no message, so nothing prints empty", () => {
    const shown = problemOf(Cause.fail(new Plain()))

    assert.isTrue(Option.exists(shown, (text) => text.includes("Plain")))
    assert.isTrue(Option.exists(problemOf(Cause.die("boom")), (text) => text.includes("boom")))
  })

  it("stays quiet when the program was only interrupted", () => {
    assert.deepStrictEqual(problemOf(Cause.interrupt()), Option.none())
  })
})
