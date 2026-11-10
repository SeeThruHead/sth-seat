import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { FilePath } from "@sth-seat/protocol/Ids.ts"
import { asWebUrl, classify, tunnelTo } from "./Target.ts"
import type { Target } from "./Target.ts"

const reasonOf = (target: Target): string => (target._tag === "Invalid" ? target.reason : "")

const urlOf = (target: string) => {
  const found = classify(target)
  if (found._tag !== "Url") return assert.fail(`expected a URL, got ${found._tag}`)

  return found
}

describe("classify", () => {
  it("reads http and https links as URLs and marks loopback hosts as local", () => {
    assert.isFalse(urlOf("https://example.com").local)
    assert.isTrue(urlOf("http://localhost:5173/").local)
    assert.isTrue(urlOf("http://127.0.0.1:6006").local)
    assert.isTrue(urlOf("http://0.0.0.0:6006").local)
    assert.isTrue(urlOf("http://[::1]:3000").local)
    assert.isTrue(urlOf("http://app.localhost:3000").local)
  })

  it("reads absolute paths and file URLs as files", () => {
    assert.deepStrictEqual(classify(" /home/user/report.html "), {
      _tag: "File",
      path: FilePath.make("/home/user/report.html")
    })
    assert.deepStrictEqual(classify("file:///Users/sth/My%20Report.html"), {
      _tag: "File",
      path: FilePath.make("/Users/sth/My Report.html")
    })
  })

  it("refuses other schemes, relative paths and text", () => {
    assert.strictEqual(classify("mailto:someone@example.com")._tag, "Invalid")
    assert.strictEqual(classify("report.html")._tag, "Invalid")
    assert.strictEqual(classify("/bad\0path")._tag, "Invalid")
    assert.include(reasonOf(classify("ftp://example.com/file")), "ftp:")
  })
})

describe("tunnelTo", () => {
  it("keeps scheme, port, path, query and fragment, and fills in the default port", () => {
    assert.deepStrictEqual(tunnelTo(new URL("http://localhost:6006/iframe.html?id=button--primary#top")), {
      scheme: "http",
      port: 6006,
      path: "/iframe.html?id=button--primary#top"
    })
    assert.deepStrictEqual(
      [tunnelTo(new URL("https://localhost/x")).port, tunnelTo(new URL("http://localhost/")).port],
      [443, 80]
    )
  })
})

describe("asWebUrl", () => {
  it("accepts browser URLs and refuses others", () => {
    assert.isTrue(Option.isSome(asWebUrl(new URL("https://example.com"))))
    assert.isTrue(Option.isNone(asWebUrl(new URL("file:///x"))))
  })
})
