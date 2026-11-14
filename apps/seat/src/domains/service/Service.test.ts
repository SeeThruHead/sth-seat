import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { brewStablePath, isBunRuntime, launchdPlist, systemdUnit } from "./Service.ts"

describe("service files", () => {
  it("start the daemon from the installed executable", () => {
    assert.include(systemdUnit("/home/me/.local/bin/sth-seat"), "ExecStart=/home/me/.local/bin/sth-seat daemon\n")
    assert.include(systemdUnit("/x"), "WantedBy=default.target")
    assert.include(
      launchdPlist("/Users/me/.local/bin/sth-seat", "/Users/me/Library/Logs/sth-seat.log", "/Users/me"),
      "<string>/Users/me/.local/bin/sth-seat</string>\n    <string>daemon</string>"
    )
    assert.include(
      launchdPlist("/Users/me/.local/bin/sth-seat", "/Users/me/Library/Logs/sth-seat.log", "/Users/me"),
      "<string>/Users/me/.local/bin:/opt/homebrew/bin:"
    )
  })

  it("escape paths so the plist stays valid XML", () => {
    assert.include(
      launchdPlist("/Users/a&b/sth-seat", "/tmp/<log>", "/Users/a&b"),
      "<string>/Users/a&amp;b/sth-seat</string>"
    )
    assert.include(launchdPlist("/x", "/tmp/<log>", "/x"), "<string>/tmp/&lt;log&gt;</string>")
  })

  it("tell the Bun runtime from a compiled sth-seat", () => {
    assert.deepStrictEqual(
      [
        "/usr/bin/bun",
        "/opt/homebrew/bin/bun",
        "/home/me/.bun/bin/bun-profile",
        "/home/me/.local/bin/sth-seat",
        "/tmp/bunny"
      ].map(isBunRuntime),
      [true, true, true, false, false]
    )
  })

  it("point a Homebrew install at brew's stable path, which survives upgrades", () => {
    assert.deepStrictEqual(
      [
        "/opt/homebrew/Cellar/sth-seat/0.4.1/bin/sth-seat",
        "/home/linuxbrew/.linuxbrew/Cellar/sth-seat/0.4.1/bin/sth-seat",
        "/opt/homebrew/Cellar/sth-seat/0.8.1/sth-seat.app/Contents/MacOS/sth-seat",
        "/home/me/.local/bin/sth-seat",
        "/home/me/Downloads/sth-seat.app/Contents/MacOS/sth-seat",
        "/opt/homebrew/Cellar/other/1.0/bin/sth-seat",
        "/home/me/Downloads/sth-seat-darwin-arm64"
      ].map(brewStablePath),
      [
        Option.some("/opt/homebrew/bin/sth-seat"),
        Option.some("/home/linuxbrew/.linuxbrew/bin/sth-seat"),
        Option.some("/opt/homebrew/bin/sth-seat"),
        Option.none(),
        Option.none(),
        Option.none(),
        Option.none()
      ]
    )
  })
})
