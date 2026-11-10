import { Command } from "effect/cli"
import { skillCommand } from "./cli/Agents.ts"
import { localCommands } from "./cli/Local.ts"
import { machineCommands } from "./cli/Machines.ts"
import { seatCommands } from "./cli/Seat.ts"

export const version = "0.4.2"

export const cli = Command.make("sth-seat").pipe(
  Command.withDescription(
    "Makes all of your machines act like the one you are sitting at: agents open pages and files, notify you and ask you for secrets on that machine, and run commands and copy files on your other machines without ssh. Agents: run `sth-seat skill` for the full guide."
  ),
  Command.withSubcommands([...seatCommands, ...machineCommands, ...localCommands(version), skillCommand(version)])
)
