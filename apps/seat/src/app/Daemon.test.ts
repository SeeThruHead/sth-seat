import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Schedule } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { run } from "../platform/Processes.ts"
import { script } from "../testing/Seat.testing.ts"

const entry = `${import.meta.dirname}/main.ts`

const withToolsFrom = `PATH="$0:$PATH" exec "$@"`

const patiently = { times: 500, schedule: Schedule.spaced("20 millis") }

const signalled = (signal: string, pid: string) => run("/bin/sh", ["-c", `kill -${signal} "$0"`, pid], "5 seconds")

const isRunning = (pid: string) =>
  signalled("0", pid).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false)
  )

describe.skipIf(process.platform !== "linux")("the daemon on Linux", () => {
  it.live(
    "takes its idle watcher with it when it is killed outright",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const folder = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(`${folder}/wayland-0`, "")
        yield* script(folder, "swayidle", `echo $$ > ${folder}/swayidle.pid; exec sleep 60`)
        const env = {
          HOME: folder,
          SEAT_CONFIG_DIR: `${folder}/config`,
          SEAT_STATE_DIR: `${folder}/state`,
          SEAT_INBOX: `${folder}/inbox`,
          SEAT_HUB_URL: "ws://127.0.0.1:9/daemon",
          XDG_RUNTIME_DIR: folder,
          WAYLAND_DISPLAY: "wayland-0"
        }
        yield* run(process.execPath, [entry, "key", "--name", "killed-outright"], "30 seconds", env)
        const daemon = yield* spawner.spawn(
          ChildProcess.make("/bin/sh", ["-c", withToolsFrom, folder, process.execPath, entry, "daemon"], {
            env,
            extendEnv: true
          })
        )
        const watcher = yield* fs.readFileString(`${folder}/swayidle.pid`).pipe(Effect.retry(patiently))
        const before = yield* isRunning(watcher.trim())
        yield* signalled("KILL", String(daemon.pid))
        const after = yield* isRunning(watcher.trim()).pipe(
          Effect.repeat({ ...patiently, until: (running) => !running })
        )

        assert.deepStrictEqual([before, after], [true, false])
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    30_000
  )
})
