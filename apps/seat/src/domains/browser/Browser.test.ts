import { assert, describe, it } from "@effect/vitest"
import { Result } from "effect"
import { defaultBrowserIn, safari, webAddress } from "./Browser.ts"

describe("webAddress", () => {
  it("takes only http and https links, naming the scheme it refuses", () => {
    assert.deepStrictEqual(webAddress("https://example.com/a?b=1"), Result.succeed("https://example.com/a?b=1"))
    assert.deepStrictEqual(webAddress("http://localhost:6006"), Result.succeed("http://localhost:6006/"))
    assert.deepStrictEqual(
      ["file:///etc/passwd", "javascript:alert(1)", "x-apple.systempreferences:com.apple.preference", "ssh://box"].map(
        (url) => Result.match(webAddress(url), { onFailure: (reason) => reason, onSuccess: () => "opened" })
      ),
      [
        "only http and https links open in the browser here, not file: links.",
        "only http and https links open in the browser here, not javascript: links.",
        "only http and https links open in the browser here, not x-apple.systempreferences: links.",
        "only http and https links open in the browser here, not ssh: links."
      ]
    )
    assert.deepStrictEqual(webAddress("http://["), Result.fail("http://[ isn't a URL it can read."))
  })
})

describe("defaultBrowserIn", () => {
  it("reads the https handler from Launch Services, and falls back to Safari", () => {
    const chrome =
      '[{"LSHandlerContentType":"public.html","LSHandlerRoleAll":"com.apple.Safari"},{"LSHandlerURLScheme":"https","LSHandlerRoleAll":"com.google.chrome"}]'

    assert.deepStrictEqual([chrome, "[]", '[{"LSHandlerURLScheme":"https"}]', "not json"].map(defaultBrowserIn), [
      "com.google.chrome",
      safari,
      safari,
      safari
    ])
  })
})
