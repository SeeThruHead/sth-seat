# Architecture

## The pieces

- Each machine runs `sth-seat daemon`, which dials the hub over Effect RPC on a WebSocket at `/daemon`, signs in
  with its own key, reports how long the machine has been idle, opens what the hub sends, and runs what other
  machines ask of it when its own policy allows.
- Agents reach the hub's MCP endpoint at `/mcp`, directly or through an MCP router, with one bearer token.
- On a machine, `sth-seat open`, `where`, `notify` and `ask-secret` call the hub's RPCs, and `sth-seat run` and
  `sth-seat cp` start a session on another machine through the hub's `Relay` RPC. All of them sign in with the
  machine's key.

## Decisions

- **Functional core, imperative shell.** Every decision is a pure function over schema types, tested with plain
  values: which machine is the seat (`hub/domains/presence/Seat.ts`), what a target is and how a localhost URL
  tunnels (`hub/domains/targets/Target.ts`), what a policy allows (`seat/domains/policy/Policy.ts`), whether an
  incoming command is for this machine, fresh and new (`seat/features/remote/Admission.ts`), whether a reply is
  the one expected next (`seat/domains/replies/Replies.ts`), what `cp` means (`seat/domains/copy/Copy.ts`), idle
  state from swayidle and ioreg (`seat/domains/idle/Idle.ts`), the service files (`seat/domains/service`), the
  doctor's verdicts and the agent skill. Handlers gather inputs (files, clock, keys, links), ask those functions,
  and act; services exist only where something needs a lifecycle or swapping in tests.
- **One contract per action.** `packages/protocol/src/Actions.ts` declares each user action once (its request,
  what an agent adds, what a machine adds, success and failure); `Action.ts` builds the RPC and the MCP tool from
  it, and a lint rule keeps `Rpc.make`, `Tool.make` and their groups out of every other file.

- **The seat is the connected machine with the most recent input.** Each daemon sends its idle time; the hub
  stores "last input = now minus idle" per machine. No guessing from which app is focused or which screen is
  on: input is what tells where the user is sitting. A machine that is connected but has never reported input
  only wins when nothing else has.
- **Idle time from the OS, one layer per OS.** macOS: `ioreg -c IOHIDSystem` `HIDIdleTime`, polled every 10
  seconds. Linux (Hyprland and other Wayland compositors): `swayidle` watching the ext-idle-notify protocol with
  a 5-second threshold. Until the first real activity after the daemon starts, idle time is unknown and nothing
  is reported, so restarting the daemon on an unattended machine never takes the seat. The daemon finds the
  desktop's Wayland socket in `XDG_RUNTIME_DIR` itself, so it runs under the user manager (`default.target`)
  whether or not anyone is logged in to the desktop; with no desktop it reports no presence and refuses to open
  things, saying why.
- **Outbound daemons, reverse RPC.** No machine opens a port for sth-seat. `Attach` is a streaming RPC whose
  results are the hub's commands; the daemon answers each with `Answer`. One socket, one contract
  (`packages/protocol/src/Daemon.ts`), typed both ways.
- **Each machine decides what others may do there.** `~/.config/sth-seat/policy.yaml` pins the public keys of
  the machines it trusts (like `authorized_keys`) and lists rules: who (a machine name, `hub`, or `*` for any
  listed machine) may do what (`shell`, `read`, `write`, `tunnel`, `receive`), and in which folders (`read` and
  `write` default to the home folder). Anything not listed is refused by the daemon itself, whatever the hub
  says. A missing file means "the hub may deliver pages and files, nothing else". A file that doesn't parse
  means "refuse everything until fixed". `sth-seat lock` refuses everything until `sth-seat unlock`.
- **The hub routes; it can't forge.** Every command one machine sends another is an envelope (`Remote.ts`:
  sender, recipient, session, id, time, request) signed with the sender's Ed25519 key. The hub checks the
  signature only to route; the recipient checks it again against the key its own policy pins, checks it is the
  recipient, that the envelope is under a minute old, and that its id hasn't been seen. Replies are signed by
  the recipient and numbered, and the caller checks them the same way. So a compromised hub can delay or drop
  calls but can't run anything or fake output. Commands the hub makes itself (opening pages, delivering files,
  reading a file for `open_for_user`, notifications, secret prompts) come from the caller `hub`, which policies
  treat like any other caller.
