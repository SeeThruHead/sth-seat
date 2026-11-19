import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { watchLines } from "../platform/Processes.ts"

watchLines(Bun.argv[2] ?? "", [], () => Effect.void).pipe(
  Effect.ignore,
  Effect.scoped,
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
