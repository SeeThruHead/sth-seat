import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { Rpc, RpcGroup } from "effect/rpc"

export type ActionSpec<
  Name extends string,
  Tag extends string,
  Request extends Schema.Struct.Fields,
  FromAgent extends Schema.Struct.Fields,
  FromMachine extends Schema.Struct.Fields,
  Success extends Schema.Top,
  Failure extends Schema.Top
> = {
  readonly tool: Name
  readonly rpc: Tag
  readonly description: string
  readonly request: Request
  readonly fromAgent: FromAgent
  readonly fromMachine: FromMachine
  readonly success: Success
  readonly failure: Failure
}

export const action = <
  const Name extends string,
  const Tag extends string,
  const Request extends Schema.Struct.Fields,
  const FromAgent extends Schema.Struct.Fields,
  const FromMachine extends Schema.Struct.Fields,
  Success extends Schema.Top,
  Failure extends Schema.Top
>(
  spec: ActionSpec<Name, Tag, Request, FromAgent, FromMachine, Success, Failure>
) => {
  const agentRequest = Schema.Struct({ ...spec.request, ...spec.fromAgent })
  const machineRequest = Schema.Struct({ ...spec.request, ...spec.fromMachine })

  return {
    request: Schema.Struct(spec.request),
    agentRequest,
    machineRequest,
    success: spec.success,
    failure: spec.failure,
    procedure: Rpc.make(spec.rpc, { payload: machineRequest, success: spec.success, error: spec.failure }),
    tool: Tool.make(spec.tool, {
      description: spec.description,
      parameters: agentRequest,
      success: spec.success,
      failure: spec.failure
    })
  }
}

export const actionWithoutInput = <
  const Name extends string,
  const Tag extends string,
  Success extends Schema.Top
>(spec: {
  readonly tool: Name
  readonly rpc: Tag
  readonly description: string
  readonly success: Success
}) => ({
  success: spec.success,
  procedure: Rpc.make(spec.rpc, { success: spec.success }),
  tool: Tool.make(spec.tool, { description: spec.description, parameters: Tool.EmptyParams, success: spec.success })
})

export const procedure = Rpc.make

export const procedures = RpcGroup.make

export const toolkit = Toolkit.make
