import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { harnessNames, rebuiltWarning, skillFolder, skillMarkdown } from "./Skill.ts"

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

  it("warns when the skills folder is a link or is assembled from links, since a dotfiles tool may rebuild it", () => {
    const linked = rebuiltWarning({
      folder: "/home/me/.claude/skills",
      resolved: "/home/me/.agents/skills",
      linkedSkills: 0
    })
    const assembled = rebuiltWarning({
      folder: "/home/me/.agents/skills",
      resolved: "/home/me/.agents/skills",
      linkedSkills: 3
    })
    const plain = rebuiltWarning({
      folder: "/home/me/.claude/skills",
      resolved: "/home/me/.claude/skills",
      linkedSkills: 0
    })

    assert.include(
      Option.getOrElse(linked, () => ""),
      "/home/me/.claude/skills is a link to /home/me/.agents/skills"
    )
    assert.include(
      Option.getOrElse(assembled, () => ""),
      "holds skills linked in from elsewhere"
    )
    assert.isTrue(Option.isNone(plain))
  })
})
