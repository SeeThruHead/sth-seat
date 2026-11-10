import { Context, Duration, Effect, Layer, Stream } from "effect"
import type { PlatformError } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { Event } from "@sth-seat/protocol/Remote.ts"

export type ShellRun = {
  readonly command: string
  readonly cwd: string
  readonly input: Stream.Stream<Uint8Array>
  readonly timeout: Duration.Duration
}

export const timedOutCode = 124

export const notStartedCode = 127

const output =
  (channel: "stdout" | "stderr") =>
  (bytes: Uint8Array): Event => ({ _tag: "Output", channel, bytes })

const said = (text: string): Event => output("stderr")(new TextEncoder().encode(`sth-seat: ${text}\n`))

const exited = (code: number): Event => ({ _tag: "Exited", code })

const failedToStart = (error: PlatformError.PlatformError) =>
  Stream.fromIterable([said(error.message), exited(notStartedCode)])

const stoppedAfter = (timeout: Duration.Duration): Stream.Stream<Event> =>
  Stream.fromEffect(Effect.sleep(timeout)).pipe(
    Stream.flatMap(() => Stream.fromIterable([said(`stopped after ${Duration.format(timeout)}`), exited(timedOutCode)]))
  )

export class Shell extends Context.Service<Shell, { run(request: ShellRun): Stream.Stream<Event> }>()(
  "seat/platform/Shell"
) {
  static readonly layer = (shell: string) =>
    Layer.effect(
      Shell,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const process = (request: ShellRun): Stream.Stream<Event> =>
          Stream.unwrap(
            Effect.map(
              spawner.spawn(
                ChildProcess.make(shell, ["-lc", request.command], {
                  cwd: request.cwd,
                  stdin: { stream: Stream.orDie(request.input), endOnDone: true },
                  forceKillAfter: "3 seconds"
                })
              ),
              (handle) =>
                Stream.merge(
                  Stream.map(handle.stdout, output("stdout")),
                  Stream.map(handle.stderr, output("stderr"))
                ).pipe(Stream.concat(Stream.fromEffect(Effect.map(handle.exitCode, (code) => exited(Number(code))))))
            )
          ).pipe(Stream.catchTag("PlatformError", failedToStart))

        const run = (request: ShellRun): Stream.Stream<Event> =>
          Stream.merge(process(request), stoppedAfter(request.timeout), { haltStrategy: "either" }).pipe(
            Stream.withSpan("Shell.run")
          )

        return Shell.of({ run })
      })
    )
}
