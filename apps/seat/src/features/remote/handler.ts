import { DateTime, Duration, Effect, FileSystem, HashMap, Match, Option, Path, Ref, Result, Stream } from "effect"
import type { Cause } from "effect"
import { Signature } from "effect/crypto"
import type { Seen } from "@sth-seat/protocol/Freshness.ts"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import { publicKeyOf } from "@sth-seat/protocol/Keys.ts"
import { Envelope, Reply, chunksOf } from "@sth-seat/protocol/Remote.ts"
import type { Event, Port, RemotePath, Run, SessionId } from "@sth-seat/protocol/Remote.ts"
import { peek, seal, unseal } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Audit } from "../../domains/audit/Audit.ts"
import { Me } from "../../domains/identity/Me.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import { decide, expandHome, keyOf } from "../../domains/policy/Policy.ts"
import type { Capability, PolicyFile } from "../../domains/policy/Policy.ts"
import { problemOf } from "../../domains/problem/Problem.ts"
import { Sessions } from "../../domains/sessions/Sessions.ts"
import { Ports } from "../../platform/Ports.ts"
import { Shell } from "../../platform/Shell.ts"
import { admit, locked, unknownCaller } from "./Admission.ts"
import { denied, receiveFile, sendFile } from "./Files.ts"
import type { Answer } from "./Files.ts"

export type Send = (sealed: Sealed) => Effect.Effect<void>

export type RemoteSettings = { readonly home: string; readonly maxRun: Duration.Duration }

const defaultRun = Duration.minutes(10)

const reasonOf = (cause: Cause.Cause<unknown>): string => Option.getOrElse(problemOf(cause), () => "interrupted")

const replier = Effect.fnUntraced(function* (session: SessionId, to: MachineName, send: Send) {
  const me = yield* Me
  const signer = yield* Signature.Signature
  const seq = yield* Ref.make(0)

  const answer: Answer = (event) =>
    Effect.gen(function* () {
      const next = yield* Ref.getAndUpdate(seq, (count) => count + 1)
      const now = yield* DateTime.now
      const reply = { session, seq: next, from: me.name, to, issuedAt: DateTime.toEpochMillis(now), event }
      const sealed = yield* seal(Reply, me.key, "reply", reply)

      yield* send(sealed)
    }).pipe(
      Effect.provideService(Signature.Signature, signer),
      Effect.catchCause((cause) => Effect.logWarning("can't answer a relayed command", cause))
    )

  return answer
})

const resolved = Effect.fnUntraced(function* (path: RemotePath | "~", home: string, forWriting: boolean) {
  const fs = yield* FileSystem.FileSystem
  const paths = yield* Path.Path
  const wanted = paths.resolve(home, expandHome(path, home))
  const real = yield* fs.realPath(wanted).pipe(Effect.option)
  if (Option.isSome(real) || !forWriting) return real

  const parent = yield* fs.realPath(paths.dirname(wanted)).pipe(Effect.option)

  return Option.map(parent, (folder) => paths.join(folder, paths.basename(wanted)))
})

type Checked = { readonly envelope: Envelope; readonly policy: PolicyFile }

const signedBySender = Effect.fnUntraced(function* (claimed: Envelope, sealed: Sealed, policy: PolicyFile) {
  const me = yield* Me
  const pinned = keyOf(policy, claimed.from)
  if (Option.isNone(pinned)) return Result.fail(unknownCaller(me.name, claimed.from))

  const key = yield* publicKeyOf(pinned.value).pipe(Effect.result)
  if (Result.isFailure(key)) return Result.fail(key.failure.message)

  const envelope = yield* unseal(Envelope, key.success, "command", sealed).pipe(Effect.result)

  return Result.mapError(envelope, () => `The command isn't signed by ${claimed.from}'s key.`)
})

