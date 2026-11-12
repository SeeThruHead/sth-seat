import { Console, Effect, FileSystem, Option, Path, Schema } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { newKeyPair, pemOf, privateKeyFromPem, publicKeyFrom, textOf } from "@sth-seat/protocol/Keys.ts"
import type { MachinePrivateKey, MachinePublicKey, PublicKeyText } from "@sth-seat/protocol/Keys.ts"

export type Identity = {
  readonly name: MachineName
  readonly key: MachinePrivateKey
  readonly publicKey: MachinePublicKey
  readonly publicText: PublicKeyText
}

export type IdentityFiles = { readonly keyFile: string; readonly nameFile: string }

export class IdentityProblem extends Schema.TaggedError<IdentityProblem, { readonly brand: unique symbol }>()(
  "IdentityProblem",
  { problem: Schema.String }
) {
  override get message() {
    return this.problem
  }
}

const problem = (text: string) => new IdentityProblem({ problem: text })

const inOwnWords = (error: { readonly message: string }) => problem(error.message)

const keyIn = Effect.fnUntraced(function* (files: IdentityFiles) {
  const fs = yield* FileSystem.FileSystem
  const pem = yield* fs
    .readFileString(files.keyFile)
    .pipe(Effect.mapError((error) => problem(`Can't read ${files.keyFile}: ${error.message}`)))

  return yield* privateKeyFromPem(pem).pipe(Effect.mapError(inOwnWords))
})

const nameIn = Effect.fnUntraced(function* (files: IdentityFiles) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs
    .readFileString(files.nameFile)
    .pipe(Effect.mapError(() => problem(`No machine name at ${files.nameFile}. Run \`sth-seat key --name <name>\`.`)))

  return yield* Schema.decodeEffect(MachineName)(text.trim()).pipe(
    Effect.mapError(() => problem(`${files.nameFile} doesn't hold a machine name.`))
  )
})

export const machineName = Effect.fn("Identity.machineName")(function* (files: IdentityFiles) {
  return yield* nameIn(files)
})

export const readIdentity = Effect.fn("Identity.readIdentity")(function* (files: IdentityFiles) {
  const fs = yield* FileSystem.FileSystem
  const present = yield* fs.exists(files.keyFile).pipe(Effect.orElseSucceed(() => false))
  if (!present) return Option.none<Identity>()

  const key = yield* keyIn(files)
  const name = yield* nameIn(files)
  const publicKey = yield* publicKeyFrom(key).pipe(Effect.mapError(inOwnWords))
  const publicText = yield* textOf(publicKey).pipe(Effect.mapError(inOwnWords))
  const identity: Identity = { name, key, publicKey, publicText }

  return Option.some(identity)
})

export const requireIdentity = Effect.fn("Identity.requireIdentity")(function* (files: IdentityFiles) {
  const found = yield* readIdentity(files)
  if (Option.isNone(found))
    return yield* problem(`No machine key at ${files.keyFile}. Run \`sth-seat key --name <this machine's name>\`.`)

  return found.value
})

const privately = Effect.fnUntraced(function* (file: string, content: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 }).pipe(
    Effect.andThen(fs.writeFileString(file, content, { mode: 0o600 })),
    Effect.mapError((error) => problem(`Can't write ${file}: ${error.message}`))
  )
})

export const issueKey = Effect.fn("Identity.issueKey")(function* (
  files: IdentityFiles,
  name: MachineName,
  force: boolean
) {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(files.keyFile).pipe(Effect.orElseSucceed(() => false))
  if (exists && !force)
    return yield* problem(`${files.keyFile} already holds this machine's key. Pass --force to replace it.`)

  const pair = yield* newKeyPair.pipe(Effect.mapError(inOwnWords))
  const pem = yield* pemOf(pair.privateKey).pipe(Effect.mapError(inOwnWords))
  const text = yield* textOf(pair.publicKey).pipe(Effect.mapError(inOwnWords))
  yield* privately(files.keyFile, pem)
  yield* privately(files.nameFile, `${name}\n`)

  yield* Console.log(`Wrote ${name}'s key to ${files.keyFile}.`)
  yield* Console.log(`Public key: ${text}`)
  yield* Console.log(`In the hub's sth-seat.yaml, under this machine: publicKey: ${text}`)
  yield* Console.log(`In other machines' policy.yaml, under machines: ${name}: ${text}`)
})
