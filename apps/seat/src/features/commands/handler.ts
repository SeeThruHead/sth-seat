import { DateTime, Effect, Match, Option, Result, Schema } from "effect"
import type { Cause } from "effect"
import type { HubCommand, Outcome } from "@sth-seat/protocol/Daemon.ts"
import { WebUrl } from "@sth-seat/protocol/Ids.ts"
import type { FilePath, MachineName, Title } from "@sth-seat/protocol/Ids.ts"
import { isFresh } from "@sth-seat/protocol/Freshness.ts"
import { Envelope } from "@sth-seat/protocol/Remote.ts"
import { unseal } from "@sth-seat/protocol/Sealed.ts"
import type { Sealed } from "@sth-seat/protocol/Sealed.ts"
import { Audit } from "../../domains/audit/Audit.ts"
import { Files } from "../../domains/files/Files.ts"
import { Me } from "../../domains/identity/Me.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import { decide, deliveryRefusal, expandHome, hub, keepsSecrets } from "../../domains/policy/Policy.ts"
import type { Capability, PolicyFile, Received } from "../../domains/policy/Policy.ts"
import { problemOf } from "../../domains/problem/Problem.ts"
import { Tunnels } from "../../domains/tunnels/Tunnels.ts"
import { Desktop } from "../../platform/Desktop.ts"

export type HubMade = Exclude<HubCommand, { readonly _tag: "Relayed" | "Abort" }>

const done: Outcome = { _tag: "Done" }

const refused = (reason: string): Outcome => ({ _tag: "Refused", reason })

const refusal = (cause: Cause.Cause<{ readonly message: string }>): Effect.Effect<Outcome> =>
  Option.match(problemOf(cause), {
    onNone: () => Effect.interrupt,
    onSome: (reason) => Effect.succeed(refused(reason))
  })

const isOwnShare = Effect.fnUntraced(function* (grant: Sealed, path: FilePath, home: string) {
  const me = yield* Me
  const envelope = yield* unseal(Envelope, me.publicKey, "command", grant).pipe(Effect.option)
  if (Option.isNone(envelope)) return false
  const now = yield* DateTime.now
  if (!isFresh(envelope.value.issuedAt, now)) return false
  if (envelope.value.from !== me.name) return false
  if (envelope.value.request._tag !== "Share") return false

  return expandHome(envelope.value.request.path, home) === path
})

type Need = { readonly capability: Capability; readonly path: Option.Option<string> }

const receives = (capability: Received): Need => ({ capability, path: Option.none() })

const needs = (command: HubMade): Need =>
  Match.valueTags(command, {
    ReadFile: ({ path }): Need => ({ capability: "read", path: Option.some(path) }),
    OpenUrl: () => receives("open-url"),
    OpenFile: ({ reveal }) => receives(reveal === true ? "reveal" : "open-file"),
    ReceiveFile: ({ reveal }) => receives(reveal === true ? "reveal" : "open-file"),
    Notify: () => receives("notify"),
    OpenTunnel: () => receives("open-tunnelled-page"),
    AskSecret: () => receives("ask-secret"),
    StoreSecret: () => receives("store-secret")
  })

const keptHere =
  "Secrets asked from this machine stay on it (secrets: here in ~/.config/sth-seat/policy.yaml), so it takes none through the hub."

const originOf = (command: HubMade): Option.Option<MachineName | undefined> =>
  command._tag === "ReadFile" || command._tag === "StoreSecret" ? Option.none() : Option.some(command.origin)

const refusesOrigin = Effect.fnUntraced(function* (command: HubMade, policy: PolicyFile) {
  const me = yield* Me
  const origin = originOf(command)
  if (Option.isNone(origin)) return Option.none<string>()

  return deliveryRefusal(policy, origin.value, me.name)
})

const refusesSecret = (command: HubMade, policy: PolicyFile): boolean =>
  command._tag === "StoreSecret" && keepsSecrets(policy)

