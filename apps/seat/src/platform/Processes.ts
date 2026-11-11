import { Duration, Effect, Schema, Stream } from "effect"
import type { PlatformError } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class CommandFailed extends Schema.TaggedError<CommandFailed, { readonly brand: unique symbol }>()(
  "CommandFailed",
  {
    command: Schema.String,
    problem: Schema.String,
    ending: Schema.optionalKey(Schema.Union([Schema.Int, Schema.Literals(["timed out", "didn't start"])]))
  }
) {
  override get message() {
    return `${this.command} failed: ${this.problem}`
  }
}

const describe = (command: string, args: ReadonlyArray<string>): string => [command, ...args].join(" ")

export type Environment = Readonly<Record<string, string>>

const child = (name: string, args: ReadonlyArray<string>, env: Environment, input?: string) =>
  ChildProcess.make(name, [...args], {
    env: { ...env },
    extendEnv: true,
    ...(input === undefined ? {} : { stdin: { stream: Stream.make(new TextEncoder().encode(input)), endOnDone: true } })
  })

const outputOf = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  Stream.mkString(Stream.decodeText(stream))

export const run = Effect.fn("Processes.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  timeout: Duration.Input,
  env: Environment = {},
  input?: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const name = describe(command, args)
  yield* Effect.annotateCurrentSpan({ "process.command": command })
  const failed = (problem: string, ending: NonNullable<CommandFailed["ending"]>) =>
    new CommandFailed({ command: name, problem, ending })

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(child(command, args, env, input))
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [outputOf(handle.stdout), outputOf(handle.stderr), handle.exitCode],
        { concurrency: "unbounded" }
      )
      if (exitCode !== ChildProcessSpawner.ExitCode(0))
        return yield* failed(`exit code ${exitCode}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`, exitCode)

      return stdout
    })
  ).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(failed(`no answer within ${Duration.format(Duration.fromInputUnsafe(timeout))}`, "timed out"))
    }),
    Effect.catchTag("PlatformError", (error) => Effect.fail(failed(error.message, "didn't start")))
  )
})

export const watchLines = Effect.fn("Processes.watchLines")(function* (
  command: string,
  args: ReadonlyArray<string>,
  onLine: (line: string) => Effect.Effect<void>,
  env: Environment = {}
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const name = describe(command, args)
  const exitCode = yield* spawner.spawn(child(command, args, env)).pipe(
    Effect.flatMap((handle) =>
      handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach(onLine),
        Effect.andThen(handle.exitCode)
      )
    ),
    Effect.mapError((error) => new CommandFailed({ command: name, problem: error.message }))
  )

  return yield* new CommandFailed({ command: name, problem: `stopped with exit code ${exitCode}` })
})
