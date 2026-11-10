import { Option } from "effect"

const waylandSocket = /^wayland-\d+$/

export const waylandDisplayIn = (
  entries: ReadonlyArray<string>,
  preferred: Option.Option<string>
): Option.Option<string> => {
  const sockets = entries.filter((entry) => waylandSocket.test(entry)).toSorted()
  const named = Option.filter(preferred, (name) => sockets.includes(name))

  return Option.orElse(named, () => Option.fromNullishOr(sockets[0]))
}
