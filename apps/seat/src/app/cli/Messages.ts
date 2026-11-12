import { Duration, Effect, Schedule, Schema, Stdio, Stream } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { MessageText } from "@sth-seat/protocol/Remote.ts"
import { InboxMessage, Messages } from "../../domains/messages/Messages.ts"
import type { InboxMessage as Message } from "../../domains/messages/Messages.ts"
import { askDaemon } from "../LocalClient.ts"
import { RemoteProblem, linkTo, sendMessage, throughDaemon } from "../Remote.ts"
import { jsonFlag, report } from "./Output.ts"
import { machineLayers, withDaemon } from "./Settings.ts"

const Sent = Schema.Struct({ to: MachineName, bytes: Schema.Int })

const Inbox = Schema.Struct({ messages: Schema.Array(InboxMessage) })

const usualWait = 600

const fromStdin = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio

  return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)
}).pipe(
  Effect.mapError((error) => new RemoteProblem({ problem: `Can't read the message from stdin: ${String(error)}` }))
)

const messageText = Effect.fnUntraced(function* (words: ReadonlyArray<string>) {
  const text = words.length > 0 ? words.join(" ") : yield* fromStdin

  return yield* Schema.decodeEffect(MessageText)(text.trim()).pipe(
    Effect.mapError(
      () => new RemoteProblem({ problem: "A message is 1 to 65536 characters, given as arguments or on stdin." })
    )
  )
})

const send = Command.make(
  "send",
  {
    machine: Argument.String("machine").pipe(
      Argument.withSchema(MachineName),
      Argument.withDescription("The machine to send to, as named in the hub's config")
    ),
    text: Argument.String("text").pipe(
      Argument.variadic({ min: 0 }),
      Argument.withDescription("The message; read from stdin when left out")
    ),
    json: jsonFlag
  },
  Effect.fn("Cli.send")(function* ({ machine, text, json }) {
    const found = yield* withDaemon
    const message = yield* messageText(text)
    const bytes = yield* askDaemon(found, (daemon, me) =>
      linkTo(throughDaemon(daemon), me, machine).pipe(
        Effect.flatMap((link) => sendMessage(link, message)),
        Effect.scoped
      )
    ).pipe(Effect.provide(machineLayers(found)))

    yield* report(Sent, json, { to: machine, bytes }, `Sent to ${machine}; it's in that machine's inbox.`)
  })
).pipe(
  Command.withDescription(
    "Send a message (a request, never a command) to another of the user's machines; it lands in that machine's inbox, if its policy takes messages from this one"
  )
)

const printed = (message: Message): string => `From ${message.from} at ${message.at}:\n${message.text}\n`

export class NoMessage extends Schema.TaggedError<NoMessage, { readonly brand: unique symbol }>()("NoMessage", {
  seconds: Schema.Int
}) {
  override get message() {
    return `No message arrived within ${this.seconds} seconds.`
  }
}

const nextUnread = Effect.fnUntraced(function* (seconds: number) {
  const messages = yield* Messages

  return yield* messages.unread.pipe(
    Effect.repeat({ until: (found) => found.length > 0, schedule: Schedule.spaced("1 second") }),
    Effect.timeoutOrElse({
      duration: Duration.seconds(seconds),
      orElse: () => Effect.fail(new NoMessage({ seconds }))
    })
  )
})

type Reading = { readonly all: boolean; readonly wait: boolean; readonly timeout: number; readonly json: boolean }

const readInbox = Effect.fnUntraced(function* ({ all, wait, timeout, json }: Reading) {
  const messages = yield* Messages
  const unread = wait ? yield* nextUnread(timeout) : yield* messages.unread
  const shown = all ? yield* messages.all : unread
  yield* messages.markRead(unread)
  const text = shown.length === 0 ? "No messages." : shown.map(printed).join("\n")

  yield* report(Inbox, json, { messages: shown }, text)
})

const inbox = Command.make(
  "inbox",
  {
    all: Flag.Boolean("all").pipe(Flag.withDescription("List every message, read or not"), Flag.withDefault(false)),
    wait: Flag.Boolean("wait").pipe(
      Flag.withDescription("Wait for an unread message when there is none"),
      Flag.withDefault(false)
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription(`Seconds --wait waits before giving up (default ${usualWait})`),
      Flag.withDefault(usualWait)
    ),
    json: jsonFlag
  },
  Effect.fn("Cli.inbox")(function* (reading) {
    const found = yield* withDaemon

    yield* readInbox(reading).pipe(Effect.provide(Messages.layer(found.stateDir)))
  })
).pipe(
  Command.withDescription(
    "List the unread messages other machines sent here (sender, time, text) and mark them read; --wait waits for the next one"
  )
)

export const messageCommands = [send, inbox] as const
