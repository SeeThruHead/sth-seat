import { Console, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { harnessNames, harnesses, rebuiltWarning, skillFolder, skillMarkdown } from "../../domains/skill/Skill.ts"
import { settings } from "./Settings.ts"

const installFlag = Flag.Literals("install", harnessNames).pipe(
  Flag.withDescription(
    "Install the skill for a harness: agents (~/.agents/skills: Codex, OpenCode and others), claude, opencode or pi"
  ),
  Flag.optional
)

const dirFlag = Flag.String("dir").pipe(
  Flag.withDescription("Install the skill into this skills folder instead (it creates sth-seat/SKILL.md there)"),
  Flag.optional
)

const written = Effect.fnUntraced(function* (folder: string, markdown: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(folder, "SKILL.md")
  yield* fs.makeDirectory(folder, { recursive: true })
  yield* fs.writeFileString(file, markdown)

  return file
})

const skillsFolderAt = Effect.fnUntraced(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const resolved = yield* fs.realPath(folder).pipe(Effect.orElseSucceed(() => folder))
  const names = yield* fs.readDirectory(resolved).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
  const links = yield* Effect.forEach(names, (name) =>
    fs.readLink(path.join(resolved, name)).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    )
  )

  return { folder, resolved, linkedSkills: links.filter(Boolean).length }
})

export const skillCommand = (version: string) =>
  Command.make(
    "skill",
    { install: installFlag, into: dirFlag },
    Effect.fn("Cli.skill")(function* ({ install, into }) {
      const found = yield* settings
      const path = yield* Path.Path
      const markdown = skillMarkdown(version)
      const folder = Option.orElse(
        Option.map(into, (dir) => path.join(dir, "sth-seat")),
        () => Option.map(install, (harness) => skillFolder(found.home, harness))
      )
      if (Option.isNone(folder)) return yield* Console.log(markdown)

      const skills = yield* skillsFolderAt(path.dirname(folder.value))
      const file = yield* written(folder.value, markdown)
      const whom = Option.match(install, { onNone: () => "that folder", onSome: (harness) => harnesses[harness].label })
      yield* Console.log(`Installed the sth-seat skill for ${whom}: ${file}`)

      yield* Option.match(rebuiltWarning(skills), { onNone: () => Effect.void, onSome: Console.error })
    })
  ).pipe(
    Command.withDescription(
      "Print the agent skill that explains sth-seat to coding agents, or install it with --install or --dir"
    )
  )
