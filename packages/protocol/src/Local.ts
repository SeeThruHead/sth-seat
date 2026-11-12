import { Schema } from "effect"
import { procedure, procedures } from "./Action.ts"
import { ActionFailed, Whereabouts, askUserSecret, notifyUser, openForUser } from "./Actions.ts"
import { RelayFailed } from "./Daemon.ts"
import { Envelope } from "./Remote.ts"
import { Sealed } from "./Sealed.ts"

export const LocalWhere = procedure("Where", { success: Whereabouts, error: ActionFailed })

export const LocalRelay = procedure("Relay", {
  payload: Schema.Struct({ envelope: Envelope }),
  success: Sealed,
  error: RelayFailed,
  stream: true
})

export const LocalRelayMore = procedure("RelayMore", {
  payload: Schema.Struct({ envelope: Envelope }),
  error: RelayFailed
})

export const LocalRpcs = procedures(
  openForUser.procedure,
  LocalWhere,
  notifyUser.procedure,
  askUserSecret.procedure,
  LocalRelay,
  LocalRelayMore
)

export const localSocketName = "daemon.sock"
