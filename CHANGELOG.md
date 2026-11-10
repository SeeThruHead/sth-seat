# Changelog

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
