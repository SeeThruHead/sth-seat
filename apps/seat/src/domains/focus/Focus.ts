import { Option, Predicate, Schema } from "effect"

const FocusedWindow = Schema.Struct({
  class: Schema.String,
  initialClass: Schema.optionalKey(Schema.String),
  fullscreen: Schema.optionalKey(Schema.Union([Schema.Int, Schema.Boolean])),
  contentType: Schema.optionalKey(Schema.String)
})
export type FocusedWindow = typeof FocusedWindow.Type

const decodeFocused = Schema.decodeUnknownOption(Schema.fromJsonString(FocusedWindow))

export const focusedFromHyprctl = (output: string): Option.Option<FocusedWindow> => decodeFocused(output)

const fullscreenMode = 2

const isFullscreen = (window: FocusedWindow): boolean => {
  if (window.fullscreen === true) return true

  return Predicate.isNumber(window.fullscreen) && window.fullscreen >= fullscreenMode
}

const looksLikeGame = (name: string): boolean => {
  const lower = name.toLowerCase()
  if (lower.endsWith(".exe")) return true
  if (lower.startsWith("steam_app_")) return true

  return lower === "gamescope"
}

export const isPlaying = (window: FocusedWindow): boolean => {
  if (isFullscreen(window)) return true
  if (window.contentType === "game") return true
  if (looksLikeGame(window.class)) return true

  return looksLikeGame(window.initialClass ?? "")
}

export const readyToOpen = (target: string): string => `Ready to open: ${target}`
