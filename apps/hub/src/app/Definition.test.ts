import { BunCrypto, BunHttpServer, BunServices, BunSocket } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Option, Predicate, Schema, Stream } from "effect"
import { Base64Url } from "effect/encoding"
import type { Machine } from "../domains/roster/Roster.ts"
import { HttpRouter, HttpServer } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { DaemonRpcs, daemonAuthClient } from "@sth-seat/protocol/Daemon.ts"
import { Hello, helloHeader } from "@sth-seat/protocol/Hello.ts"
import { IdleMillis, MachineName } from "@sth-seat/protocol/Ids.ts"
import type { MachinePrivateKey } from "@sth-seat/protocol/Keys.ts"
import { Envelope, EnvelopeId, Reply, SessionId } from "@sth-seat/protocol/Remote.ts"
import { Sealed, peek, seal } from "@sth-seat/protocol/Sealed.ts"
import { devMachine, keyedMachines, macMachine, tower } from "../testing/Hub.testing.ts"
import { routes } from "./Definition.ts"
import { TokenHash } from "./HubSettings.ts"
import type { HubSettings } from "./HubSettings.ts"

const settingsOf = (machine: Machine) => ({
  name: machine.name,
  label: machine.label,
  hostnames: machine.hostnames
})

const settings: HubSettings = {
  mcpTokenHash: TokenHash.make("Jh-QIFj5X06s7n_QSKVocwAKR0h9L1M9THVfkUrmaH8"),
  machines: [settingsOf(macMachine), settingsOf(devMachine)]
}

const JsonRpcResult = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      isError: Schema.optionalKey(Schema.Boolean),
      content: Schema.optionalKey(Schema.Array(Schema.Struct({ text: Schema.String })))
    })
  })
)

const Json = Schema.fromJsonString(Schema.Unknown)

const mcp = Effect.fnUntraced(function* (token: string) {
  const { handler, dispose } = HttpRouter.toWebHandler(routes(settings, "test"), { disableLogger: true })
  yield* Effect.addFinalizer(() => Effect.promise(dispose))
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  }
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    Schema.encodeEffect(Json)(body).pipe(
      Effect.flatMap((text) =>
        Effect.promise(() =>
          handler(new Request("http://hub/mcp", { method: "POST", headers: { ...headers, ...extra }, body: text }))
        )
      )
    )
  const initialized = yield* post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  })
  const session = {
    "mcp-session-id": initialized.headers.get("mcp-session-id") ?? "",
    "mcp-protocol-version": "2025-06-18"
  }
  yield* post({ jsonrpc: "2.0", method: "notifications/initialized" }, session)

  const call = Effect.fnUntraced(function* (name: string, args: Record<string, string>) {
    const response = yield* post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
      session
    )
    const text = yield* Effect.promise(() => response.text())

    return yield* Schema.decodeEffect(JsonRpcResult)(text)
  })

  return { status: initialized.status, call, post }
})

describe("MCP endpoint", () => {
  it.effect("turns away a caller without the router's token", () =>
    Effect.gen(function* () {
      const wrong = yield* mcp("wrong")
      const missing = yield* mcp("")

      assert.deepStrictEqual([wrong.status, missing.status], [401, 401])
    }).pipe(Effect.scoped)
  )

  it.effect("answers where_is_user and explains why open_for_user can't open anything yet", () =>
    Effect.gen(function* () {
      const endpoint = yield* mcp("mcp-test-token")
      const where = yield* endpoint.call("where_is_user", {})
      const opened = yield* endpoint.call("open_for_user", { target: "https://example.com" })
      const notified = yield* endpoint.call("notify_user", { title: "Build", message: "It passed." })
      const asked = yield* endpoint.call("ask_user_secret", { name: "token", question: "Token?", from: "nowhere" })

      assert.strictEqual(endpoint.status, 200)
      assert.include(where.result.content?.[0]?.text, "Tower: not connected")
      assert.isTrue(opened.result.isError)
      assert.include(opened.result.content?.[0]?.text, "None of the user's machines")
      assert.include(notified.result.content?.[0]?.text, "None of the user's machines")
      assert.include(asked.result.content?.[0]?.text, "doesn't know a machine called nowhere")
    }).pipe(Effect.scoped)
  )

  it.effect("says the session wasn't found when a client comes back with a session the hub forgot", () =>
    Effect.gen(function* () {
      const endpoint = yield* mcp("mcp-test-token")
      const forgotten = { "mcp-session-id": "made-up-session", "mcp-protocol-version": "2025-06-18" }
      const response = yield* endpoint.post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, forgotten)
      const body = yield* Effect.promise(() => response.text())

      assert.strictEqual(response.status, 404)
      assert.strictEqual(response.headers.get("content-type"), "application/json")
      assert.include(body, "Session not found")
    }).pipe(Effect.scoped)
  )
})

