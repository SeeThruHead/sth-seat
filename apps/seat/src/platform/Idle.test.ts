import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Schedule } from "effect"
import { script } from "../testing/Seat.testing.ts"
import { Idle } from "./Idle.ts"
import { DesktopSession } from "./Session.ts"

const wayland = (swayidle: string, runtimeDir: Option.Option<string>) =>
  Idle.wayland(swayidle).pipe(Layer.provide(DesktopSession.wayland({ runtimeDir, waylandDisplay: Option.none() })))

const firstProblem = Idle.use((idle) =>
  idle.current.pipe(Effect.flip, Effect.retry({ times: 100, schedule: Schedule.spaced("20 millis") }))
)

const currentIdle = Idle.use((idle) => idle.current)

describe("Idle on macOS", () => {
  it.live("reads HIDIdleTime from ioreg", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const ioreg = yield* script(folder, "ioreg", `echo '"HIDIdleTime" = 4500000000'`)
      const idle = yield* currentIdle.pipe(Effect.provide(Idle.darwin(ioreg)))

      assert.strictEqual(idle, 4_500)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("says why when ioreg fails or prints no idle time", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const silent = yield* script(folder, "ioreg-silent", "echo nothing")
      const broken = yield* script(folder, "ioreg-broken", "exit 1")
      const none = yield* Effect.flip(currentIdle.pipe(Effect.provide(Idle.darwin(silent))))
      const failed = yield* Effect.flip(currentIdle.pipe(Effect.provide(Idle.darwin(broken))))

      assert.strictEqual(none.problem, "ioreg printed no HIDIdleTime")
      assert.include(failed.message, "can't tell how long this machine has been idle")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})

describe("Idle on Wayland", () => {
  it.live("follows swayidle's idle and active lines", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-0`, "")
      const swayidle = yield* script(
        folder,
        "swayidle",
        `test "$WAYLAND_DISPLAY" = wayland-0 && echo active && echo idle; sleep 30`
      )
      const idle = yield* Idle.use((watcher) =>
        watcher.current.pipe(
          Effect.retry({ times: 100, schedule: Schedule.spaced("20 millis") }),
          Effect.repeat({ until: (millis) => millis >= 5_000 })
        )
      ).pipe(Effect.provide(wayland(swayidle, Option.some(folder))))

      assert.isAtLeast(idle, 5_000)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("knows nothing until swayidle has said something", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-0`, "")
      const swayidle = yield* script(folder, "swayidle", "sleep 30")
      const error = yield* firstProblem.pipe(Effect.provide(wayland(swayidle, Option.some(folder))))

      assert.strictEqual(error.problem, "swayidle hasn't reported yet")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("reports itself unavailable when swayidle can't run", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-0`, "")
      const error = yield* firstProblem.pipe(
        Effect.repeat({
          until: (found) => found.problem !== "swayidle hasn't reported yet",
          schedule: Schedule.spaced("20 millis")
        }),
        Effect.provide(wayland("sth-seat-no-swayidle", Option.some(folder)))
      )

      assert.include(error.message, "is swayidle installed")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("says nobody is logged in when there is no Wayland socket", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const error = yield* firstProblem.pipe(
        Effect.repeat({
          until: (found) => found.problem !== "swayidle hasn't reported yet",
          schedule: Schedule.spaced("20 millis")
        }),
        Effect.provide(wayland("swayidle", Option.some(folder)))
      )

      assert.strictEqual(error.problem, "nobody is logged in to the desktop here")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})
