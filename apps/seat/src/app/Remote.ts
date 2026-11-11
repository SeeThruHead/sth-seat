import { DateTime, Effect, FileSystem, Option, Ref, Result, Runtime, Schema, Stdio, Stream } from "effect"
import { SecureRandom, Signature } from "effect/crypto"
import type { HubClient } from "./Hub.ts"
import type { Identity } from "./Identity.ts"
import { newId } from "@sth-seat/protocol/Ids.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { publicKeyOf } from "@sth-seat/protocol/Keys.ts"
import type { MachinePublicKey } from "@sth-seat/protocol/Keys.ts"
import {
  Envelope,
  EnvelopeId,
  RemotePath,
  Reply,
  SessionId,
  chunksOf,
  maxChunkBytes
} from "@sth-seat/protocol/Remote.ts"
import type { Event, MessageText, Request } from "@sth-seat/protocol/Remote.ts"
import { seal, unseal } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Policies } from "../domains/policy/Policies.ts"
import { checkedReply } from "../domains/replies/Replies.ts"
import { keyOf } from "../domains/policy/Policy.ts"

export class RemoteProblem extends Schema.TaggedError<RemoteProblem, { readonly brand: unique symbol }>()(
  "RemoteProblem",
  { problem: Schema.String }
) {
  override get message() {
    return this.problem
  }

  override get [Runtime.errorExitCode]() {
    return 255
  }
}

export class RemoteExited extends Schema.TaggedError<RemoteExited, { readonly brand: unique symbol }>()(
  "RemoteExited",
  { code: Schema.Int }
) {
  override get [Runtime.errorExitCode]() {
    return this.code
  }
}

const problem = (text: string) => new RemoteProblem({ problem: text })

export type Link = {
  readonly hub: HubClient
  readonly me: Identity
  readonly target: MachineName
  readonly targetKey: MachinePublicKey
  readonly session: SessionId
}

export const linkTo = Effect.fn("Remote.linkTo")(function* (hub: HubClient, me: Identity, target: MachineName) {
  const policies = yield* Policies
  const policy = yield* policies.current.pipe(Effect.mapError((error) => problem(error.message)))
  const pinned = keyOf(policy, target)
  if (Option.isNone(pinned))
    return yield* problem(
      `This machine doesn't know ${target}'s key; add it under machines in ~/.config/sth-seat/policy.yaml.`
    )

  const targetKey = yield* publicKeyOf(pinned.value).pipe(Effect.mapError((error) => problem(error.message)))
  const session = yield* newId(SessionId)
  const link: Link = { hub, me, target, targetKey, session }

  return link
})

type Sender = Pick<Identity, "name" | "key">

const sealedEnvelope = Effect.fnUntraced(function* (
  me: Sender,
  addressed: { readonly session: SessionId; readonly to: MachineName },
  request: Request
) {
  const id = yield* newId(EnvelopeId)
  const now = yield* DateTime.now
  const envelope = { id, ...addressed, from: me.name, issuedAt: DateTime.toEpochMillis(now), request }

  return yield* seal(Envelope, me.key, "command", envelope).pipe(Effect.mapError((error) => problem(error.message)))
})

const sealedRequest = (link: Link, request: Request) =>
  sealedEnvelope(link.me, { session: link.session, to: link.target }, request)

export const sendMore = Effect.fnUntraced(function* (link: Link, request: Request) {
  const sealed = yield* sealedRequest(link, request)

  yield* link.hub.RelayMore({ sealed }).pipe(Effect.mapError((error) => problem(error.message)))
})

export const sendInput = (link: Link, input: Stream.Stream<Uint8Array, unknown>) =>
  input.pipe(
    Stream.mapError((error) => problem(`Can't read the input: ${String(error)}`)),
    Stream.runForEach((bytes) =>
      Effect.forEach(chunksOf(bytes), (chunk) => sendMore(link, { _tag: "Input", bytes: chunk }), { discard: true })
    ),
    Effect.andThen(sendMore(link, { _tag: "InputEnd" }))
  )

const eventIn = Effect.fnUntraced(function* (link: Link, expected: Ref.Ref<number>, sealed: Sealed) {
  const reply = yield* unseal(Reply, link.targetKey, "reply", sealed).pipe(
    Effect.mapError(() => problem(`A reply didn't carry ${link.target}'s signature; stopping.`))
  )
  const seq = yield* Ref.getAndUpdate(expected, (count) => count + 1)
  const event = checkedReply(reply, { session: link.session, from: link.target, to: link.me.name, seq })

  return yield* Result.match(event, { onFailure: (reason) => Effect.fail(problem(reason)), onSuccess: Effect.succeed })
})

export const start = (
  link: Link,
  request: Request
): Stream.Stream<Event, RemoteProblem, SecureRandom.SecureRandom | Signature.Signature> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const sealed = yield* sealedRequest(link, request)
      const expected = yield* Ref.make(0)

      return link.hub.Relay({ sealed }).pipe(
        Stream.mapError((error) => problem(error.message)),
        Stream.mapEffect((reply) => eventIn(link, expected, reply))
      )
    })
  )

