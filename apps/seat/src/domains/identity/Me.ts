import { Context } from "effect"
import type { MachineName } from "@sth-seat/protocol/Ids.ts"
import type { MachinePrivateKey, MachinePublicKey } from "@sth-seat/protocol/Keys.ts"

export class Me extends Context.Service<
  Me,
  { readonly name: MachineName; readonly key: MachinePrivateKey; readonly publicKey: MachinePublicKey }
>()("seat/domains/identity/Me") {}
