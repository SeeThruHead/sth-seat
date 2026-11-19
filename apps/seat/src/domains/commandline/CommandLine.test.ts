import { assert, describe, it } from "@effect/vitest"
import { commandLine } from "./CommandLine.ts"

describe("commandLine", () => {
  it("leaves a single argument as it is, for the other machine's shell to read", () => {
    assert.strictEqual(commandLine(["cd ~/code && ls *.md | wc -l"]), "cd ~/code && ls *.md | wc -l")
  })

  it("keeps each of several arguments as one word, whatever it holds", () => {
    assert.strictEqual(commandLine(["make", "test"]), "'make' 'test'")
    assert.strictEqual(
      commandLine(["sh", "-c", "for n in 1 2; do echo $(hostname) $n; done"]),
      "'sh' '-c' 'for n in 1 2; do echo $(hostname) $n; done'"
    )
    assert.strictEqual(commandLine(["echo", "it's", ""]), `'echo' 'it'\\''s' ''`)
  })
})
