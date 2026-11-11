import { Option } from "effect"

export const harnesses = {
  agents: { label: "any harness that reads ~/.agents/skills (Codex, OpenCode, and others)", folder: ".agents/skills" },
  claude: { label: "Claude Code", folder: ".claude/skills" },
  opencode: { label: "OpenCode", folder: ".config/opencode/skills" },
  pi: { label: "Pi", folder: ".pi/agent/skills" }
} as const

export type Harness = keyof typeof harnesses

export const harnessNames = ["agents", "claude", "opencode", "pi"] as const

export const skillFolder = (home: string, harness: Harness): string => `${home}/${harnesses[harness].folder}/sth-seat`

export type SkillsFolder = {
  readonly folder: string
  readonly resolved: string
  readonly linkedSkills: number
}

export const rebuiltWarning = (skills: SkillsFolder): Option.Option<string> => {
  const linked = skills.resolved !== skills.folder
  if (!linked && skills.linkedSkills === 0) return Option.none()
  const where = linked
    ? `${skills.folder} is a link to ${skills.resolved}`
    : `${skills.folder} holds skills linked in from elsewhere`

  return Option.some(
    `Warning: ${where}, so a dotfiles tool may rebuild it and remove this skill. Keep the skill where that tool assembles from instead (\`sth-seat skill > <that folder>/sth-seat/SKILL.md\`).`
  )
}

export const skillMarkdown = (version: string): string => `---
name: sth-seat
description: Show the user things on the machine they are sitting at, and work on the user's other machines without ssh. Use when you have a link, a local dev server, a report or other file the user should look at; when the user should be told something soon; when you need a secret (a token, a password) from them; or when you need to run a command or copy a file on another of their machines that runs sth-seat.
---

# sth-seat (${version})

The user has several machines and sits at one of them, the seat. You may be running on another. \`sth-seat\` puts what you show them on the seat, and lets you work on their other machines the way ssh would, limited by each machine's own policy.

Run \`sth-seat doctor\` first if anything below fails; it says what isn't set up and how to fix it.

## Show the user a page or a file

\`\`\`sh
sth-seat open https://example.com/pull/42
sth-seat open http://localhost:5173/                # a dev server here opens on the seat, through a tunnel
sth-seat open ./report.html --title "Load test results"
sth-seat open --reveal ./dist/app.dmg               # copied there and shown selected in Finder / the file manager
\`\`\`

- Use this instead of \`open\`, \`xdg-open\` or printing a path: those show it on this machine, where the user may not be.
- A localhost URL opens on the seat through a tunnel to this machine, so the server can stay on 127.0.0.1.
- A file is copied to the seat and opened there (into Handoff on macOS). One file, up to 32 MB; make HTML self-contained.
- Always pass \`--title\` for a file: a short description of what it is, not the file name.
- Add \`--reveal\` when the user should find the file rather than read it (an installer, an archive, a folder of output): it lands in the seat's sth-seat inbox and is shown selected in Finder or the file manager instead of opened.

## Tell the user something

\`\`\`sh
sth-seat notify "The release build failed on the lint step." --title "Release build"
\`\`\`

Only for what they should know soon: a long job finished or failed, a decision they need to make. Never for routine progress.

## Ask the user for a secret

\`\`\`sh
path=$(sth-seat ask-secret api-token "API token for the staging deploy?")
\`\`\`

The user types it into a hidden prompt on the seat (on this machine itself when its policy says \`secrets: here\`). It is written to a mode-600 file on this machine and only the path is printed. Read it from that file where it is needed (\`--token-file "$path"\`, \`$(cat "$path")\` inside the command that uses it). Never print it, echo it or put it in the conversation.

## Work on another machine

\`\`\`sh
sth-seat where                                  # which machine is the seat, and which are connected
sth-seat run desktop -- make test               # like ssh desktop 'make test'
sth-seat run -n desktop --cwd ~/code/app -- git status
sth-seat cp desktop:~/logs/app.log ./app.log
sth-seat cp ./build.tar desktop:/tmp/build.tar
\`\`\`

- \`run\` uses the other machine's login shell, streams its output, and exits with its exit code. Add \`-n\` when the command reads no input. \`--timeout <seconds>\` (default 600) stops it.
- Each machine decides what others may do there (\`~/.config/sth-seat/policy.yaml\`). A refusal says what was refused and why; don't retry it another way, tell the user.
- Everything you run is logged on the machine it ran on (\`sth-seat log\` there).

## Output for scripts

\`where\`, \`open\`, \`notify\`, \`ask-secret\`, \`cp\`, \`log\` and \`doctor\` take \`--json\`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | sth-seat couldn't do it (not set up, hub unreachable, refused by the hub); the message says why |
| 124 | \`run\`: the command was stopped at its timeout |
| 127 | \`run\`: the shell couldn't start there |
| 255 | \`run\` or \`cp\`: the other machine refused or the link failed; the message says why |
| other | \`run\`: the remote command's own exit code |
`
