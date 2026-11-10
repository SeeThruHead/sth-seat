import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { main } from "./attribution.ts"

main(Bun.argv).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
