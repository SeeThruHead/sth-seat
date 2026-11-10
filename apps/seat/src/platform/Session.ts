import { Context, Effect, FileSystem, Layer, Option } from "effect"
import { waylandDisplayIn } from "../domains/session/Session.ts"
import type { Environment } from "./Processes.ts"

export type SessionSettings = {
  readonly runtimeDir: Option.Option<string>
  readonly waylandDisplay: Option.Option<string>
}

export class DesktopSession extends Context.Service<
  DesktopSession,
  { readonly environment: Effect.Effect<Option.Option<Environment>> }
>()("seat/platform/Session/DesktopSession") {
  static readonly wayland = (settings: SessionSettings) =>
    Layer.effect(
      DesktopSession,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        const inFolder = (folder: string) =>
          fs.readDirectory(folder).pipe(
            Effect.orElseSucceed((): ReadonlyArray<string> => []),
            Effect.map((entries) =>
              Option.map(waylandDisplayIn(entries, settings.waylandDisplay), (display): Environment => ({
                WAYLAND_DISPLAY: display,
                XDG_RUNTIME_DIR: folder
              }))
            )
          )

        const environment = Option.match(settings.runtimeDir, {
          onNone: () => Effect.succeed(Option.none<Environment>()),
          onSome: inFolder
        })

        return DesktopSession.of({ environment })
      })
    )
}

export const nobodyLoggedIn = "nobody is logged in to the desktop here"
