import { Context, Effect, FileSystem, Layer, Path, Redacted, Schema } from "effect"
import { FileName, maxFileBytes } from "@sth-seat/protocol/Ids.ts"
import type { CommandId, FileBytes, FilePath, SecretName, SecretValue } from "@sth-seat/protocol/Ids.ts"

export class FileRefused extends Schema.TaggedError<FileRefused, { readonly brand: unique symbol }>()("FileRefused", {
  path: Schema.String,
  problem: Schema.String
}) {
  override get message() {
    return `${this.path} ${this.problem}`
  }
}

const megabytes = (bytes: number): string => `${Math.ceil(bytes / (1024 * 1024))} MB`

const decodeName = Schema.decodeUnknownEffect(FileName)

const shownKinds = [
  "html",
  "htm",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "heic",
  "tif",
  "tiff",
  "bmp",
  "txt",
  "md",
  "markdown",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "xml",
  "diff",
  "patch",
  "rtf",
  "docx",
  "xlsx",
  "pptx",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mp3",
  "m4a",
  "wav"
]

const executable = 0o111

export const isShownKind = (name: string): boolean => {
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return false

  return shownKinds.includes(name.slice(dot + 1).toLowerCase())
}

const onlyRevealed = "so it is only shown in the file manager (open it with --reveal), never opened where it could run."

export class Files extends Context.Service<
  Files,
  {
    read(path: FilePath): Effect.Effect<{ readonly name: FileName; readonly bytes: FileBytes }, FileRefused>
    receive(id: CommandId, name: FileName, bytes: FileBytes): Effect.Effect<string, FileRefused>
    storeSecret(name: SecretName, value: SecretValue): Effect.Effect<string, FileRefused>
    showable(file: string): Effect.Effect<void, FileRefused>
  }
>()("seat/domains/files/Files") {
  static readonly layer = (inbox: string, secrets: string = `${inbox}/../secrets`) =>
    Layer.effect(
      Files,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const read = Effect.fn("Files.read")(function* (file: FilePath) {
          const refuse = (problem: string) => new FileRefused({ path: file, problem })
          const info = yield* fs.stat(file).pipe(Effect.mapError((error) => refuse(`can't be read: ${error.message}`)))
          if (info.type !== "File") return yield* refuse("isn't a regular file.")
          if (Number(info.size) > maxFileBytes)
            return yield* refuse(
              `is ${megabytes(Number(info.size))}; files up to ${megabytes(maxFileBytes)} can be sent.`
            )
          const bytes = yield* fs
            .readFile(file)
            .pipe(Effect.mapError((error) => refuse(`can't be read: ${error.message}`)))
          const name = yield* decodeName(path.basename(file)).pipe(Effect.mapError(() => refuse("has no usable name.")))

          return { name, bytes }
        })

        const receive = Effect.fn("Files.receive")(function* (id: CommandId, name: FileName, bytes: FileBytes) {
          const folder = path.join(inbox, id)
          const target = path.join(folder, name)
          const refuse = (error: { readonly message: string }) =>
            new FileRefused({ path: target, problem: `can't be written: ${error.message}` })
          yield* fs.makeDirectory(folder, { recursive: true }).pipe(Effect.mapError(refuse))
          yield* fs.writeFile(target, bytes).pipe(Effect.mapError(refuse))

          return target
        })

        const storeSecret = Effect.fn("Files.storeSecret")(function* (name: SecretName, value: SecretValue) {
          const target = path.join(secrets, name)
          const refuse = (error: { readonly message: string }) =>
            new FileRefused({ path: target, problem: `can't be written: ${error.message}` })
          yield* fs.makeDirectory(secrets, { recursive: true, mode: 0o700 }).pipe(Effect.mapError(refuse))
          yield* fs.writeFileString(target, Redacted.value(value), { mode: 0o600 }).pipe(Effect.mapError(refuse))
          yield* fs.chmod(target, 0o600).pipe(Effect.mapError(refuse))

          return path.normalize(target)
        })

        const showable = Effect.fn("Files.showable")(function* (file: string) {
          const refuse = (problem: string) => new FileRefused({ path: file, problem })
          const info = yield* fs.stat(file).pipe(Effect.mapError((error) => refuse(`can't be read: ${error.message}`)))
          if (info.type !== "File") return yield* refuse(`is a folder or bundle, ${onlyRevealed}`)
          if ((info.mode & executable) !== 0) return yield* refuse(`is executable, ${onlyRevealed}`)
          if (!isShownKind(path.basename(file)))
            return yield* refuse(`isn't a kind of document this machine opens, ${onlyRevealed}`)
        })

        return Files.of({ read, receive, storeSecret, showable })
      })
    )
}
