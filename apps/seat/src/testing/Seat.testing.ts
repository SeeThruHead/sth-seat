import { Context, Effect, FileSystem, Layer, Option, Redacted, Ref } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { newKeyPair } from "@sth-seat/protocol/Keys.ts"
import { Audit } from "../domains/audit/Audit.ts"
import { Files } from "../domains/files/Files.ts"
import { Me } from "../domains/identity/Me.ts"
import { Policies } from "../domains/policy/Policies.ts"
import { TunnelFailed, Tunnels } from "../domains/tunnels/Tunnels.ts"
import { Desktop } from "../platform/Desktop.ts"
import type { SecretDestination } from "@sth-seat/protocol/Daemon.ts"

export const script = Effect.fnUntraced(function* (folder: string, name: string, body: string) {
  const fs = yield* FileSystem.FileSystem
  const path = `${folder}/${name}`
  yield* fs.writeFileString(path, `#!/bin/sh\n${body}\n`)
  yield* fs.chmod(path, 0o755)

  return path
})

export class Opened extends Context.Service<Opened, { readonly all: Effect.Effect<ReadonlyArray<string>> }>()(
  "seat/testing/Seat.testing/Opened"
) {}

const goingTo = (destination: Option.Option<SecretDestination>): string =>
  Option.match(destination, { onNone: () => "", onSome: (to) => ` (to ${to.machine} ${to.file})` })

export const recordingDesktop = Layer.effectContext(
  Effect.gen(function* () {
    const opened = yield* Ref.make<ReadonlyArray<string>>([])
    const record = (entry: string) => Ref.update(opened, (all) => [...all, entry])

    return Context.make(
      Desktop,
      Desktop.of({
        openUrl: (url) => record(`url ${url}`),
        openFile: (path, title) => record(`file ${path} ${Option.getOrElse(title, () => "-")}`),
        revealFile: (path) => record(`reveal ${path}`),
        notify: (title, message) => record(`notify ${title}: ${message}`),
        askSecret: (name, question, destination) =>
          record(`ask ${name}: ${question}${goingTo(destination)}`).pipe(Effect.as(Redacted.make(`answer for ${name}`)))
      })
    ).pipe(Context.add(Opened, Opened.of({ all: Ref.get(opened) })))
  })
)

export const tower = MachineName.make("tower")

export const testMe = (name: MachineName = tower) =>
  Layer.effect(
    Me,
    Effect.map(newKeyPair, (pair) => Me.of({ name, key: pair.privateKey, publicKey: pair.publicKey })).pipe(
      Effect.orDie
    )
  )

export const writePolicy = Effect.fnUntraced(function* (folder: string, yaml: string) {
  const fs = yield* FileSystem.FileSystem

  yield* fs.writeFileString(`${folder}/policy.yaml`, yaml)
})

export const noTunnels = Layer.succeed(
  Tunnels,
  Tunnels.of({ localPortFor: () => Effect.fail(new TunnelFailed({ problem: "no tunnels in this test" })) })
)

export const machineIn = (folder: string) =>
  Layer.mergeAll(
    Files.layer(`${folder}/inbox`, `${folder}/secrets`),
    Policies.layer(`${folder}/policy.yaml`),
    Audit.layer(`${folder}/state`),
    noTunnels
  )
