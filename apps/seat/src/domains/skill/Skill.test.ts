import { assert, describe, it } from "@effect/vitest"
import { harnessNames, skillFolder, skillMarkdown } from "./Skill.ts"

describe("skill", () => {
  it("names every command an agent uses, so the guide can't drift from the CLI", () => {
    const markdown = skillMarkdown("1.2.3")

    assert.match(markdown, /^---\nname: sth-seat\ndescription: .+\n---\n/)
    assert.include(markdown, "# sth-seat (1.2.3)")
    assert.deepStrictEqual(
      ["open", "notify", "ask-secret", "where", "run", "cp", "log", "doctor", "--json"].filter(
        (command) => !markdown.includes(`sth-seat ${command}`) && !markdown.includes(`\`${command}\``)
      ),
      []
    )
  })

  it("installs into each harness's own skills folder", () => {
    assert.deepStrictEqual(
      harnessNames.map((harness) => skillFolder("/home/me", harness)),
      [
        "/home/me/.agents/skills/sth-seat",
        "/home/me/.claude/skills/sth-seat",
        "/home/me/.config/opencode/skills/sth-seat",
        "/home/me/.pi/agent/skills/sth-seat"
      ]
    )
  })
})
