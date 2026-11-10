# Security

sth-seat lets your machines run commands and move files on each other, and lets coding agents ask for that. It
is built so that each machine stays in charge of what happens on it. This page says what that protects against,
what it doesn't, and how to report a problem.

## What it protects against

- **A compromised or malicious hub.** Every command one machine sends another is signed with the sender's
  Ed25519 key and checked by the receiver against the key in its own `policy.yaml`. The hub can drop or delay
  calls but can't make one up, change one, or fake the reply (replies are signed and numbered too). Commands the
  hub makes itself come from the caller `hub`, which a policy grants only what you list (by default: deliver
  pages and files).
- **Replays and stale commands.** A command is good for a minute and only once; a hello (how a machine signs in
  to the hub) likewise.
- **A machine doing more than it should.** A machine refuses anything its own policy doesn't list, whatever the
  hub says, and a policy that doesn't parse refuses everything. `read` and `write` are limited to folders, with
  `~` and symlinks resolved before the check. `sth-seat lock` refuses everything.
- **Secrets leaking into agents.** `ask_user_secret` writes the answer to a mode-600 file on the asking machine
  and returns only the path; the value is redacted in logs and spans.
- **Something on the network reaching your dev servers.** Tunnels listen on `127.0.0.1` only, and a dev server
  can stay on loopback.

## What it doesn't protect against

- **An agent you trust doing something you didn't want.** If a machine grants another `shell`, any agent on
  that machine can run commands there, including one misled by something it read. Grant `shell` only between
  machines you'd give each other ssh access to, and give a machine that should only receive (a work laptop) a
  policy with `receive` only.
- **Someone who has your user account on a trusted machine.** They have its key.
- **Traffic analysis or a hostile network without TLS.** Run the hub behind TLS. Payloads are signed, not
  encrypted end to end: the hub sees files and output that pass through it.
- **The MCP endpoint's token.** It is a bearer token; whoever has it can ask the hub to show the user things and
  ask for secrets (which still land only on the user's own machines).

## Reporting a vulnerability

Please report it privately through the repository host's private vulnerability reporting, not in a public issue.
Include what you found, how to reproduce it, and what an attacker could do with it.