const daemonProtocol = (port: number) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.effect(Socket.Socket, Socket.makeWebSocket(`ws://127.0.0.1:${port}/daemon`))),
    Layer.provide([BunSocket.layerWebSocketConstructor, RpcSerialization.layerNdjson])
  )

const servedPort = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  const address = server.address

  return Predicate.hasProperty(address, "port") && Predicate.isNumber(address.port) ? address.port : 0
})

describe("daemon socket", () => {
  it.live("links a machine, takes its presence and lets it open things through the seat", () =>
    Effect.gen(function* () {
      const { keys, layer } = yield* keyedHub
      const answered = yield* Effect.gen(function* () {
        const port = yield* servedPort
        yield* RpcClient.make(DaemonRpcs).pipe(
          Effect.flatMap((dev) => Stream.runDrain(dev.Attach({ version: "test" }))),
          Effect.scoped,
          Effect.provide(signedAs(port, hello(tower, keys.devKey))),
          Effect.forkScoped
        )

        return yield* Effect.gen(function* () {
          const mac = yield* RpcClient.make(DaemonRpcs)
          const commands = yield* mac.Attach({ version: "test", idle: IdleMillis.make(2_000) }).pipe(
            Stream.take(1),
            Stream.tap((command) => mac.Answer({ id: command.id, outcome: { _tag: "Done" } })),
            Stream.runCollect,
            Effect.forkScoped
          )
          yield* mac.Presence({ idle: IdleMillis.make(1_000) })
          const where = yield* mac.Where().pipe(
            Effect.repeat({
              until: (found) => found.seat === macMachine.name && found.machines.every((one) => one.online)
            })
          )
          const opened = yield* mac.Open({ target: "http://localhost:5173/" })
          const received = yield* Fiber.join(commands)

          return { where, opened, received }
        }).pipe(Effect.scoped, Effect.provide(signedAs(port, hello(macMachine.name, keys.macKey))))
      }).pipe(Effect.scoped, Effect.provide(layer))

      assert.strictEqual(answered.where.seat, "cube")
      assert.include(answered.where.message, "Tower: connected, no input seen yet.")
      assert.strictEqual(answered.opened.url, "http://localhost:5173/")
      assert.deepStrictEqual(
        answered.received.map((command) => command._tag),
        ["OpenUrl"]
      )
    }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))
  )
})

const signedAs = (port: number, header: Effect.Effect<string>) =>
  Layer.mergeAll(daemonProtocol(port), daemonAuthClient(header))

const keyedHub = Effect.gen(function* () {
  const keys = yield* keyedMachines
  const keyed: HubSettings = {
    mcpTokenHash: settings.mcpTokenHash,
    machines: keys.roster.map((machine) => ({
      name: machine.name,
      label: machine.label,
      hostnames: machine.hostnames,
      ...Option.match(machine.publicKey, { onNone: () => ({}), onSome: (publicKey) => ({ publicKey }) })
    }))
  }
  const layer = HttpRouter.serve(routes(keyed, "test"), { disableLogger: true }).pipe(
    Layer.provideMerge(BunHttpServer.layer({ port: 0 }))
  )

  return { keys, layer }
})

const hello = (machine: MachineName, key: MachinePrivateKey) =>
  helloHeader(machine, key).pipe(Effect.orDie, Effect.provide(BunCrypto.layer))

const staleHello = (machine: MachineName, key: MachinePrivateKey) =>
  seal(Hello, key, "hello", { machine, issuedAt: 0, nonce: "a".repeat(22) }).pipe(
    Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Sealed))),
    Effect.map((text) => `Sth-Seat ${Base64Url.encode(text)}`),
    Effect.orDie,
    Effect.provide(BunCrypto.layer)
  )

