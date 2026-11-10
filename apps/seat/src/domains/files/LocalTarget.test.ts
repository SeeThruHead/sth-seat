import { assert, describe, it } from "@effect/vitest"
import { localTarget } from "./LocalTarget.ts"

describe("localTarget", () => {
  it("keeps URLs and absolute paths as they are", () => {
    assert.strictEqual(localTarget("https://example.com", "/work", "/home/user"), "https://example.com")
    assert.strictEqual(localTarget("file:///tmp/x", "/work", "/home/user"), "file:///tmp/x")
    assert.strictEqual(localTarget("/tmp/report.html", "/work", "/home/user"), "/tmp/report.html")
  })

  it("resolves home and relative paths against this machine", () => {
    assert.strictEqual(localTarget("~", "/work", "/home/user"), "/home/user")
    assert.strictEqual(localTarget("~/tmp/a.html", "/work", "/home/user"), "/home/user/tmp/a.html")
    assert.strictEqual(localTarget("./out/a.html", "/work/", "/home/user"), "/work/out/a.html")
    assert.strictEqual(localTarget("a.html", "/work", "/home/user"), "/work/a.html")
  })
})
