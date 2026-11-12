import { Effect, Option } from "effect"
import type { ActionFailed, OpenFromAgent, OpenRequest, Opened } from "@sth-seat/protocol/Actions.ts"
import type { FilePath, WebUrl } from "@sth-seat/protocol/Ids.ts"
import type { Sighting } from "../../domains/presence/Seat.ts"
import { Roster } from "../../domains/roster/Roster.ts"
import type { Machine } from "../../domains/roster/Roster.ts"
import { asWebUrl, classify, tunnelTo } from "../../domains/targets/Target.ts"
import { answered, command, done, failed, unknownHostname } from "../dispatch/dispatch.ts"
import { seatForCaller } from "../where/handler.ts"

type UrlTarget = { readonly url: URL; readonly local: boolean }

type Showing = Pick<OpenRequest, "title" | "reveal">

const openedUrl = (seat: Sighting, url: WebUrl): Opened => ({
  machine: seat.name,
  label: seat.label,
  kind: "url",
  url,
  message: `Opened ${url} in the browser on ${seat.label}.`
})

const openedFile = (seat: Sighting, name: string, showing: Showing): Opened => ({
  machine: seat.name,
  label: seat.label,
  kind: "file",
  message:
    showing.reveal === true
      ? `Showed ${name} in the file manager on ${seat.label}.`
      : `Opened ${name} on ${seat.label}.`
})

const showingOf = (request: Showing): Showing => ({
  ...(request.title === undefined ? {} : { title: request.title }),
  ...(request.reveal === true ? { reveal: true } : {})
})

const webUrl = (url: URL): Effect.Effect<WebUrl, ActionFailed> =>
  Effect.fromOption(asWebUrl(url)).pipe(Effect.mapError(() => failed(`${url.href} isn't a URL a browser can open.`)))

const openedThrough = (seat: Sighting, url: WebUrl, origin: Machine): Opened => ({
  machine: seat.name,
  label: seat.label,
  kind: "url",
  url,
  message: `Opened ${url} from ${origin.label} in the browser on ${seat.label}, through a tunnel to ${origin.label}.`
})

const openUrl = Effect.fnUntraced(function* (target: UrlTarget, seat: Sighting, from: Machine) {
  const url = yield* webUrl(target.url)
  if (!target.local || from.name === seat.name) {
    yield* done(seat, { _tag: "OpenUrl", url, origin: from.name }, "15 seconds")

    return openedUrl(seat, url)
  }
  yield* done(seat, { _tag: "OpenTunnel", origin: from.name, ...tunnelTo(target.url) }, "15 seconds")

  return openedThrough(seat, url, from)
})

const sendFile = Effect.fnUntraced(function* (path: FilePath, showing: Showing, seat: Sighting, from: Machine) {
  const read = yield* command(from, { _tag: "ReadFile", path }, "30 seconds")
  const file = yield* answered(read, "FileRead")
  yield* done(
    seat,
    { _tag: "ReceiveFile", name: file.name, bytes: file.bytes, ...showing, origin: from.name },
    "60 seconds"
  )

  return file.name
})

const openFile = Effect.fnUntraced(function* (path: FilePath, showing: Showing, seat: Sighting, from: Machine) {
  const here = from.name === seat.name
  if (here) yield* done(seat, { _tag: "OpenFile", path, ...showing, origin: from.name }, "15 seconds")
  const name = here ? path : yield* sendFile(path, showing, seat, from)

  return openedFile(seat, name, showing)
})

export const open = Effect.fn("Open.open")(function* (request: OpenRequest, from: Machine) {
  const target = classify(request.target)
  if (target._tag === "Invalid") return yield* failed(target.reason)
  const seat = yield* seatForCaller(from.name)
  yield* Effect.annotateCurrentSpan({ seat: seat.name, caller: from.name, "target.kind": target._tag })
  if (target._tag === "Url") return yield* openUrl(target, seat, from)

  return yield* openFile(target.path, showingOf(request), seat, from)
})

export const openFromAgent = Effect.fn("Open.openFromAgent")(function* (request: OpenFromAgent) {
  const roster = yield* Roster
  const origin = roster.byHostname(request.from)
  if (Option.isNone(origin)) return yield* unknownHostname(request.from, roster.machines)

  return yield* open({ target: request.target, ...showingOf(request) }, origin.value)
})