const verified = Effect.fnUntraced(function* (claimed: Envelope, sealed: Sealed, seen: Ref.Ref<Seen>) {
  const me = yield* Me
  const audit = yield* Audit
  const policies = yield* Policies
  if (yield* audit.isLocked) return Result.fail(locked)

  const policy = yield* policies.current.pipe(Effect.result)
  if (Result.isFailure(policy)) return Result.fail(policy.failure.message)

  const envelope = yield* signedBySender(claimed, sealed, policy.success)
  if (Result.isFailure(envelope)) return Result.fail(envelope.failure)

  const now = yield* DateTime.now
  const admitted = yield* Ref.modify(seen, (before) => {
    const result = admit(envelope.success, { me: me.name, now, seen: before })

    return [result, Result.getOrElse(result, () => before)]
  })
  const checked: Checked = { envelope: envelope.success, policy: policy.success }

  return Result.map(admitted, () => checked)
})

type Acting = {
  readonly envelope: Envelope
  readonly answer: Answer
  readonly settings: RemoteSettings
  readonly record: (action: string, target: string, result: string) => Effect.Effect<void>
  readonly refuse: (action: string, target: string, reason: string) => Effect.Effect<void>
  readonly allowed: (capability: Capability, path: Option.Option<string>) => Result.Result<void, string>
}

const actingOn = Effect.fnUntraced(function* (checked: Checked, answer: Answer, settings: RemoteSettings) {
  const audit = yield* Audit
  const caller = checked.envelope.from

  const record = (action: string, target: string, result: string) => audit.record({ caller, action, target, result })

  const acting: Acting = {
    envelope: checked.envelope,
    answer,
    settings,
    record,
    refuse: (action, target, reason) =>
      record(action, target, `refused: ${reason}`).pipe(Effect.andThen(answer(denied(reason)))),
    allowed: (capability, path) => decide(checked.policy, { caller, capability, path }, settings.home)
  }

  return acting
})

const started = (accepted: boolean, answer: Answer) =>
  answer(accepted ? { _tag: "Started" } : denied("That session is already running."))

const runShell = Effect.fnUntraced(function* (acting: Acting, request: typeof Run.Type) {
  const sessions = yield* Sessions
  const shell = yield* Shell
  const decision = acting.allowed("shell", Option.none())
  if (Result.isFailure(decision)) return yield* acting.refuse("shell", request.command, decision.failure)

  const home = acting.settings.home
  const cwd = yield* resolved(request.cwd ?? "~", home, false).pipe(Effect.map(Option.getOrElse(() => home)))
  const asked = Duration.seconds(request.timeoutSeconds ?? Duration.toSeconds(defaultRun))
  const timeout = Duration.min(asked, acting.settings.maxRun)

  const recordExit = (event: Event) =>
    event._tag === "Exited" ? acting.record("shell", request.command, `exit ${event.code}`) : Effect.void

  const work = (input: Stream.Stream<Uint8Array>) =>
    shell.run({ command: request.command, cwd, input, timeout }).pipe(
      Stream.runForEach((event) => acting.answer(event).pipe(Effect.andThen(recordExit(event)))),
      Effect.onInterrupt(() => acting.record("shell", request.command, "stopped"))
    )

  yield* acting.record("shell", request.command, "started")
  const accepted = yield* sessions.start(acting.envelope.session, acting.envelope.from, work)

  return yield* started(accepted, acting.answer)
})

const transfer = Effect.fnUntraced(function* (acting: Acting, capability: "read" | "write", requested: RemotePath) {
  const sessions = yield* Sessions
  const context = yield* Effect.context<FileSystem.FileSystem>()
  const path = yield* resolved(requested, acting.settings.home, capability === "write")
  if (Option.isNone(path))
    return yield* acting.refuse(capability, requested, `${requested} doesn't exist on this machine.`)

  const decision = acting.allowed(capability, path)
  if (Result.isFailure(decision)) return yield* acting.refuse(capability, path.value, decision.failure)

  const answer: Answer = (event) =>
    acting
      .answer(event)
      .pipe(
        Effect.andThen(
          event._tag === "Finished" ? acting.record(capability, path.value, `done, ${event.bytes} bytes`) : Effect.void
        )
      )

  const work = (input: Stream.Stream<Uint8Array>) =>
    (capability === "read" ? sendFile(path.value, answer) : receiveFile(path.value, input, answer)).pipe(
      Effect.catchCause((cause) => answer(denied(`Can't ${capability} ${path.value}: ${reasonOf(cause)}`))),
      Effect.provideContext(context),
      Effect.onInterrupt(() => acting.record(capability, path.value, "stopped"))
    )

  yield* acting.record(capability, path.value, "started")
  const accepted = yield* sessions.start(acting.envelope.session, acting.envelope.from, work)

  return yield* started(accepted, acting.answer)
})

