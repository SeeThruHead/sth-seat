import { Effect, FileSystem, Option, Path, Result, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { RemotePath } from "@sth-seat/protocol/Remote.ts"
import { copyPlan } from "../../domains/copy/Copy.ts"
import type { CopyPlan } from "../../domains/copy/Copy.ts"
import { localTarget } from "../../domains/files/LocalTarget.ts"
import { askDaemon } from "../LocalClient.ts"
import { RemoteProblem, download, linkTo, runOn, upload, throughDaemon } from "../Remote.ts"
import type { Link } from "../Remote.ts"
import { jsonFlag, report } from "./Output.ts"
import { machineLayers, withDaemon } from "./Settings.ts"

const run = Command.make(
  "run",
  {
    machine: Argument.String("machine").pipe(
      Argument.withSchema(MachineName),
      Argument.withDescription("The machine to run on, as named in the hub's config")
    ),
    command: Argument.String("command").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("The command and its arguments, after --")
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withSchema(RemotePath),
      Flag.withDescription("Folder to run in on that machine (default ~)"),
      Flag.optional
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Seconds before the command is stopped (default 600)"),
      Flag.optional
    ),
    noInput: Flag.Boolean("no-input").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("Don't pass this terminal's input to the command"),
      Flag.withDefault(false)
    )
  },
  Effect.fn("Cli.run")(function* ({ machine, command, cwd, timeout, noInput }) {
    const found = yield* withDaemon
    const options = { command: command.join(" "), cwd, timeoutSeconds: timeout, input: !noInput }

    yield* askDaemon(found, (daemon, me) =>
      linkTo(throughDaemon(daemon), me, machine).pipe(
        Effect.flatMap((link) => runOn(link, options)),
        Effect.scoped
      )
    ).pipe(Effect.provide(machineLayers(found)))
  })
).pipe(
  Command.withDescription(
    "Run a command on another of the user's machines, as ssh would; its output streams back and its exit code is ours"
  )
)

const Copied = Schema.Struct({ bytes: Schema.Int })

const intoFolder = Effect.fnUntraced(function* (local: string, remote: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const info = yield* fs.stat(local).pipe(Effect.option)
  const isFolder = Option.exists(info, (found) => found.type === "Directory")

  return isFolder ? path.join(local, path.basename(remote)) : local
})

const carried = (link: Link, plan: CopyPlan, local: string) =>
  plan.direction === "download" ? download(link, plan.remote, local) : upload(link, local, plan.remote)

const cp = Command.make(
  "cp",
  {
    from: Argument.String("from").pipe(Argument.withDescription("machine:path, or a path on this machine")),
    to: Argument.String("to").pipe(Argument.withDescription("machine:path, or a path on this machine")),
    json: jsonFlag
  },
  Effect.fn("Cli.cp")(function* ({ from, to, json }) {
    const found = yield* withDaemon
    const plan = copyPlan(from, to)
    if (Result.isFailure(plan)) return yield* new RemoteProblem({ problem: plan.failure })

    const given = localTarget(plan.success.local, process.cwd(), found.home)
    const local = plan.success.direction === "download" ? yield* intoFolder(given, plan.success.remote) : given
    const bytes = yield* askDaemon(found, (daemon, me) =>
      linkTo(throughDaemon(daemon), me, plan.success.machine).pipe(
        Effect.flatMap((link) => carried(link, plan.success, local)),
        Effect.scoped
      )
    ).pipe(Effect.provide(machineLayers(found)))

    yield* report(Copied, json, { bytes }, `Copied ${bytes} bytes.`)
  })
).pipe(Command.withDescription("Copy a file to or from another of the user's machines, if its policy allows"))

export const machineCommands = [run, cp] as const
