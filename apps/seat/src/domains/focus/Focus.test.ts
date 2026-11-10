import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { focusedFromHyprctl, isPlaying } from "./Focus.ts"
import type { FocusedWindow } from "./Focus.ts"

const window = (fields: Partial<FocusedWindow>): FocusedWindow => ({ class: "kitty", fullscreen: 0, ...fields })

describe("isPlaying", () => {
  it("counts a fullscreen window, a Wine program, a Steam game, gamescope and a game content type", () => {
    assert.deepStrictEqual(
      [
        window({ fullscreen: 2 }),
        window({ fullscreen: true }),
        window({ class: "wow.exe" }),
        window({ class: "Wow.EXE" }),
        window({ class: "steam_app_1245620" }),
        window({ class: "gamescope" }),
        window({ class: "", initialClass: "steam_app_570" }),
        window({ contentType: "game" })
      ].map(isPlaying),
      [true, true, true, true, true, true, true, true]
    )
  })

  it("leaves ordinary and maximized windows, and Steam's own client, alone", () => {
    assert.deepStrictEqual(
      [
        window({}),
        window({ fullscreen: 1 }),
        window({ class: "steam" }),
        window({ class: "firefox", contentType: "none" })
      ].map(isPlaying),
      [false, false, false, false]
    )
  })
})

describe("focusedFromHyprctl", () => {
  it("reads hyprctl's focused window and gives nothing for anything else", () => {
    const wow = '{"address":"0x1","class":"wow.exe","initialClass":"wow.exe","fullscreen":0,"contentType":"none"}'

    assert.deepStrictEqual(
      focusedFromHyprctl(wow),
      Option.some({ class: "wow.exe", initialClass: "wow.exe", fullscreen: 0, contentType: "none" })
    )
    assert.deepStrictEqual(
      [focusedFromHyprctl("{}"), focusedFromHyprctl("Invalid"), focusedFromHyprctl("")],
      [Option.none(), Option.none(), Option.none()]
    )
  })
})
