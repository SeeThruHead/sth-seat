import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { waylandDisplayIn } from "./Session.ts"

describe("waylandDisplayIn", () => {
  it("prefers the display the environment names when its socket exists", () => {
    const entries = ["bus", "wayland-0", "wayland-0.lock", "wayland-1"]

    assert.deepStrictEqual(waylandDisplayIn(entries, Option.some("wayland-1")), Option.some("wayland-1"))
  })

  it("falls back to the first socket when the named one is gone or none is named", () => {
    const entries = ["wayland-2.lock", "wayland-2", "wayland-1"]

    assert.deepStrictEqual(waylandDisplayIn(entries, Option.some("wayland-9")), Option.some("wayland-1"))
    assert.deepStrictEqual(waylandDisplayIn(entries, Option.none()), Option.some("wayland-1"))
  })

  it("finds nothing when nobody is logged in to the desktop", () => {
    assert.deepStrictEqual(waylandDisplayIn(["bus", "pipewire-0", "wayland-1.lock"], Option.none()), Option.none())
  })
})
