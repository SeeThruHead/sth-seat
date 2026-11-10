import { Effect } from "effect"
import { Digest } from "effect/crypto"
import { Base64Url } from "effect/encoding"

export const tokenHash = Effect.fnUntraced(function* (token: string) {
  const digests = yield* Digest.Digest
  const digest = yield* digests.digest(Digest.sha256, new TextEncoder().encode(token))

  return Base64Url.encode(digest)
})
