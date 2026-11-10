import { Effect, Option } from "effect"
import type { ActionFailed, OpenFromAgent, OpenRequest, Opened } from "@sth-seat/protocol/Actions.ts"
import type { FilePath, WebUrl } from "@sth-seat/protocol/Ids.ts"
import { nobodyConnected, seatOf } from "../../domains/presence/Seat.ts"
import type { Sighting } from "../../domains/presence/Seat.ts"
import { Roster } from "../../domains/roster/Roster.ts"
import type { Machine } from "../../domains/roster/Roster.ts"
import { asWebUrl, classify, tunnelTo } from "../../domains/targets/Target.ts"
import { answered, command, done, failed, unknownHostname } from "../dispatch/dispatch.ts"
import { sightings } from "../where/handler.ts"

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

const tunnelOrigin = Effect.fnUntraced(function* (target: UrlTarget, seat: Sighting, from: Option.Option<Machine>) {
  if (!target.local) return Option.none<Machine>()
  if (Option.isNone(from))
    return yield* failed(
      "A localhost URL needs `from` (the machine its server runs on, the output of `hostname`) so it can be opened from the user's machine."
    )
  if (from.value.name === seat.name) return Option.none<Machine>()

  return from
})

const openedThrough = (seat: Sighting, url: WebUrl, origin: Machine): Opened => ({
  machine: seat.name,
  label: seat.label,
  kind: "url",
  url,
  message: `Opened ${url} from ${origin.label} in the browser on ${seat.label}, through a tunnel to ${origin.label}.`
})

const openUrl = Effect.fnUntraced(function* (target: UrlTarget, seat: Sighting, from: Option.Option<Machine>) {
  const url = yield* webUrl(target.url)
  const origin = yield* tunnelOrigin(target, seat, from)
  if (Option.isNone(origin)) {
    yield* done(seat, { _tag: "OpenUrl", url }, "15 seconds")

    return openedUrl(seat, url)
  }
  yield* done(seat, { _tag: "OpenTunnel", origin: origin.value.name, ...tunnelTo(target.url) }, "15 seconds")

  return openedThrough(seat, url, origin.value)
})

const sendFile = Effect.fnUntraced(function* (path: FilePath, showing: Showing, seat: Sighting, from: Machine) {
  const read = yield* command(from, { _tag: "ReadFile", path }, "30 seconds")
  const file = yield* answered(read, "FileRead")
  yield* done(seat, { _tag: "ReceiveFile", name: file.name, bytes: file.bytes, ...showing }, "60 seconds")

  return file.name
})

const openFile = Effect.fnUntraced(function* (
  path: FilePath,
  showing: Showing,
  seat: Sighting,
  from: Option.Option<Machine>
) {
  if (Option.isNone(from)) return yield* failed("A file needs `from`: the machine it is on (the output of `hostname`).")
  const here = from.value.name === seat.name
  if (here) yield* done(seat, { _tag: "OpenFile", path, ...showing }, "15 seconds")
  const name = here ? path : yield* sendFile(path, showing, seat, from.value)

  return openedFile(seat, name, showing)
})

export const open = Effect.fn("Open.open")(function* (request: OpenRequest, from: Option.Option<Machine>) {
  const target = classify(request.target)
  if (target._tag === "Invalid") return yield* failed(target.reason)
  const found = yield* sightings
  const seat = seatOf(found)
  if (Option.isNone(seat)) return yield* failed(nobodyConnected)
  yield* Effect.annotateCurrentSpan({ seat: seat.value.name, "target.kind": target._tag })
  if (target._tag === "Url") return yield* openUrl(target, seat.value, from)

  return yield* openFile(target.path, showingOf(request), seat.value, from)
})

export const openFromAgent = Effect.fn("Open.openFromAgent")(function* (request: OpenFromAgent) {
  const roster = yield* Roster
  const opening = { target: request.target, ...showingOf(request) }
  if (request.from === undefined) return yield* open(opening, Option.none())

  const origin = roster.byHostname(request.from)
  if (Option.isNone(origin)) return yield* unknownHostname(request.from, roster.machines)

  return yield* open(opening, origin)
})
