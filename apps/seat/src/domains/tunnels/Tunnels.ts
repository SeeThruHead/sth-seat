import { Context, Schema } from "effect"
import type { Effect } from "effect"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { Port } from "@sth-seat/protocol/Remote.ts"

export class TunnelFailed extends Schema.TaggedError<TunnelFailed, { readonly brand: unique symbol }>()(
  "TunnelFailed",
  { problem: Schema.String }
) {
  override get message() {
    return this.problem
  }
}

export class Tunnels extends Context.Service<
  Tunnels,
  { localPortFor(origin: MachineName, port: Port): Effect.Effect<number, TunnelFailed> }
>()("seat/domains/tunnels/Tunnels") {}
