# sth-seat

Makes all of a person's machines act like the one they are sitting at. A hub knows when each machine last saw
keyboard or mouse input; the machine with the most recent input is the seat. Coding agents call the hub's MCP
tools (`open_for_user`, `where_is_user`, `notify_user`, `ask_user_secret`), and a small daemon on every machine
opens what the hub sends. Machines also run commands and copy files on each other (`sth-seat run`,
`sth-seat cp`) in place of ssh, and send each other messages (`sth-seat send`, `sth-seat inbox`), signed with each machine's key and allowed only by the target's own policy.
Read `README.md` for what it is and how to set it up, and `docs/architecture.md` for the decisions.

| Path | What |
| --- | --- |
| `packages/protocol` | what hub and daemons agree on: ids (`Ids.ts`), one contract per user action (`Actions.ts`) from which `Action.ts` builds both its RPC and its MCP tool, the daemon RPC (`Daemon.ts`), machine keys (`Keys.ts`), signed messages (`Sealed.ts`, `Hello.ts`, `Freshness.ts`) and the commands machines send each other (`Remote.ts`) |
| `packages/lint` | the house lint rules (an oxlint JS plugin, tested with fixtures), the coverage reporter and the commit-msg attribution check |
| `apps/hub` | the server: presence, links to daemons, the open/where/notify/secret handlers, relaying signed commands between machines, MCP at `/mcp`, daemon socket at `/daemon` |
| `apps/seat` | one bundle for every machine: `sth-seat daemon`, `open`, `where`, `notify`, `ask-secret`, `run`, `cp`, `send`, `inbox`, `key`, `lock`, `unlock`, `log`, `doctor`, `skill`; commands live in `src/app/cli/`, one module per group, and the skill text agents read is `src/domains/skill/Skill.ts` (a test keeps it naming every command) |

## Commands

- Each command is a package script; moon wraps them. `bun run moon run hub:check` runs a project's typecheck,
  lint, format check and tests. `bun run check` runs every project.
- Coverage is measured against a bar of 100% (`packages/lint/coverage.ts`, shared by every vitest config), but
  a shortfall never fails a run: it prints "Coverage warning" naming each file and metric under the bar, and in
  CI also a `::warning::` line. Failing tests still fail. When you see the warning, add the missing tests.
- Hub locally: `CONFIG_FILE=<yaml> PORT=3191 bun src/app/server.ts` in `apps/hub`. The YAML is the shape of
  `HubSettings` (`apps/hub/src/app/HubSettings.ts`; an example is in `README.md`).
- Daemon locally against a test hub: `HOME=<test home> SEAT_CONFIG_DIR=<dir> SEAT_STATE_DIR=<dir>
  SEAT_HUB_URL=ws://127.0.0.1:3191/daemon bun src/app/main.ts daemon` in `apps/seat`, after `key --name` with
  the same `SEAT_CONFIG_DIR`. A second config dir with its own key plays the other machine for `run` and `cp`.
  Put fake `xdg-open`/`open`/`handoff` scripts first on `PATH` (and `SEAT_HANDOFF=<fake>` on macOS) so nothing
  opens on the real screen. Never test against a hub people are using.
- Release: `bun run release` in `apps/seat` compiles `dist/release/sth-seat-{linux,darwin}-{x64,arm64}` (Bun's
  `--compile`, cross-compiled from any machine). `sth-seat install` installs and (re)starts the user
  service: run from Homebrew it points the service at `$(brew --prefix)/bin/sth-seat` and copies nothing,
  otherwise it copies the running binary to `~/.local/bin/sth-seat` first; service files come from
  `src/domains/service/Service.ts`. `bun run bundle` still writes `dist/sth-seat.js` for running under Bun.
- Mutation testing: `bun run mutate` in `apps/hub` or `apps/seat` (Stryker's command runner, so the suites run
  under Bun; it mutates `src/domains` and `src/features` in place, one mutant at a time, and restores them).
  It takes 10-20 minutes: run it in the background, never two at once, and don't edit that app's source or
  commit meanwhile (the pre-commit hook would check a mutant). The report lands in `reports/mutation/mutation.json`.
- Upgrading machines: install a new daemon before adding a policy capability name it introduced. An older
  daemon can't read the policy and refuses everything, including the command that would restart it.

## How it starts

