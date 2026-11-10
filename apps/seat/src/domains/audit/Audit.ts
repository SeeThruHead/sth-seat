import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"

export const AuditEntry = Schema.Struct({
  at: Schema.String,
  caller: Schema.String,
  action: Schema.String,
  target: Schema.String,
  result: Schema.String
})
export type AuditEntry = typeof AuditEntry.Type

export type Happening = Omit<AuditEntry, "at">

const EntryLine = Schema.fromJsonString(AuditEntry)

export class AuditUnavailable extends Schema.TaggedError<AuditUnavailable, { readonly brand: unique symbol }>()(
  "AuditUnavailable",
  { problem: Schema.String }
) {
  override get message() {
    return `Can't change the lock: ${this.problem}`
  }
}

export class Audit extends Context.Service<
  Audit,
  {
    record(happening: Happening): Effect.Effect<void>
    recent(count: number): Effect.Effect<ReadonlyArray<AuditEntry>>
    readonly isLocked: Effect.Effect<boolean>
    setLocked(locked: boolean): Effect.Effect<void, AuditUnavailable>
  }
>()("seat/domains/audit/Audit") {
  static readonly layer = (folder: string) =>
    Layer.effect(
      Audit,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const log = path.join(folder, "audit.jsonl")
        const lockFile = path.join(folder, "locked")
        const ready = fs.makeDirectory(folder, { recursive: true, mode: 0o700 })

        const record = Effect.fn("Audit.record")(function* (happening: Happening) {
          const now = yield* DateTime.now
          const line = yield* Schema.encodeEffect(EntryLine)({ at: DateTime.formatIso(now), ...happening })

          yield* ready.pipe(
            Effect.andThen(fs.writeFileString(log, `${line}\n`, { flag: "a", mode: 0o600 })),
            Effect.catchCause((cause) => Effect.logWarning("can't write the audit log", cause))
          )
        }, Effect.orDie)

        const recent = Effect.fn("Audit.recent")(function* (count: number) {
          const text = yield* fs.readFileString(log).pipe(Effect.orElseSucceed(() => ""))
          const lines = text.split("\n").filter((line) => line.trim() !== "")
          const decoded = yield* Effect.forEach(lines.slice(-count), (line) =>
            Schema.decodeEffect(EntryLine)(line).pipe(Effect.option)
          )

          return decoded.flatMap(Option.match({ onNone: () => [], onSome: (entry) => [entry] }))
        })

        const isLocked = fs.exists(lockFile).pipe(Effect.orElseSucceed(() => false))

        const setLocked = (locked: boolean) =>
          (locked
            ? ready.pipe(Effect.andThen(fs.writeFileString(lockFile, "locked\n", { mode: 0o600 })))
            : fs.remove(lockFile, { force: true })
          ).pipe(Effect.mapError((error) => new AuditUnavailable({ problem: error.message })))

        return Audit.of({ record, recent, isLocked, setLocked })
      })
    )
}
