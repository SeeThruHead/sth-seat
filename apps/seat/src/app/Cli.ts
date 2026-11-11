import { Command } from "effect/cli"
import { skillCommand } from "./cli/Agents.ts"
import { localCommands } from "./cli/Local.ts"
import { machineCommands } from "./cli/Machines.ts"
import { messageCommands } from "./cli/Messages.ts"
import { seatCommands } from "./cli/Seat.ts"

export const version = "0.6.0"

export const cli = Command.make("sth-seat").pipe(
  Command.withDescription(
    "Makes all of your machines act like the one you are sitting at: agents open pages and files, notify you and ask you for secrets on that machine, run commands and copy files on your other machines without ssh, and send messages between them. Agents: run `sth-seat skill` for the full guide."
  ),
  Command.withSubcommands([
    ...seatCommands,
    ...machineCommands,
    ...messageCommands,
    ...localCommands(version),
    skillCommand(version)
  ])
)
