# sth-seat

Makes all of your machines act like the one you're sitting at.

Coding agents often run on a different machine from the one you're using: a desktop or a dev box while you
sit at a laptop. When an agent shows you something (a link, a dev server, a report, a notification, a
password prompt), it lands on the machine the agent runs on, where nobody is looking. And when an agent on one
machine needs to work on another, it reaches for ssh with full access.

sth-seat fixes both:

- A small **hub** knows which of your machines you used last (the **seat**), from keyboard and mouse idle time.
- A **daemon** on every machine opens what the hub sends: a URL in the browser, a file (into Handoff on macOS),
  a notification, a hidden secret prompt.
- Agents use it through **MCP tools**: `open_for_user`, `where_is_user`, `notify_user` and `ask_user_secret`.
- A **localhost URL** from another machine opens on the seat through a tunnel, so a dev server can stay on
  `127.0.0.1` and live reload still works.
- Machines **run commands and copy files on each other** (`sth-seat run`, `sth-seat cp`) instead of using ssh.
  Each command is signed by the sending machine and allowed only by the receiving machine's own policy, so a
  laptop can accept pages and files from your other machines without letting them run anything.
- Machines **send each other messages** (`sth-seat send`, `sth-seat inbox`): requests for the agent or person on
  the other machine, never commands. A machine whose policy takes messages but allows no shell can still be asked
  for things.

It runs on macOS and Linux (Wayland compositors such as Hyprland). Windows is not supported.

## How it works

Daemons connect out to the hub over a WebSocket; no machine opens a port. Each machine has an Ed25519 key pair,
and the hub's config lists only public keys. Commands between machines are signed by the sender and checked by
the receiver against the key its own policy pins, so the hub routes them but can't make them up or fake their
output. See `docs/architecture.md` for every decision.

## Set up the hub

The hub is one Bun process with a YAML config. Run it somewhere all your machines can reach (a home server, a
VPN), behind a reverse proxy that terminates TLS. Don't put a login redirect in front of `/daemon` or `/mcp`.

```sh
docker run -d -p 3000:3000 -v "$PWD/sth-seat.yaml:/config/sth-seat.yaml:ro" ghcr.io/seethruhead/sth-seat-hub:latest
```

Each release publishes the image as `ghcr.io/seethruhead/sth-seat-hub:<tag>` (linux/amd64); pin its digest for
deploys. To build it yourself: `docker build -f apps/hub/Dockerfile -t sth-seat-hub .` from the repo root.

Or without Docker: `bun install`, then `CONFIG_FILE=sth-seat.yaml PORT=3000 bun src/app/server.ts` in
`apps/hub`.

`sth-seat.yaml`:

```yaml
# base64url(sha256(token)) of the bearer token your MCP client or router sends to /mcp
mcpTokenHash: <hash>
machines:
  - name: desktop                  # lowercase; what other machines call it
    label: Desktop                 # shown in messages
    hostnames: [my-desktop]        # what `hostname` prints there; agents pass it as `from`
    publicKey: <from sth-seat key>
  - name: laptop
    label: Laptop
    hostnames: [my-laptop]
    publicKey: <from sth-seat key>
    secrets: here                  # optional: secrets asked from this machine stay on it (see below)
```

To make the MCP token and its hash:

```sh
token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
printf %s "$token" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
```

## Add a machine

1. Get the `sth-seat` binary for the machine. With Homebrew (macOS or Linux):
   `brew install seethruhead/tap/sth-seat`. Or download `sth-seat-<os>-<arch>` (`linux-x64`, `linux-arm64`,
   `darwin-arm64`, `darwin-x64`) from the GitHub release, or build all four with
   `bun install && bun run release` in `apps/seat` (they land in `apps/seat/dist/release/`). It needs nothing
   else installed. On Linux the desktop features also want `swayidle` (idle time), `xdg-open`, `notify-send`,
   `zenity` and `gdbus` (to show a file in the file manager).
   On macOS, secret prompts use a program named `herdr-secret` when one is on the daemon's PATH (`~/.local/bin`
   is on it), and the built-in hidden dialog otherwise. sth-seat runs it as
   `herdr-secret --stdout --machine <label> --file <path> -- <name> <question>`, with `HERDR_SECRET_WAIT` set to
   the seconds it may wait. It prints the answer and exits 0, exits 1 when the user cancels, or exits 3 when it
   can't ask (then sth-seat shows its own dialog). Every prompt says which machine the secret goes to and the
   file it will be saved in.

2. Make the machine's key and save the hub's address:

   ```sh
   sth-seat key --name laptop --hub wss://seat.example.com/daemon
   ```

   It prints the public key. Add it to the hub's `sth-seat.yaml` and restart the hub.

