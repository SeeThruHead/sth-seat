import { Context, Effect, FileSystem, Layer, Path, Schedule } from "effect"
import type { PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { launchdLabel, launchdPlist, systemdUnit } from "../domains/service/Service.ts"
import { run } from "./Processes.ts"
import type { CommandFailed } from "./Processes.ts"

const serviceTimeout = "15 seconds"

export class ServiceManager extends Context.Service<
  ServiceManager,
  {
    install(executable: string): Effect.Effect<string, CommandFailed | PlatformError.PlatformError>
    readonly uninstall: Effect.Effect<string, CommandFailed | PlatformError.PlatformError>
  }
>()("seat/platform/Service/ServiceManager") {
  static readonly systemd = (home: string) =>
    Layer.effect(
      ServiceManager,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const unitFile = path.join(home, ".config", "systemd", "user", "sth-seat.service")

        const systemctl = (...args: ReadonlyArray<string>) =>
          run("systemctl", ["--user", ...args], serviceTimeout).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
          )

        const install = Effect.fn("ServiceManager.install")(function* (executable: string) {
          yield* fs.makeDirectory(path.dirname(unitFile), { recursive: true })
          yield* fs.writeFileString(unitFile, systemdUnit(executable))
          yield* systemctl("daemon-reload")
          yield* systemctl("enable", "sth-seat")
          yield* systemctl("restart", "sth-seat")

          return `Installed ${unitFile} and started it (systemctl --user status sth-seat). To keep it running without a login: loginctl enable-linger.`
        })

        const uninstall = Effect.gen(function* () {
          yield* systemctl("disable", "--now", "sth-seat").pipe(Effect.ignore)
          yield* fs.remove(unitFile, { force: true })
          yield* systemctl("daemon-reload")

          return `Stopped the daemon and removed ${unitFile}.`
        }).pipe(Effect.withSpan("ServiceManager.uninstall"))

        return ServiceManager.of({ install, uninstall })
      })
    )

  static readonly launchd = (home: string, uid: number) =>
    Layer.effect(
      ServiceManager,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const plistFile = path.join(home, "Library", "LaunchAgents", "sth-seat.plist")
        const logFile = path.join(home, "Library", "Logs", "sth-seat.log")
        const domain = `gui/${uid}`

        const launchctl = (...args: ReadonlyArray<string>) =>
          run("launchctl", args, serviceTimeout).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
          )

        const install = Effect.fn("ServiceManager.install")(function* (executable: string) {
          yield* fs.makeDirectory(path.dirname(plistFile), { recursive: true })
          yield* fs.writeFileString(plistFile, launchdPlist(executable, logFile, home))
          yield* launchctl("bootout", `${domain}/${launchdLabel}`).pipe(Effect.ignore)
          yield* launchctl("bootstrap", domain, plistFile).pipe(
            Effect.retry({ times: 10, schedule: Schedule.spaced("500 millis") })
          )

          return `Installed ${plistFile} and started it; it logs to ${logFile}.`
        })

        const uninstall = Effect.gen(function* () {
          yield* launchctl("bootout", `${domain}/${launchdLabel}`).pipe(Effect.ignore)
          yield* fs.remove(plistFile, { force: true })

          return `Stopped the daemon and removed ${plistFile}.`
        }).pipe(Effect.withSpan("ServiceManager.uninstall"))

        return ServiceManager.of({ install, uninstall })
      })
    )
}
