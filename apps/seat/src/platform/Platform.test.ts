import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Desktop } from "./Desktop.ts"
import { platformLayer } from "./Platform.ts"

const builds = (os: string) =>
  Effect.scoped(
    Layer.build(
      platformLayer({
        os,
        handoff: "handoff",
        home: "/home/user",
        runtimeDir: Option.none(),
        waylandDisplay: Option.none()
      })
    )
  ).pipe(
    Effect.map((context) => context.mapUnsafe.has(Desktop.key)),
    Effect.provide(BunServices.layer)
  )

describe("platformLayer", () => {
  it.live("stops on Windows with a pointer to WSL", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(builds("win32"))

      assert.strictEqual(error.message, "sth-seat runs on macOS and Linux, not win32. On Windows, run it inside WSL.")
    })
  )
})