- Hub: `apps/hub/src/app/server.ts` reads env (`PORT`, `CONFIG_FILE`, `REVISION`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`), decodes the YAML, then serves `/healthz`, `/mcp` (one bearer token, for the
  MCP client or router) and `/daemon` (Effect RPC over a WebSocket; every call carries a hello signed by the
  machine's key). `Definition.ts` builds the routes; tests serve the same routes.
- Daemon: `sth-seat daemon` reads the hub URL from `SEAT_HUB_URL` or `~/.config/sth-seat/hub` (written by
  `sth-seat key --hub`), `SEAT_CONFIG_DIR` (default `~/.config/sth-seat`: `key`, `name`, `hub`,
  `policy.yaml`), `SEAT_STATE_DIR` (default `~/.local/state/sth-seat`: `audit.jsonl`, `locked`), `SEAT_INBOX`
  (default `~/.local/share/sth-seat/inbox`), `SEAT_HANDOFF` (default `handoff`) and `SHELL`, then keeps one
  link to the hub alive, reconnecting with backoff.

## Architecture in short

- The hub never connects to machines. A daemon calls `Attach`, a streaming RPC whose results are the hub's
  commands (`OpenUrl`, `OpenFile`, `ReadFile`, `ReceiveFile`, `OpenTunnel`, `Notify`, `AskSecret`,
  `StoreSecret`, and `Relayed`/`Abort` for other machines' sessions); it answers each with `Answer` or `Reply`
  and reports its idle time with `Presence` every 10 seconds.
- `sth-seat run` and `cp` call `Relay` (a stream of the target's sealed replies) and `RelayMore` (input). The
  target verifies each envelope against its own policy in `features/remote/handler.ts`; the hub only routes.
- `features/open/handler.ts` is the one place that decides what opening means: classify the target, pick the
  seat, open a localhost URL from another machine through a tunnel to it, or fetch a file from the machine it is
  on and hand it to the seat. MCP (`app/Mcp.ts`) and the daemon RPC (`app/DaemonHandlers.ts`) both call it.
- Hub domains (`links`, `presence`, `relays`, `roster`, `targets`) never import each other; handlers in
  `features/` orchestrate them. On the seat side, only `src/platform/` starts processes (`open`, `handoff`,
  `xdg-open`, `osascript`, `notify-send`, `zenity`, `ioreg`, `swayidle`, the shell), one layer per OS.

## What the linter enforces

`packages/lint`: no loops, `let`, mutation, casts, comments, nested ifs or multi-line `&&`/`||`; `Date`,
`Math.random` and `crypto.randomUUID` banned for Clock and SecureRandom; `Effect.run*` only in
`src/app/main.ts`, `src/app/server.ts` and hooks; no function that only wraps `Effect.gen`; apps don't import
each other; domains don't import each other; only `src/platform/` may start processes; `handler.ts` files don't
import transports; `packages/protocol` imports no platform code; `Rpc.make`, `RpcGroup.make`, `Tool.make` and
`Toolkit.make` appear only in `packages/protocol/src/Action.ts`. Plus the Effect language service rules, run on tsrs
(`effect-tsgo --tsrs-lint oxlint`), with the few left off listed in `packages/lint/oxlintrc.json`. Typecheck is
`effect-tsgo tsrs` (the Rust TypeScript port, 7.1 beta semantics, shipped inside `@effect/tsgo`); nothing in
`node_modules` is patched.

## What reviewers check instead

- No shims: sth-seat never replaces `open`, `xdg-open` or `handoff` and never sets `BROWSER`.
- Nothing personal in the repo: no person's name, hostnames, addresses, domains, keys or tokens. Examples use
  placeholders (`seat.example.com`, `desktop`, `laptop`); real values live in each deployment's config and on
  each machine.
- The CLI talks only to its own daemon (`app/LocalClient.ts` to `app/LocalServer.ts`); only the daemon reads the
  key and talks to the hub. A stopped daemon makes every command fail with "sth-seat is off".
- Daemons connect out only, run as the normal user, and sign in with their own key; the hub keeps only public
  keys. The MCP endpoint takes only its one token.
- A machine does only what its own `policy.yaml` allows, checked on that machine; nothing the hub sends widens
  it. Commands between machines are signed by the sender and checked by the receiver (signature, recipient, age,
  replay); replies are signed and numbered. Every call is in the receiver's audit log.
- A secret from `ask_user_secret` never reaches the agent: it is `Redacted` in the protocol, written to a
  mode-600 file on the asking machine, and only the path goes back.
- The receiving machine decides what it lets in: each delivery is a capability (`open-url`, `open-file`, `reveal`,
  `notify`, `ask-secret`, `store-secret`, `open-tunnelled-page`; `receive` is all of them), checked on that machine.
- The seat opens only `http(s)` links, by naming the default browser (never `open`/`xdg-open` on a link), and only
  document files, never anything the system opener would run; it doesn't rely on the hub's checks for either.
- A machine with `secrets: here` (its policy, and its entry in the hub's config) keeps its secrets: `ask-secret`
  prompts on it without the hub, its daemon refuses `StoreSecret`, and the hub refuses secret requests from it.
- Each machine has a hub `side`; open, notify and secret prompts go only to a machine on the caller's side, and
  never to another machine when the caller's own daemon is offline (the CLI opens locally instead). Deliveries
  carry `origin`, and a policy's `deliveries: from:` refuses any for a machine not listed.
- A file sent to the seat (`open`) goes only to the seat, at most 32 MB, regular files only, into its own inbox
  folder. `cp` paths are resolved (`~`, symlinks) on the owning machine before its policy's folders are checked.
- Daemon protocol schemas only grow: new fields optional, nothing renamed or removed (daemons may be older than
  the hub). `packages/protocol/fixtures/v1.json` must keep decoding.
- Every external wait has a timeout (commands 15-60 s, processes 5-15 s, socket open 10 s, a secret prompt
  3 minutes).
