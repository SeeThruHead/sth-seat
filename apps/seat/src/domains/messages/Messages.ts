import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { EnvelopeId, MessageText } from "@sth-seat/protocol/Remote.ts"

export const InboxMessage = Schema.Struct({
  id: EnvelopeId,
  from: MachineName,
  at: Schema.String,
  text: MessageText
})
export type InboxMessage = typeof InboxMessage.Type

const MessageLine = Schema.fromJsonString(InboxMessage)

const ReadLine = Schema.fromJsonString(Schema.Struct({ id: EnvelopeId }))

export class InboxUnavailable extends Schema.TaggedError<InboxUnavailable, { readonly brand: unique symbol }>()(
  "InboxUnavailable",
  { problem: Schema.String }
) {
  override get message() {
    return `Can't use this machine's message inbox: ${this.problem}`
  }
}

const unavailable = (error: { readonly message: string }) => new InboxUnavailable({ problem: error.message })

const nonEmptyLines = (text: string): ReadonlyArray<string> => text.split("\n").filter((line) => line.trim() !== "")

export class Messages extends Context.Service<
  Messages,
  {
    add(message: InboxMessage): Effect.Effect<void, InboxUnavailable>
    readonly all: Effect.Effect<ReadonlyArray<InboxMessage>>
    readonly unread: Effect.Effect<ReadonlyArray<InboxMessage>>
    markRead(messages: ReadonlyArray<InboxMessage>): Effect.Effect<void, InboxUnavailable>
  }
>()("seat/domains/messages/Messages") {
  static readonly layer = (folder: string) =>
    Layer.effect(
      Messages,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const inbox = path.join(folder, "messages.jsonl")
        const readMarks = path.join(folder, "messages-read.jsonl")
        const ready = fs.makeDirectory(folder, { recursive: true, mode: 0o700 })

        const append = (file: string, line: string) =>
          ready.pipe(
            Effect.andThen(fs.writeFileString(file, `${line}\n`, { flag: "a", mode: 0o600 })),
            Effect.andThen(fs.chmod(file, 0o600)),
            Effect.mapError(unavailable)
          )

        const decodedLines = <A>(file: string, line: Schema.Codec<A, string>) =>
          fs.readFileString(file).pipe(
            Effect.orElseSucceed(() => ""),
            Effect.flatMap((text) =>
              Effect.forEach(nonEmptyLines(text), (one) => Effect.option(Schema.decodeEffect(line)(one)))
            ),
            Effect.map((found) => found.flatMap(Option.match({ onNone: () => [], onSome: (one) => [one] })))
          )

        const all = decodedLines(inbox, MessageLine).pipe(Effect.withSpan("Messages.all"))

        const unread = Effect.gen(function* () {
          const messages = yield* all
          const marks = yield* decodedLines(readMarks, ReadLine)
          const read = new Set(marks.map((mark) => mark.id))

          return messages.filter((message) => !read.has(message.id))
        }).pipe(Effect.withSpan("Messages.unread"))

        const add = Effect.fn("Messages.add")(function* (message: InboxMessage) {
          const line = yield* Schema.encodeEffect(MessageLine)(message).pipe(Effect.mapError(unavailable))

          yield* append(inbox, line)
        })

        const markRead = Effect.fn("Messages.markRead")(function* (messages: ReadonlyArray<InboxMessage>) {
          const lines = yield* Effect.forEach(messages, (message) =>
            Schema.encodeEffect(ReadLine)({ id: message.id }).pipe(Effect.mapError(unavailable))
          )

          yield* Effect.forEach(lines, (line) => append(readMarks, line), { discard: true })
        })

        return Messages.of({ add, all, unread, markRead })
      })
    )
}
