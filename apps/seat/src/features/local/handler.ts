import { Effect, Option, Schema } from "effect"
import { WebUrl } from "@sth-seat/protocol/Ids.ts"
import type { Title } from "@sth-seat/protocol/Ids.ts"
import { Files } from "../../domains/files/Files.ts"
import { Desktop } from "../../platform/Desktop.ts"

export type OpenedHere =
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "Url"; readonly url: WebUrl }

const filePathOf = (target: string): Option.Option<string> => {
  if (target.startsWith("/")) return Option.some(target)
  if (!target.startsWith("file://")) return Option.none()

  return Option.map(Option.fromNullishOr(URL.parse(target)), (url) => decodeURIComponent(url.pathname))
}

export const openHere = Effect.fn("Local.openHere")(function* (
  target: string,
  title: Option.Option<Title>,
  reveal: boolean
) {
  const desktop = yield* Desktop
  const files = yield* Files
  const path = filePathOf(target)
  if (Option.isSome(path)) {
    const shown = reveal
      ? desktop.revealFile(path.value)
      : files.showable(path.value).pipe(Effect.andThen(desktop.openFile(path.value, title)))
    yield* shown
    const opened: OpenedHere = { _tag: "File", path: path.value }

    return opened
  }
  const url = yield* Schema.decodeEffect(WebUrl)(target)
  yield* desktop.openUrl(url)
  const opened: OpenedHere = { _tag: "Url", url }

  return opened
})