const whyNot = Effect.fnUntraced(function* (command: HubMade, home: string) {
  const audit = yield* Audit
  const policies = yield* Policies
  if (yield* audit.isLocked) return Option.some("This machine is locked; run `sth-seat unlock` on it.")
  const shared = command._tag === "ReadFile" && command.grant !== undefined
  if (shared && (yield* isOwnShare(command.grant, command.path, home))) return Option.none<string>()
  const policy = yield* policies.current.pipe(Effect.result)
  if (Result.isFailure(policy)) return Option.some(policy.failure.message)
  if (refusesSecret(command, policy.success)) return Option.some(keptHere)
  const foreign = yield* refusesOrigin(command, policy.success)
  if (Option.isSome(foreign)) return foreign
  const decision = decide(policy.success, { caller: hub, ...needs(command) }, home)

  return Result.isFailure(decision) ? Option.some(decision.failure) : Option.none<string>()
})

const perform = Effect.fnUntraced(function* (command: HubMade) {
  const desktop = yield* Desktop
  const files = yield* Files
  const tunnels = yield* Tunnels

  const opened = (path: string, title: Title | undefined) =>
    files.showable(path).pipe(Effect.andThen(desktop.openFile(path, Option.fromNullishOr(title))))

  const show = (path: string, title: Title | undefined, reveal: boolean | undefined) =>
    reveal === true ? desktop.revealFile(path) : opened(path, title)

  return yield* Match.valueTags(command, {
    OpenUrl: ({ url }) => Effect.as(desktop.openUrl(url), done),
    OpenFile: ({ path, title, reveal }) => Effect.as(show(path, title, reveal), done),
    ReadFile: ({ path }) => Effect.map(files.read(path), (file): Outcome => ({ _tag: "FileRead", ...file })),
    ReceiveFile: ({ id, name, bytes, title, reveal }) =>
      files.receive(id, name, bytes).pipe(
        Effect.flatMap((saved) => show(saved, title, reveal)),
        Effect.as(done)
      ),
    Notify: ({ title, message }) => Effect.as(desktop.notify(title, message), done),
    AskSecret: ({ name, question, destination }) =>
      desktop.askSecret(name, question, Option.fromNullishOr(destination)).pipe(
        Effect.map((value): Outcome => ({ _tag: "SecretGiven", value })),
        Effect.catchTag("CommandFailed", () =>
          Effect.succeed(refused("The user didn't answer: the prompt was cancelled, closed or timed out."))
        )
      ),
    StoreSecret: ({ name, value }) =>
      Effect.map(files.storeSecret(name, value), (path): Outcome => ({ _tag: "Stored", path })),
    OpenTunnel: ({ origin, scheme, port, path }) =>
      tunnels.localPortFor(origin, port).pipe(
        Effect.flatMap((local) => Schema.decodeEffect(WebUrl)(`${scheme}://127.0.0.1:${local}${path}`)),
        Effect.flatMap((url) => desktop.openUrl(url)),
        Effect.as(done)
      )
  })
})

const targetOf = (command: HubMade): string =>
  Match.valueTags(command, {
    OpenUrl: ({ url }) => url,
    OpenFile: ({ path }) => path,
    ReadFile: ({ path }) => path,
    ReceiveFile: ({ name }) => name,
    OpenTunnel: ({ origin, port, path }) => `${origin}:${port}${path}`,
    Notify: ({ title }) => title,
    AskSecret: ({ name }) => name,
    StoreSecret: ({ name }) => name
  })

export const execute = Effect.fn("Commands.execute")(function* (command: HubMade, home: string) {
  const audit = yield* Audit
  yield* Effect.annotateCurrentSpan({ "command.kind": command._tag })
  const reason = yield* whyNot(command, home)
  const record = (result: string) =>
    audit.record({ caller: hub, action: command._tag, target: targetOf(command), result })
  if (Option.isSome(reason)) return yield* record(`refused: ${reason.value}`).pipe(Effect.as(refused(reason.value)))
  const outcome = yield* perform(command).pipe(Effect.catchCause(refusal))

  yield* record(outcome._tag === "Refused" ? `failed: ${outcome.reason}` : "done")

  return outcome
}, Effect.catchCause(refusal))