- **Shell is an agent tool between trusted machines.** `sth-seat run <machine> -- <command>` runs the command
  in the target user's login shell (`$SHELL -lc`), streams stdout and stderr back, passes stdin through (`-n` to
  skip), returns the remote exit code, stops after `--timeout` seconds (default 10 minutes), and kills the
  process group when the caller stops. A machine that should only receive things (a work laptop, say) grants
  nobody `shell`.
- **Files are copied only where a policy says so.** `sth-seat cp machine:path local` and the reverse stream the
  file in 512 KB chunks through the hub, written to a `.sth-seat-partial` file and renamed when complete. Paths
  are resolved (`~`, symlinks) on the machine that owns them before the policy's folders are checked.
- **A secret never reaches the agent.** `ask_user_secret` (and `sth-seat ask-secret`) shows a hidden-input
  prompt on the seat (`osascript display dialog ... with hidden answer` on macOS, `zenity --entry --hide-text`
  on Linux), and the hub hands the answer straight to the asking machine, which writes it to
  `~/.local/share/sth-seat/secrets/<name>` (folder 700, file 600). Only the path goes back to the agent. The
  value is a `Redacted` everywhere in the protocol, so it never shows up in logs, spans or the audit log; it
  passes through the hub's memory and the TLS connection, nothing else.
- **Some machines keep their secrets.** A machine whose policy says `secrets: here` never sends a secret request to
  the hub: `sth-seat ask-secret` prompts on its own desktop and writes the file itself, and its daemon refuses
  `StoreSecret`, so nothing typed on another machine and carried by the hub lands there either. The hub's
  `secrets: here` on that machine's entry refuses `ask_user_secret` and the `AskSecret` RPC for it before any seat
  is asked. Either side alone keeps the secret off the other machines; both are set so a mistake in one config
  doesn't leak.
- **Every call is logged where it ran.** `~/.local/state/sth-seat/audit.jsonl` has one line per command
  (caller, action, target, result); `sth-seat log` shows the newest.
- **One open handler, two transports.** `open_for_user` (MCP) and `Open` (RPC, used by the CLI) share the
  request schema in `packages/protocol/src/Actions.ts` and call the same handler. MCP callers say where they run
  with `from` (their hostname); RPC callers are known by their key. When `sth-seat open` sends a local file, it
  adds a grant signed by its own key, so the machine reads the file for the hub without a `read` rule for `hub`.
- **Files for the seat travel through the hub.** A file on one machine is read by that machine's daemon
  (`ReadFile`), sent to the seat (`ReceiveFile`), saved in the seat's inbox under the command's id, and opened
  there: through Handoff on macOS (`handoff <file> --title`), with `xdg-open` on Linux. When the seat is the
  machine the file is on, it is opened in place. Files are capped at 32 MB and must be regular files.
- **localhost URLs open through a tunnel to the machine they came from.** For `localhost`, `127.0.0.1`,
  `0.0.0.0`, `[::1]` and `*.localhost` from another machine, the hub sends the seat `OpenTunnel` (origin, scheme,
  port, path). The seat's daemon listens on `127.0.0.1` on a free port (one per origin and port, for as long as
  its link lasts) and opens `http://127.0.0.1:<that port><path>` in the browser. Each connection the browser
  makes becomes a `Tunnel` session signed by the seat to the origin, whose daemon connects to its own
  `127.0.0.1:<port>` and pipes bytes both ways, so HTTP and WebSockets (live reload) work and the dev server
  never has to listen on the network. The origin's policy needs `tunnel` for the seat. When the seat is the
  origin, the URL opens as it is.
- **Openers run detached.** On Linux `xdg-open` can stay attached to the browser it starts, so the daemon starts
  it in its own session, waits up to 3 seconds for an early failure (which it reports), and lets it run.
- **Run the hub on a network the machines share.** It's meant for a home or office network, or a VPN the
  machines share; nothing about it needs a public address. Put TLS in front of it (any reverse proxy), and don't
  put a login redirect in front of `/daemon` or `/mcp`: an SSO redirect breaks the WebSocket and MCP clients.
- **No shims.** sth-seat calls `open`, `xdg-open` and `handoff`; it never replaces them or sets `BROWSER`.
  Agents choose to deliver through `open_for_user`.
- **Auth.** Machines sign in with a hello (machine, time, nonce) signed by their key, checked against the public
  key in the hub's YAML; a hello is good for a minute and only once. The MCP endpoint takes one token, stored
  hashed in the YAML (SHA-256, base64url).
- **Scale.** One person, a handful of machines: presence, pending commands and relay sessions live in memory in
  the hub. A hub restart loses only "last input" times, which every daemon re-sends within 10 seconds of
  reconnecting, and any sessions running at the time.
