import { DateTime, Duration, Option, Result } from "effect"
import type { MachinePresence, Whereabouts } from "@sth-seat/protocol/Actions.ts"
import type { MachineLabel, MachineName } from "@sth-seat/protocol/Ids.ts"

export type Sighting = {
  readonly name: MachineName
  readonly label: MachineLabel
  readonly side: string
  readonly online: boolean
  readonly lastInput: Option.Option<DateTime.Utc>
}

const isLater = (candidate: Sighting, best: Sighting): boolean => {
  if (Option.isNone(candidate.lastInput)) return false
  if (Option.isNone(best.lastInput)) return true

  return DateTime.isGreaterThan(candidate.lastInput.value, best.lastInput.value)
}

export const seatOf = (sightings: ReadonlyArray<Sighting>): Option.Option<Sighting> =>
  sightings
    .filter((sighting) => sighting.online)
    .reduce<Option.Option<Sighting>>(
      (best, sighting) =>
        Option.match(best, {
          onNone: () => Option.some(sighting),
          onSome: (current) => (isLater(sighting, current) ? Option.some(sighting) : best)
        }),
      Option.none()
    )

export const offline = (label: MachineLabel): string =>
  `${label} isn't connected to the hub (its daemon isn't running or lost its link), so the hub can't tell whether the user is at it and opens nothing on another machine. Start its daemon there with \`sth-seat install\`, then check \`sth-seat doctor\`.`

export const seatFor = (sightings: ReadonlyArray<Sighting>, caller: MachineName): Result.Result<Sighting, string> => {
  const own = sightings.find((sighting) => sighting.name === caller)
  if (own === undefined) return Result.fail(`The hub doesn't know ${caller}.`)
  if (!own.online) return Result.fail(offline(own.label))
  const seat = seatOf(sightings.filter((sighting) => sighting.side === own.side))

  return Result.succeed(Option.getOrElse(seat, () => own))
}

const idleSecondsOf = (sighting: Sighting, now: DateTime.Utc): Option.Option<number> =>
  Option.map(sighting.lastInput, (lastInput) =>
    Math.max(0, Math.floor(Duration.toSeconds(DateTime.distance(lastInput, now))))
  )

export const ago = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`

  return `${Math.floor(seconds / 86_400)} days ago`
}

const lastUsed = (presence: MachinePresence): string =>
  presence.idleSeconds === undefined ? "no input seen yet" : `last input ${ago(presence.idleSeconds)}`

const lineOf = (presence: MachinePresence): string => {
  if (presence.seat) return `The user is at ${presence.label} (${lastUsed(presence)}).`
  if (presence.online) return `${presence.label}: connected, ${lastUsed(presence)}.`

  return `${presence.label}: not connected, ${lastUsed(presence)}.`
}

const presenceOf = (sighting: Sighting, seat: Option.Option<Sighting>, now: DateTime.Utc): MachinePresence => {
  const idleSeconds = idleSecondsOf(sighting, now)

  return {
    name: sighting.name,
    label: sighting.label,
    online: sighting.online,
    seat: Option.exists(seat, (found) => found.name === sighting.name),
    ...(Option.isSome(idleSeconds) ? { idleSeconds: idleSeconds.value } : {})
  }
}

export const nobodyConnected = "None of the user's machines is connected to the hub, so there is nowhere to open it."

export const whereaboutsOf = (sightings: ReadonlyArray<Sighting>, now: DateTime.Utc): Whereabouts => {
  const seat = seatOf(sightings)
  const machines = sightings.map((sighting) => presenceOf(sighting, seat, now))
  const lines = machines.toSorted((a, b) => Number(b.seat) - Number(a.seat)).map(lineOf)

  return {
    ...(Option.isSome(seat) ? { seat: seat.value.name } : {}),
    machines,
    message: Option.isSome(seat) ? lines.join(" ") : [nobodyConnected, ...lines].join(" ")
  }
}
