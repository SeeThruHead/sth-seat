import { Rpc } from "effect/rpc"
import { Tool } from "effect/ai"

export const Ping = Rpc.make("Ping")

export const PingTool = Tool.make("ping")
