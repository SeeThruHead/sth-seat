import { Option, Result, Schema } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { RemotePath } from "@sth-seat/protocol/Remote.ts"

export type Spot = { readonly machine: Option.Option<MachineName>; readonly path: string }

const remoteSpot = /^([a-z][a-z0-9-]{0,31}):(.+)$/

export const spotOf = (raw: string): Spot => {
  const found = remoteSpot.exec(raw)
  const machine = found?.[1]
  const path = found?.[2]
  if (machine === undefined || path === undefined) return { machine: Option.none(), path: raw }

  const named = Schema.decodeOption(MachineName)(machine)
  if (Option.isNone(named)) return { machine: Option.none(), path: raw }

  return { machine: named, path }
}

export type CopyPlan = {
  readonly direction: "download" | "upload"
  readonly machine: MachineName
  readonly remote: RemotePath
  readonly local: string
}

const remotePathOn = (machine: MachineName, path: string): Result.Result<RemotePath, string> =>
  Result.mapError(Schema.decodeResult(RemotePath)(path), () => `${path} needs to start with / or ~/ on ${machine}.`)

const planned =
  (direction: CopyPlan["direction"], machine: MachineName, remotePath: string, local: string) =>
  (): Result.Result<CopyPlan, string> =>
    Result.map(remotePathOn(machine, remotePath), (remote): CopyPlan => ({ direction, machine, remote, local }))

export const copyPlan = (from: string, to: string): Result.Result<CopyPlan, string> => {
  const source = spotOf(from)
  const target = spotOf(to)
  const oneRemoteSide = Result.fail("One side of sth-seat cp is machine:path and the other a local path.")
  if (Option.isSome(source.machine) && Option.isSome(target.machine)) return oneRemoteSide

  const download = Option.map(source.machine, (machine) => planned("download", machine, source.path, target.path))
  const upload = Option.map(target.machine, (machine) => planned("upload", machine, target.path, source.path))

  return Option.match(
    Option.orElse(download, () => upload),
    { onNone: () => oneRemoteSide, onSome: (plan) => plan() }
  )
}