export const writeOut = Effect.fnUntraced(function* (event: Event) {
  const stdio = yield* Stdio.Stdio
  if (event._tag !== "Output") return
  const sink = event.channel === "stdout" ? stdio.stdout() : stdio.stderr()

  yield* Stream.run(Stream.make(event.bytes), sink).pipe(Effect.orDie)
})

export const outcomeOf = Effect.fnUntraced(function* (event: Event) {
  if (event._tag === "Denied") return yield* problem(event.reason)
  if (event._tag === "Exited" && event.code !== 0) return yield* new RemoteExited({ code: event.code })
})

export const shareGrant = Effect.fn("Remote.shareGrant")(function* (me: Sender, path: string) {
  const session = yield* newId(SessionId)
  const remotePath = yield* Schema.decodeEffect(RemotePath)(path).pipe(
    Effect.mapError(() => problem(`${path} isn't a path.`))
  )

  return yield* sealedEnvelope(me, { session, to: me.name }, { _tag: "Share", path: remotePath })
})

export type RunOptions = {
  readonly command: string
  readonly cwd: Option.Option<RemotePath>
  readonly timeoutSeconds: Option.Option<number>
  readonly input: boolean
}

export const runOn = Effect.fn("Remote.runOn")(function* (link: Link, options: RunOptions) {
  const stdio = yield* Stdio.Stdio
  const request: Request = {
    _tag: "Run",
    command: options.command,
    ...Option.match(options.cwd, { onNone: () => ({}), onSome: (cwd) => ({ cwd }) }),
    ...Option.match(options.timeoutSeconds, { onNone: () => ({}), onSome: (timeoutSeconds) => ({ timeoutSeconds }) })
  }
  const feeding = options.input ? sendInput(link, stdio.stdin) : sendMore(link, { _tag: "InputEnd" })
  const feed = whenStarted(feeding)

  yield* start(link, request).pipe(
    Stream.runForEach((event) => feed(event).pipe(Effect.andThen(writeOut(event)), Effect.andThen(outcomeOf(event))))
  )
})

export const whenStarted = <E, R>(feeding: Effect.Effect<void, E, R>) => {
  const begin = feeding.pipe(
    Effect.catchCause((cause) => Effect.logDebug("input stopped", cause)),
    Effect.forkScoped,
    Effect.asVoid
  )

  return (event: Event) => (event._tag === "Started" ? begin : Effect.void)
}

const finishedBytes = (event: Event): Effect.Effect<Option.Option<number>, RemoteProblem | RemoteExited> =>
  outcomeOf(event).pipe(Effect.as(event._tag === "Finished" ? Option.some(event.bytes) : Option.none()))

const remember = (finished: Ref.Ref<Option.Option<number>>) => (event: Event) =>
  finishedBytes(event).pipe(
    Effect.flatMap((bytes) => Ref.update(finished, (before) => Option.orElse(before, () => bytes)))
  )

const bytesOf = (event: Event): Stream.Stream<Uint8Array> =>
  event._tag === "Output" ? Stream.make(event.bytes) : Stream.empty

export const download = Effect.fn("Remote.download")(function* (link: Link, remote: RemotePath, local: string) {
  const fs = yield* FileSystem.FileSystem
  const staging = `${local}.sth-seat-partial`
  const finished = yield* Ref.make(Option.none<number>())
  yield* start(link, { _tag: "Read", path: remote }).pipe(
    Stream.tap(remember(finished)),
    Stream.flatMap(bytesOf),
    Stream.run(fs.sink(staging)),
    Effect.catchTag("PlatformError", (error) => Effect.fail(problem(error.message)))
  )
  const bytes = yield* Ref.get(finished)
  if (Option.isNone(bytes)) return yield* problem(`${link.target} stopped before the whole file arrived.`)

  yield* fs.rename(staging, local).pipe(Effect.mapError((error) => problem(error.message)))

  return bytes.value
})

export const upload = Effect.fn("Remote.upload")(function* (link: Link, local: string, remote: RemotePath) {
  const fs = yield* FileSystem.FileSystem
  const finished = yield* Ref.make(Option.none<number>())
  const feed = whenStarted(sendInput(link, fs.stream(local, { chunkSize: maxChunkBytes })))
  yield* start(link, { _tag: "Write", path: remote }).pipe(
    Stream.runForEach((event) => feed(event).pipe(Effect.andThen(remember(finished)(event))))
  )
  const bytes = yield* Ref.get(finished)
  if (Option.isNone(bytes)) return yield* problem(`${link.target} stopped before the whole file was written.`)

  return bytes.value
})

export const sendMessage = Effect.fn("Remote.sendMessage")(function* (link: Link, text: MessageText) {
  const finished = yield* Ref.make(Option.none<number>())
  yield* start(link, { _tag: "Message", text }).pipe(Stream.runForEach(remember(finished)))
  const bytes = yield* Ref.get(finished)
  if (Option.isNone(bytes)) return yield* problem(`${link.target} stopped before it took the message.`)

  return bytes.value
})
