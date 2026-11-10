import { BunSocket, BunSocketServer } from "@effect/platform-bun"
import { Cause, Context, Effect, Layer, Option, Predicate, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { Socket } from "effect/socket"
import type { Port } from "@sth-seat/protocol/Remote.ts"

export class PortUnavailable extends Schema.TaggedError<PortUnavailable, { readonly brand: unique symbol }>()(
  "PortUnavailable",
  { problem: Schema.String }
) {
  override get message() {
    return this.problem
  }
}

export type Pipe = {
  readonly incoming: Stream.Stream<Uint8Array, PortUnavailable>
  readonly send: (bytes: Uint8Array) => Effect.Effect<void, PortUnavailable>
}

const explained = (port: Option.Option<Port>) => (error: Socket.SocketError) => {
  const unopened = Predicate.isTagged(error.reason, "SocketOpenError")
  if (unopened && Option.isSome(port))
    return new PortUnavailable({ problem: `Nothing answers on port ${port.value} there.` })

  return new PortUnavailable({ problem: error.message })
}

const isClosed = (cause: Cause.Cause<Socket.SocketError>): boolean =>
  Option.exists(Cause.findErrorOption(cause), (error) => Predicate.isTagged(error.reason, "SocketCloseError"))

const pipeOf = Effect.fnUntraced(function* (socket: Socket.Socket, port: Option.Option<Port>) {
  const writer = yield* socket.writer
  const pipe: Pipe = {
    incoming: Socket.toStream(socket).pipe(
      Stream.catchCause((cause) => (isClosed(cause) ? Stream.empty : Stream.failCause(cause))),
      Stream.mapError(explained(port))
    ),
    send: (bytes) => writer.write(bytes).pipe(Effect.mapError(explained(port)))
  }

  return pipe
})

const portOf = (address: unknown): number =>
  Predicate.hasProperty(address, "port") && Predicate.isNumber(address.port) ? address.port : 0

const connect = Effect.fn("Ports.connect")(function* (port: Port) {
  const socket = yield* BunSocket.makeNet({ host: "127.0.0.1", port, openTimeout: "10 seconds" }).pipe(
    Effect.mapError(explained(Option.some(port)))
  )

  return yield* pipeOf(socket, Option.some(port))
})

const listen = Effect.fn("Ports.listen")(function* (serve: (pipe: Pipe) => Effect.Effect<void>) {
  const server = yield* BunSocketServer.make({ host: "127.0.0.1", port: 0 }).pipe(
    Effect.mapError((error) => new PortUnavailable({ problem: `Can't listen on this machine: ${error.message}` }))
  )
  yield* server
    .run((socket) => Effect.scoped(Effect.flatMap(pipeOf(socket, Option.none()), serve)))
    .pipe(
      Effect.catchCause((cause) => Effect.logWarning("a tunnel listener stopped", cause)),
      Effect.forkScoped
    )

  return portOf(server.address)
})

export class Ports extends Context.Service<
  Ports,
  {
    connect(port: Port): Effect.Effect<Pipe, PortUnavailable, Scope.Scope>
    listen(serve: (pipe: Pipe) => Effect.Effect<void>): Effect.Effect<number, PortUnavailable, Scope.Scope>
  }
>()("seat/platform/Ports") {
  static readonly layer = Layer.succeed(Ports, Ports.of({ connect, listen }))
}
