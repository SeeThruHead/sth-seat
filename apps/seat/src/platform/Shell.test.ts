import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Layer, Stream } from "effect"
import type { Event } from "@sth-seat/protocol/Remote.ts"
import { Shell, notStartedCode, timedOutCode } from "./Shell.ts"

const text = (events: ReadonlyArray<Event>, channel: "stdout" | "stderr") =>
  events
    .flatMap((event) =>
      event._tag === "Output" && event.channel === channel ? [new TextDecoder().decode(event.bytes)] : []
    )
    .join("")

const lastOf = (events: ReadonlyArray<Event>) => events.at(-1)

const runIn = (
  shell: string,
  command: string,
  input: Stream.Stream<Uint8Array> = Stream.empty,
  timeout: Duration.Input = "10 seconds"
) =>
  Shell.use((runner) =>
    Stream.runCollect(runner.run({ command, cwd: "/tmp", input, timeout: Duration.fromInputUnsafe(timeout) }))
  ).pipe(Effect.provide(Shell.layer(shell).pipe(Layer.provideMerge(BunServices.layer))))

describe("Shell", () => {
  it.live("runs a command in a login shell and reports its output and exit code", () =>
    Effect.gen(function* () {
      const events = yield* runIn("/bin/sh", "pwd; echo oops >&2; exit 3")

      assert.strictEqual(text(events, "stdout"), "/tmp\n")
      assert.strictEqual(text(events, "stderr"), "oops\n")
      assert.deepStrictEqual(lastOf(events), { _tag: "Exited", code: 3 })
    })
  )

  it.live("feeds the caller's input to the command", () =>
    Effect.gen(function* () {
      const events = yield* runIn("/bin/sh", "cat", Stream.make(new TextEncoder().encode("hi there")))

      assert.strictEqual(text(events, "stdout"), "hi there")
      assert.deepStrictEqual(lastOf(events), { _tag: "Exited", code: 0 })
    })
  )

  it.live("stops a command that runs past its time", () =>
    Effect.gen(function* () {
      const events = yield* runIn("/bin/sh", "sleep 30", Stream.empty, "200 millis")

      assert.include(text(events, "stderr"), "stopped after")
      assert.deepStrictEqual(lastOf(events), { _tag: "Exited", code: timedOutCode })
    })
  )

  it.live("says so when the shell can't start", () =>
    Effect.gen(function* () {
      const events = yield* runIn("/nonexistent/shell", "true")

      assert.deepStrictEqual(lastOf(events), { _tag: "Exited", code: notStartedCode })
    })
  )
})
