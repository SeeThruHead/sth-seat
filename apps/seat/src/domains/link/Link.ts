import { Context, DateTime, Duration, Effect, FileSystem, Layer, Option, Path } from "effect"

export type LinkState =
  | { readonly _tag: "Connected" }
  | { readonly _tag: "Stopped"; readonly since: DateTime.Utc }
  | { readonly _tag: "Lost"; readonly since: DateTime.Utc; readonly reason: string }
  | { readonly _tag: "Never" }

export const staleAfter = Duration.seconds(60)

const connectedText = "connected"

const lostPrefix = "lost\n"

const stateOf = (text: string, written: DateTime.Utc, now: DateTime.Utc): LinkState => {
  if (text.startsWith(lostPrefix)) return { _tag: "Lost", since: written, reason: text.slice(lostPrefix.length).trim() }
  if (Duration.isGreaterThan(DateTime.distance(written, now), staleAfter)) return { _tag: "Stopped", since: written }

  return { _tag: "Connected" }
}

const ago = (since: DateTime.Utc, now: DateTime.Utc): string => {
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(DateTime.distance(since, now))))
  if (seconds < 120) return `${seconds}s ago`
  if (seconds < 7200) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 172_800) return `${Math.floor(seconds / 3600)} h ago`

  return `${Math.floor(seconds / 86_400)} days ago`
}

export const linkProblem = (state: LinkState, now: DateTime.Utc): Option.Option<string> => {
  if (state._tag === "Connected") return Option.none()
  if (state._tag === "Never")
    return Option.some(
      "this machine's daemon has never linked to the hub, so nothing the hub sends reaches it; start it with `sth-seat install`."
    )
  if (state._tag === "Stopped")
    return Option.some(
      `this machine's daemon hasn't reported to the hub since ${ago(state.since, now)} (it isn't running); start it with \`sth-seat install\`.`
    )

  return Option.some(
    `this machine's daemon lost its link to the hub ${ago(state.since, now)} (${state.reason}) and is still trying; run \`sth-seat doctor\`.`
  )
}

export class Link extends Context.Service<
  Link,
  {
    readonly connected: Effect.Effect<void>
    lost(reason: string): Effect.Effect<void>
    readonly state: Effect.Effect<LinkState>
  }
>()("seat/domains/link/Link") {
  static readonly layer = (folder: string) =>
    Layer.effect(
      Link,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const file = path.join(folder, "link")

        const write = (text: string) =>
          fs.makeDirectory(folder, { recursive: true }).pipe(
            Effect.andThen(fs.writeFileString(file, text)),
            Effect.catch((error) => Effect.logWarning("can't record the hub link", error.message))
          )

        const text = fs.readFileString(file).pipe(Effect.option)

        const lost = Effect.fnUntraced(function* (reason: string) {
          const before = yield* text
          if (Option.exists(before, (found) => found.startsWith(lostPrefix))) return

          yield* write(`${lostPrefix}${reason}\n`)
        })

        const state = Effect.gen(function* () {
          const found = yield* text
          const info = yield* fs.stat(file).pipe(Effect.option)
          const now = yield* DateTime.now
          if (Option.isNone(found)) return { _tag: "Never" } as const
          const written = Option.flatMap(info, (stat) => stat.mtime)

          return stateOf(
            found.value,
            Option.match(written, { onNone: () => now, onSome: DateTime.fromDateUnsafe }),
            now
          )
        })

        return Link.of({ connected: write(connectedText), lost, state })
      })
    )
}
