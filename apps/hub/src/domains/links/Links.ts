import { Context, Deferred, Duration, Effect, HashMap, Layer, Option, Queue, Ref, Schema, Stream } from "effect"
import { SecureRandom } from "effect/crypto"
import type { HubCommand, Outcome } from "@sth-seat/protocol/Daemon.ts"
import { CommandId, MachineName, newId } from "@sth-seat/protocol/Ids.ts"

export type CommandBody = {
  readonly [Tag in HubCommand["_tag"]]: Omit<Extract<HubCommand, { readonly _tag: Tag }>, "id">
}[HubCommand["_tag"]]

export class MachineUnreachable extends Schema.TaggedError<MachineUnreachable, { readonly brand: unique symbol }>()(
  "MachineUnreachable",
  { machine: MachineName, reason: Schema.Literals(["not connected", "no answer"]) }
) {}

type Link = { readonly commands: Queue.Queue<HubCommand> }

type Pending = { readonly machine: MachineName; readonly reply: Deferred.Deferred<Outcome, MachineUnreachable> }

export class Links extends Context.Service<
  Links,
  {
    attach(name: MachineName): Stream.Stream<HubCommand>
    readonly online: Effect.Effect<ReadonlyArray<MachineName>>
    call(name: MachineName, body: CommandBody, timeout: Duration.Input): Effect.Effect<Outcome, MachineUnreachable>
    send(name: MachineName, body: CommandBody): Effect.Effect<void, MachineUnreachable>
    answer(id: CommandId, outcome: Outcome): Effect.Effect<void>
  }
>()("hub/domains/links/Links") {
  static readonly layer = Layer.effect(
    Links,
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom
      const links = yield* Ref.make(HashMap.empty<MachineName, Link>())
      const pending = yield* Ref.make(HashMap.empty<CommandId, Pending>())

      const failPendingOf = Effect.fnUntraced(function* (name: MachineName) {
        const mine = yield* Ref.modify(pending, (all) => [
          HashMap.filter(all, (entry) => entry.machine === name),
          HashMap.filter(all, (entry) => entry.machine !== name)
        ])

        yield* Effect.forEach(
          HashMap.values(mine),
          (entry) => Deferred.fail(entry.reply, new MachineUnreachable({ machine: name, reason: "not connected" })),
          { discard: true }
        )
      })

      const detach = Effect.fnUntraced(function* (name: MachineName, link: Link) {
        const current = yield* Ref.get(links)
        if (!Option.exists(HashMap.get(current, name), (found) => found === link)) return
        yield* Ref.set(links, HashMap.remove(current, name))
        yield* failPendingOf(name)
        yield* Effect.logInfo("daemon left", { machine: name })
      })

      const attach = (name: MachineName) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const link: Link = { commands: yield* Queue.unbounded<HubCommand>() }
            yield* Ref.update(links, HashMap.set(name, link))
            yield* Effect.addFinalizer(() => detach(name, link))
            yield* Effect.logInfo("daemon joined", { machine: name })

            return Stream.fromQueue(link.commands)
          })
        )

      const online = Effect.map(Ref.get(links), (current) => Array.from(HashMap.keys(current)))

      const call = Effect.fn("Links.call")(function* (name: MachineName, body: CommandBody, timeout: Duration.Input) {
        yield* Effect.annotateCurrentSpan({ machine: name, "command.kind": body._tag })
        const current = yield* Ref.get(links)
        const link = HashMap.get(current, name)
        if (Option.isNone(link)) return yield* new MachineUnreachable({ machine: name, reason: "not connected" })
        const id = yield* newId(CommandId).pipe(Effect.provideService(SecureRandom.SecureRandom, random))
        const reply = yield* Deferred.make<Outcome, MachineUnreachable>()
        yield* Ref.update(pending, HashMap.set(id, { machine: name, reply }))
        const command: HubCommand = { ...body, id }
        yield* Queue.offer(link.value.commands, command)

        return yield* Deferred.await(reply).pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () => Effect.fail(new MachineUnreachable({ machine: name, reason: "no answer" }))
          }),
          Effect.ensuring(Ref.update(pending, HashMap.remove(id)))
        )
      })

      const send = Effect.fn("Links.send")(function* (name: MachineName, body: CommandBody) {
        yield* Effect.annotateCurrentSpan({ machine: name, "command.kind": body._tag })
        const current = yield* Ref.get(links)
        const link = HashMap.get(current, name)
        if (Option.isNone(link)) return yield* new MachineUnreachable({ machine: name, reason: "not connected" })
        const id = yield* newId(CommandId).pipe(Effect.provideService(SecureRandom.SecureRandom, random))
        const command: HubCommand = { ...body, id }

        yield* Queue.offer(link.value.commands, command)
      })

      const answer = Effect.fn("Links.answer")(function* (id: CommandId, outcome: Outcome) {
        const entry = yield* Ref.modify(pending, (all) => [HashMap.get(all, id), HashMap.remove(all, id)])
        if (Option.isNone(entry)) return

        yield* Deferred.succeed(entry.value.reply, outcome)
      })

      return Links.of({ attach, online, call, send, answer })
    })
  )
}