const tunnelIn = Effect.fnUntraced(function* (acting: Acting, port: Port) {
  const sessions = yield* Sessions
  const ports = yield* Ports
  const target = `port ${port}`
  const decision = acting.allowed("tunnel", Option.none())
  if (Result.isFailure(decision)) return yield* acting.refuse("tunnel", target, decision.failure)

  const sendBack = (bytes: Uint8Array) =>
    Effect.forEach(chunksOf(bytes), (chunk) => acting.answer({ _tag: "Output", channel: "stdout", bytes: chunk }), {
      discard: true
    })

  const work = (input: Stream.Stream<Uint8Array>) =>
    Effect.gen(function* () {
      const pipe = yield* ports.connect(port)
      const total = yield* Ref.make(0)
      const incoming = pipe.incoming.pipe(
        Stream.tap((bytes) => Ref.update(total, (sum) => sum + bytes.length)),
        Stream.runForEach(sendBack)
      )

      yield* Effect.raceFirst(Stream.runForEach(input, pipe.send), incoming)
      const bytes = yield* Ref.get(total)
      yield* acting.record("tunnel", target, `closed, ${bytes} bytes back`)

      yield* acting.answer({ _tag: "Finished", bytes })
    }).pipe(
      Effect.scoped,
      Effect.catchCause((cause) => cause.pipe(reasonOf, denied, acting.answer)),
      Effect.onInterrupt(() => acting.record("tunnel", target, "stopped"))
    )

  yield* acting.record("tunnel", target, "started")
  const accepted = yield* sessions.start(acting.envelope.session, acting.envelope.from, work)

  return yield* started(accepted, acting.answer)
})

const act = Effect.fnUntraced(function* (checked: Checked, answer: Answer, settings: RemoteSettings) {
  const sessions = yield* Sessions
  const acting = yield* actingOn(checked, answer, settings)
  const { session, from } = checked.envelope

  return yield* Match.valueTags(checked.envelope.request, {
    Run: (request) => runShell(acting, request),
    Read: (request) => transfer(acting, "read", request.path),
    Write: (request) => transfer(acting, "write", request.path),
    Tunnel: (request) => tunnelIn(acting, request.port),
    Input: (request) => Effect.asVoid(sessions.feed(session, from, request.bytes)),
    InputEnd: () => Effect.asVoid(sessions.endInput(session, from)),
    Cancel: () => Effect.asVoid(sessions.stop(session, Option.some(from))),
    Share: () => answer(denied("Share only travels as a grant with a file to open."))
  })
})

export const relayed = Effect.fn("Remote.relayed")(function* (
  sealed: Sealed,
  send: Send,
  seen: Ref.Ref<Seen>,
  settings: RemoteSettings
) {
  const audit = yield* Audit
  const claimed = yield* peek(Envelope, "command", sealed).pipe(Effect.option)
  if (Option.isNone(claimed))
    return yield* audit.record({
      caller: "unknown",
      action: "relay",
      target: "-",
      result: "refused: unreadable command"
    })

  const { from, session, request } = claimed.value
  yield* Effect.annotateCurrentSpan({ from, request: request._tag })
  const answer = yield* replier(session, from, send)
  const checked = yield* verified(claimed.value, sealed, seen)
  if (Result.isSuccess(checked)) return yield* act(checked.success, answer, settings)

  yield* audit.record({ caller: from, action: request._tag, target: "-", result: `refused: ${checked.failure}` })

  yield* answer(denied(checked.failure))
})

export const aborted = Effect.fn("Remote.aborted")(function* (session: SessionId) {
  const sessions = yield* Sessions

  yield* sessions.stop(session, Option.none())
})

export const freshSeen = Ref.make<Seen>(HashMap.empty())
