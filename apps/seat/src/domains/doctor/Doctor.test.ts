import { assert, describe, it } from "@effect/vitest"
import { fail, healthy, lineOf, ok, toolCheck, warn } from "./Doctor.ts"

describe("doctor", () => {
  it("is healthy with warnings but not with a failure, and marks each line by status", () => {
    const warned = [ok("key", "laptop"), warn("policy", "no file")]

    assert.isTrue(healthy(warned))
    assert.isFalse(healthy([...warned, fail("hub", "unreachable")]))
    assert.deepStrictEqual([...warned, fail("hub", "unreachable")].map(lineOf), [
      "ok    key: laptop",
      "warn  policy: no file",
      "FAIL  hub: unreachable"
    ])
  })

  it("warns about a missing tool and says what it's for", () => {
    assert.deepStrictEqual(
      toolCheck("zenity", false, "secret prompts use it"),
      warn("zenity", "not on PATH; secret prompts use it")
    )
    assert.deepStrictEqual(toolCheck("zenity", true, "secret prompts use it"), ok("zenity", "found"))
  })
})