const whereAs = (port: number, header: Effect.Effect<string>) =>
  RpcClient.make(DaemonRpcs).pipe(
    Effect.flatMap((client) => client.Where()),
    Effect.scoped,
    Effect.provide(signedAs(port, header))
  )

describe("signed hellos", () => {
  it.live("let a machine in with its own key, and turn away stale, replayed and wrongly signed ones", () =>
    Effect.gen(function* () {
      const { keys, layer } = yield* keyedHub
      const outcome = yield* Effect.gen(function* () {
        const port = yield* servedPort
        const fresh = yield* whereAs(port, hello(tower, keys.devKey))
        const once = yield* hello(tower, keys.devKey)
        yield* whereAs(port, Effect.succeed(once))
        const refusals = yield* Effect.forEach(
          [
            Effect.succeed(once),
            staleHello(tower, keys.devKey),
            hello(tower, keys.macKey),
            hello(MachineName.make("stranger"), keys.devKey),
            Effect.succeed("Sth-Seat !!"),
            Effect.succeed("Bearer some-token"),
            Effect.succeed("")
          ],
          (header) => Effect.flip(whereAs(port, header)).pipe(Effect.map((error) => error.message))
        )

        return { fresh, refusals }
      }).pipe(Effect.provide(layer))

      assert.include(outcome.fresh.message, "Cube: not connected")
      assert.deepStrictEqual(outcome.refusals, [
        "This hello was already used.",
        "This hello is too old or from the future; check the clock.",
        "This hello isn't signed by tower's key.",
        "The hub has no public key for stranger.",
        "the hello isn't a signed sth-seat hello",
        "Sign in with this machine's key: run `sth-seat key --name <name>` and add its public key to the hub's config.",
        "Sign in with this machine's key: run `sth-seat key --name <name>` and add its public key to the hub's config."
      ])
    }).pipe(Effect.provide([BunServices.layer, BunCrypto.layer]))
  )

  it.live("relay a sealed command from one machine's CLI to another machine's daemon and back", () =>
    Effect.gen(function* () {
      const { keys, layer } = yield* keyedHub
      const session = SessionId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60")
      const events = yield* Effect.gen(function* () {
        const port = yield* servedPort
        yield* RpcClient.make(DaemonRpcs).pipe(
          Effect.flatMap((mac) =>
            mac.Attach({ version: "test" }).pipe(
              Stream.filter((received) => received._tag === "Relayed"),
              Stream.take(1),
              Stream.runForEach(() =>
                seal(Reply, keys.macKey, "reply", {
                  session,
                  seq: 0,
                  from: macMachine.name,
                  to: devMachine.name,
                  issuedAt: 1,
                  event: { _tag: "Exited", code: 0 }
                }).pipe(Effect.flatMap((sealed) => mac.Reply({ sealed })))
              )
            )
          ),
          Effect.scoped,
          Effect.provide(signedAs(port, hello(macMachine.name, keys.macKey))),
          Effect.forkScoped
        )
        const sealed = yield* seal(Envelope, keys.devKey, "command", {
          id: EnvelopeId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e61"),
          session,
          from: devMachine.name,
          to: macMachine.name,
          issuedAt: 1,
          request: { _tag: "Run", command: "true" }
        })
        const more = yield* seal(Envelope, keys.devKey, "command", {
          id: EnvelopeId.make("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e62"),
          session,
          from: devMachine.name,
          to: macMachine.name,
          issuedAt: 1,
          request: { _tag: "InputEnd" }
        })
        const replies = yield* RpcClient.make(DaemonRpcs).pipe(
          Effect.flatMap((dev) =>
            dev
              .Where()
              .pipe(
                Effect.repeat({ until: (found) => found.machines.some((one) => one.online) }),
                Effect.andThen(
                  Stream.runCollect(
                    dev.Relay({ sealed }).pipe(Stream.tap(() => dev.RelayMore({ sealed: more }).pipe(Effect.ignore)))
                  )
                )
              )
          ),
          Effect.scoped,
          Effect.provide(signedAs(port, hello(devMachine.name, keys.devKey)))
        )

        return yield* Effect.forEach(replies, (one) => peek(Reply, "reply", one))
      }).pipe(Effect.provide(layer))

      assert.deepStrictEqual(
        events.map((one) => one.event),
        [{ _tag: "Exited", code: 0 }]
      )
    }).pipe(Effect.scoped, Effect.provide([BunServices.layer, BunCrypto.layer]))
  )
})
