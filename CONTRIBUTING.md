# Contributing

Thanks for wanting to help. Read `AGENTS.md` first: it covers how the code is laid out, what the linter enforces
and what reviewers check, and it applies to people as much as to agents.

## Set up

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install       # also patches the Effect language service into tsc and oxlint, and installs the git hooks
bun run check     # typecheck, lint, format check and tests for every project
```

## While you work

- Each project has `typecheck`, `lint`, `format`, `format:check` and `test` scripts; `bun run moon run seat:check`
  runs one project's checks. A warm `bun run check` takes under a second and a cold one a few seconds; keep it
  that way.
- Tests assert what a caller can see, and each one should fail if the behaviour it guards breaks. `bun run mutate`
  in an app runs mutation testing on its logic.
- Try a change against a local hub and two throwaway machine folders, never against a hub people use; `AGENTS.md`
  shows how.
- The daemon protocol only grows: new fields are optional, nothing is renamed or removed, and
  `packages/protocol/fixtures/v1.json` must keep decoding, because machines may run older versions than the hub.

## Pull requests

One change per pull request, with a description of what changes for someone using sth-seat. The hooks run the
format check, lint and typecheck before each commit and the tests before each push.
