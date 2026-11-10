import { Effect, FileSystem, Ref, Stream } from "effect"
import { maxChunkBytes } from "@sth-seat/protocol/Remote.ts"
import type { Event } from "@sth-seat/protocol/Remote.ts"

export type Answer = (event: Event) => Effect.Effect<void>

export const denied = (reason: string): Event => ({ _tag: "Denied", reason })

const counted = (total: Ref.Ref<number>) => (bytes: Uint8Array) => Ref.update(total, (sum) => sum + bytes.length)

export const sendFile = Effect.fnUntraced(function* (path: string, answer: Answer) {
  const fs = yield* FileSystem.FileSystem
  const info = yield* fs.stat(path)
  if (info.type !== "File") return yield* answer(denied(`${path} isn't a regular file.`))
  const total = yield* Ref.make(0)

  yield* fs.stream(path, { chunkSize: maxChunkBytes }).pipe(
    Stream.tap(counted(total)),
    Stream.runForEach((bytes) => answer({ _tag: "Output", channel: "stdout", bytes }))
  )
  const bytes = yield* Ref.get(total)

  yield* answer({ _tag: "Finished", bytes })
})

export const receiveFile = Effect.fnUntraced(function* (
  path: string,
  input: Stream.Stream<Uint8Array>,
  answer: Answer
) {
  const fs = yield* FileSystem.FileSystem
  const staging = `${path}.sth-seat-partial`
  const total = yield* Ref.make(0)

  yield* input.pipe(Stream.tap(counted(total)), Stream.run(fs.sink(staging, { mode: 0o600 })))
  yield* fs.rename(staging, path)
  const bytes = yield* Ref.get(total)

  yield* answer({ _tag: "Finished", bytes })
})
