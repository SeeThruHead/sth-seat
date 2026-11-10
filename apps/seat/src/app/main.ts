import { BunCrypto, BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Option, Predicate } from "effect"
import { Command } from "effect/cli"
import { cli, version } from "./Cli.ts"
import { problemOf } from "../domains/problem/Problem.ts"

const isRemoteExit = (cause: Cause.Cause<unknown>): boolean =>
  Option.exists(Cause.findErrorOption(cause), (error) => Predicate.isTagged(error, "RemoteExited"))

cli.pipe(
  Command.run({ version }),
  Effect.tapCause((cause) =>
    isRemoteExit(cause)
      ? Effect.void
      : Option.match(problemOf(cause), { onNone: () => Effect.void, onSome: (problem) => Console.error(problem) })
  ),
  Effect.provide([BunServices.layer, BunCrypto.layer]),
  (program) => BunRuntime.runMain(program, { disableErrorReporting: true })
)
