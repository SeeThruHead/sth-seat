import { Context, DateTime, Duration, Effect, Layer, Option, Ref, Schedule, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { IdleMillis } from "@sth-seat/protocol/Ids.ts"
import { afterLine, idleAt, idleFromIoreg, unknown, watcherThreshold } from "../domains/idle/Idle.ts"
import type { IdleState } from "../domains/idle/Idle.ts"
import { run, watchLines } from "./Processes.ts"
import { DesktopSession, nobodyLoggedIn } from "./Session.ts"

export class IdleUnavailable extends Schema.TaggedError<IdleUnavailable, { readonly brand: unique symbol }>()(
  "IdleUnavailable",
  { problem: Schema.String }
) {
  override get message() {
    return `can't tell how long this machine has been idle: ${this.problem}`
  }
}

const hidIdleTimeIn = (output: string) =>
  Effect.fromOption(idleFromIoreg(output)).pipe(
    Effect.mapError(() => new IdleUnavailable({ problem: "ioreg printed no HIDIdleTime" }))
  )

const swayidleArgs = ["timeout", String(Duration.toSeconds(watcherThreshold)), "echo idle", "resume", "echo active"]

export class Idle extends Context.Service<Idle, { readonly current: Effect.Effect<IdleMillis, IdleUnavailable> }>()(
  "seat/platform/Idle"
) {
  static readonly darwin = (ioreg: string) =>
    Layer.effect(
      Idle,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const current = run(ioreg, ["-c", "IOHIDSystem", "-d", "4"], "5 seconds").pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.mapError((error) => new IdleUnavailable({ problem: error.message })),
          Effect.flatMap(hidIdleTimeIn),
          Effect.withSpan("Idle.current")
        )

        return Idle.of({ current })
      })
    )

  static readonly wayland = (swayidle: string) =>
    Layer.effect(
      Idle,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const session = yield* DesktopSession
        const state = yield* Ref.make<IdleState>(unknown)
        const problem = yield* Ref.make<Option.Option<IdleUnavailable>>(Option.none())

        const onLine = (line: string) =>
          DateTime.now.pipe(Effect.flatMap((now) => Ref.update(state, (before) => afterLine(before, line, now))))

        const watch = Effect.gen(function* () {
          const environment = yield* session.environment
          if (Option.isNone(environment)) return yield* new IdleUnavailable({ problem: nobodyLoggedIn })
          yield* Ref.set(state, unknown)
          yield* Ref.set(problem, Option.none())

          return yield* watchLines(swayidle, swayidleArgs, onLine, environment.value).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.mapError(
              (error) =>
                new IdleUnavailable({
                  problem: `${error.message} (is swayidle installed, and can it reach the compositor?)`
                })
            )
          )
        })

        yield* watch.pipe(
          Effect.tapError((error) => Ref.set(problem, Option.some(error))),
          Effect.retry(Schedule.spaced("10 seconds")),
          Effect.forkScoped
        )

        const current = Effect.gen(function* () {
          const found = yield* Ref.get(problem)
          if (Option.isSome(found)) return yield* found.value
          const now = yield* DateTime.now
          const seen = yield* Ref.get(state)
          const idle = idleAt(seen, now)
          if (Option.isNone(idle)) return yield* new IdleUnavailable({ problem: "swayidle hasn't reported yet" })

          return idle.value
        }).pipe(Effect.withSpan("Idle.current"))

        return Idle.of({ current })
      })
    )
}
