import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Digest } from "effect/crypto"
import { tokenHash } from "./Tokens.ts"

describe("tokenHash", () => {
  it.effect("is the unpadded base64url SHA-256 the hub's config stores", () =>
    Effect.gen(function* () {
      const hash = yield* tokenHash("mcp-test-token")

      assert.strictEqual(hash, "Jh-QIFj5X06s7n_QSKVocwAKR0h9L1M9THVfkUrmaH8")
    }).pipe(Effect.provide(Digest.layerWebCrypto))
  )
})
