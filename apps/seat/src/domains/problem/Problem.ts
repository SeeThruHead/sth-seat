import { Cause, Option, Predicate } from "effect"

const messageOf = (error: unknown): Option.Option<string> =>
  Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message.trim() !== ""
    ? Option.some(error.message)
    : Option.none()

export const problemOf = <E>(cause: Cause.Cause<E>): Option.Option<string> => {
  if (Cause.hasInterruptsOnly(cause)) return Option.none()

  return Option.some(
    Cause.findErrorOption(cause).pipe(
      Option.flatMap(messageOf),
      Option.getOrElse(() => Cause.pretty(cause))
    )
  )
}
