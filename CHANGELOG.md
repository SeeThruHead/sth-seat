# Changelog

## 0.8.1

- macOS remembers what you answered to sth-seat's privacy prompts ("would like to access data from other apps",
  Photos, Desktop, Documents, Network Volumes) across upgrades. Releases sign the macOS binaries with a stable
  certificate as `com.seethruhead.sth-seat`, and Homebrew installs them inside a signed `sth-seat.app`, so macOS
  files each answer under that bundle ID instead of the versioned Cellar path. After upgrading to 0.8.1, each prompt
  comes once more (the identity changed); answer it once and it stays answered, Allow or Don't Allow.

## 0.8.0

- The CLI never talks to the hub. Every command (`open`, `where`, `notify`, `ask-secret`, `run`, `cp`, `send`,
  `inbox`) goes to this machine's daemon over a socket in `~/.local/state/sth-seat` (a folder only this user can
  open), and the daemon alone reads the machine key, signs and talks to the hub. With the daemon stopped, every one
  of them fails with "sth-seat is off on this machine" (exit 3) and sends nothing anywhere. `sth-seat doctor` no
  longer reads the key either. Upgrade the daemon and the CLI together (`brew upgrade sth-seat`, then
  `sth-seat install`).

- Machines have a `side` in the hub's config (default `default`). `open`, `notify` and secret prompts go only to
  the most recently used connected machine on the caller's side, never to one on another side, whichever was used
  last. When the caller's own daemon isn't connected, the hub refuses instead of picking another machine; when the
  daemon runs but has lost its hub link, `sth-seat open` opens on this machine itself (when it has a display). The MCP tools `open_for_user` and
  `notify_user` now require `from`. Before, a work laptop whose daemon was off had its pages opened on a home
  machine.
- Every delivery says which machine it is for (`origin`), and a policy's `deliveries: from: [...]` makes the daemon
  refuse anything for a machine not listed (itself is always allowed), or with no origin. `sth-seat doctor` shows
  it.
- The daemon records its hub link in `~/.local/state/sth-seat/link`. Commands that use the hub print a `warning:`
  line when it is lost, stale (the daemon isn't running) or never made, and `sth-seat doctor` fails its `daemon`
  check. When a daemon stays gone for 2 minutes, the hub notifies the seat on the same side.
- The hub must be on 0.8.0 for `side` and `origin`; daemons with `deliveries` set refuse an older hub's deliveries.

## 0.7.0

- Each thing the hub delivers is its own policy capability: `open-url`, `open-file`, `reveal`, `notify`,
  `ask-secret`, `store-secret` and `open-tunnelled-page`. `receive` is short for all seven and means what it did.
  `can: [open-url, open-file, reveal, notify]` takes links, files and notifications but refuses tunnelled pages
  and secret prompts, which can carry data back out. Refusals name the capability, and `sth-seat doctor` lists
  what the hub may deliver. Install 0.7.0 before writing the new names: an older daemon can't read them and
  refuses everything.
- The daemon checks links itself: only `http` and `https` open, and they go to the default browser by name
  (`open -b <bundle id>` on macOS, `gtk-launch <desktop entry>` on Linux), never `open` or `xdg-open` on the link.
- A file opens only when it is a document (HTML, PDF, images, text, office files, audio, video); folders and
  bundles, executable files and anything else (`.app`, `.command`, `.webloc`, `.terminal`, scripts) are refused,
  because Handoff and `xdg-open` hand files to the system opener, which runs them. `--reveal` still shows them.

## 0.6.0

- `sth-seat send <machine> <text>` (or the text on stdin) puts a message in another machine's inbox, and
  `sth-seat inbox` lists the unread ones (sender, time, text) and marks them read; `--json` for agents, `--wait`
  for the next one, `--all` for read ones too. A message is a request, never a command: the daemon stores it,
  shows a notification and, with `messages: clipboard: true`, copies it to the clipboard. Which machines may send
  is the policy's `messages: from: [...]`, separate from `allow`, so a machine with no shell can still take
  messages. The hub relays the new `Message` request, so it must be on 0.6.0 too.

## 0.5.0

- `secrets: here` keeps a machine's secrets on it. In its `policy.yaml`, `sth-seat ask-secret` asks on that machine
  (the Herdr app's prompt through `herdr-secret` on macOS, when it is there) and writes the file without contacting
  the hub, and the daemon refuses any secret the hub tries to store there. On its entry in the hub's config, the
  hub refuses `ask_user_secret` and the `AskSecret` RPC from it before asking any seat.

## 0.4.2

- `sth-seat skill --install` warns when the skills folder is a link or is assembled from links (a dotfiles tool may
  rebuild it and remove the skill), and says to keep the skill where that tool assembles from.

## 0.4.1

- `sth-seat install` from a Homebrew install points the service at `$(brew --prefix)/bin/sth-seat` and makes no
  copy in `~/.local/bin`; after `brew upgrade sth-seat`, run `sth-seat install` to restart on the new version.

## 0.4.0

- Public on GitHub: tagged releases attach binaries for macOS and Linux and publish the hub image
  `ghcr.io/seethruhead/sth-seat-hub`; `brew install seethruhead/tap/sth-seat` installs the CLI.
- The MCP endpoint answers a forgotten `Mcp-Session-Id` with a 404 whose body says "Session not found" (a JSON-RPC
  error), so MCP routers reconnect after the hub restarts instead of staying broken.
- `ask-secret` waits as long as the prompt does (it gave up after 90 seconds with "Can't reach the hub" while
  the prompt stayed open for three minutes, and an answer typed after that was lost).
- On Hyprland, `open` doesn't steal focus from a game: when the focused window is fullscreen, a Wine program
  (`.exe`), a Steam game or gamescope, the seat shows "Ready to open: <target>" as a notification instead.
- `sth-seat open --reveal <file>` (and `reveal` on `open_for_user`) copies a file to the seat and shows it selected in
  Finder, or in the file manager on Linux (through its D-Bus `ShowItems`, falling back to opening the folder).
- Secret prompts name the machine the secret goes to and the file it will be saved in (the hub sends both).
- On macOS, a `herdr-secret` program on PATH asks instead of the built-in dialog, which stays as the fallback.
- The launchd agent's PATH starts with `~/.local/bin`. Run `sth-seat install` again to pick it up.
- `cp` into an existing folder keeps the file's name.

## 0.3.0

- Agent-ready CLI: `sth-seat skill` prints or installs a skill for Claude Code, Codex, OpenCode or Pi;
  `sth-seat doctor` checks a machine's setup; `--json` output on `where`, `open`, `notify`, `ask-secret`, `cp`,
  `log` and `doctor`; documented exit codes.
- Single-binary releases for Linux and macOS (`bun run release`), and `sth-seat install` / `uninstall` for the
  user service.
- Generic names: the MCP tools are `open_for_user`, `where_is_user`, `notify_user` and `ask_user_secret`.
- No built-in hub: `sth-seat key --hub <url>` saves it per machine (or set `SEAT_HUB_URL`).
- Notify and secret prompts fail with `ActionFailed`; the hub config's `address` field is gone (ignored if present).

## 0.2.0

- Machines sign in with Ed25519 keys; tokens are gone.
- Each machine's `policy.yaml` decides what other machines and the hub may do there.
- `sth-seat run` and `sth-seat cp` between machines, signed end to end through the hub.
- localhost URLs open on the seat through a tunnel.
- `notify_user` and `ask_user_secret`, an audit log, and `sth-seat lock`.

## 0.1.0

- The hub tracks which machine you're using; `open` and `where` through MCP and the CLI; files delivered to the
  seat through Handoff on macOS.