3. Write `~/.config/sth-seat/policy.yaml` (mode 600). It pins the keys of the machines this one trusts and says
   what each may do here:

   ```yaml
   machines:
     desktop: <desktop's public key>
   allow:
     - from: [desktop]
       can: [shell, read, write, tunnel, receive]
     - from: [hub]
       can: [receive, read]
       folders: ["~"]
   ```

   Capabilities are `shell` (run commands), `read` and `write` (files, limited to `folders`, default `~`),
   `tunnel` (reach this machine's localhost ports) and `receive` (everything the hub delivers). `receive` is
   short for five finer ones, which a rule can name instead: `url` (open a web address), `file` (show a file sent
   here), `notify` (show a notification), `page` (open another machine's localhost page through a tunnel) and
   `secret` (prompt for a secret, or store one asked for here). Anything not listed is refused. With no policy
   file, only the hub may deliver things. A machine that should take things in without anything leaving it, such
   as a work laptop, lists `- from: [hub]` with `can: [file, url, notify]`: a tunnelled page carries data both
   ways while it is open and a secret's answer leaves the machine, so both are refused there, with a message
   saying why.

   `messages` (a top-level key next to `allow`) says which machines may send this one messages, separately from
   what they may run:

   ```yaml
   messages:
     from: [desktop]       # or ["*"] for every machine listed under machines
     clipboard: true       # also put each message on the clipboard, ready to paste
   ```

   A message lands in this machine's inbox (`~/.local/state/sth-seat/messages.jsonl`, mode 600) and shows a
   notification; `sth-seat inbox` lists the unread ones and marks them read. The daemon never runs anything from a
   message. Without `messages`, none are taken.

   `secrets: here` (a top-level key next to `allow`) keeps this machine's secrets on it: `sth-seat ask-secret`
   asks on this machine's own screen and stores the answer here without contacting the hub, and the daemon
   refuses any secret the hub tries to store here. Set it on a machine whose secrets must never reach the others
   (a work laptop), together with `secrets: here` on its entry in the hub's config, which makes the hub refuse
   `ask_user_secret` from it. Prompts the hub sends it for other machines are still answered.

4. Install and start the daemon:

   ```sh
   sth-seat install
   ```

   It installs a user service: a systemd user unit on Linux (run `loginctl enable-linger` to keep it up without a
   login) or a launchd agent on macOS (it logs to `~/Library/Logs/sth-seat.log`). Installed with Homebrew, the
   service runs brew's `$(brew --prefix)/bin/sth-seat`, so `brew upgrade sth-seat` then `sth-seat install`
   (which restarts it) upgrades. A downloaded binary copies itself to `~/.local/bin/sth-seat` instead; run the
   same command with a newer binary to upgrade. `sth-seat uninstall` removes the service.

## Check a machine

`sth-seat doctor` checks the key, the hub and the daemon's link to it, the policy, the lock and the desktop
tools this OS needs, and says how to fix whatever fails.

## Connect your agents

Teach your coding agents the CLI with a skill:

```sh
sth-seat skill --install claude      # or agents (Codex, OpenCode and others), opencode, pi; or --dir <skills folder>
sth-seat skill                       # print it
```

Point any MCP client at `https://seat.example.com/mcp` with the header `Authorization: Bearer <token>`, or add it
to an MCP router. The tools:

| Tool | What it does |
| --- | --- |
| `open_for_user` | Opens a URL or a file on the seat. Pass `from` (the agent machine's hostname) for files and localhost URLs, and `reveal` to show a file selected in Finder or the file manager instead of opening it. |
| `where_is_user` | Which machine is the seat, and how long since each was used. |
| `notify_user` | Shows a desktop notification on the seat. |
| `ask_user_secret` | Asks for a secret in a hidden prompt on the seat; it's written to a mode-600 file on the agent's machine and only the path is returned. |

From a shell on any machine:

```sh
sth-seat open http://localhost:5173/          # opens on the seat, through a tunnel
sth-seat open report.html --title "Weekly report"
sth-seat open --reveal build/app.dmg                # copied over and shown selected in Finder / the file manager
sth-seat where
sth-seat notify "The release build passed." --title "Build"
sth-seat ask-secret api-token "API token for the staging deploy?"
sth-seat run desktop -- make test             # like ssh, if desktop's policy allows shell
sth-seat cp desktop:~/logs/app.log .
sth-seat send laptop "Can you check the build log there?"   # into laptop's inbox, if it takes messages from here
sth-seat inbox --wait                         # messages sent here; waits for the next one
sth-seat log                                  # what other machines did here
sth-seat lock                                 # refuse everything until `sth-seat unlock`
sth-seat doctor
```

`where`, `open`, `notify`, `ask-secret`, `cp`, `send`, `inbox`, `log` and `doctor` take `--json`. Exit codes: 0 done; 1 sth-seat
couldn't do it (the message says why); for `run`, the remote command's own code, 124 when it timed out, 127 when
the shell couldn't start; 255 when the other machine refused.

## Develop

See `AGENTS.md`. `bun run check` runs every project's typecheck, lint, format check and tests.

## License

MIT; see `LICENSE`. Security model and how to report a vulnerability: `SECURITY.md`.
