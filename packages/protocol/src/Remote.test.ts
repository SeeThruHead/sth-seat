import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { HubCommand, RelayFailed } from "./Daemon.ts"
import { Envelope, SessionId, chunksOf, isLast, maxChunkBytes } from "./Remote.ts"
import { newId } from "./Ids.ts"

describe("remote requests", () => {
  it("end a session on anything but output", () => {
    assert.deepStrictEqual(
      [
        isLast({ _tag: "Started" }),
        isLast({ _tag: "Output", channel: "stdout", bytes: new Uint8Array() }),
        isLast({ _tag: "Exited", code: 0 }),
        isLast({ _tag: "Finished", bytes: 3 }),
        isLast({ _tag: "Denied", reason: "no" })
      ],
      [false, false, true, true, true]
    )
  })

  it("carry input bytes as base64 inside the signed payload", () => {
    const encoded = Schema.encodeSync(Schema.fromJsonString(Envelope))({
      id: Schema.decodeSync(Envelope.fields.id)("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e5f"),
      session: Schema.decodeSync(Envelope.fields.session)("019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e60"),
      from: Schema.decodeSync(Envelope.fields.from)("tower"),
      to: Schema.decodeSync(Envelope.fields.to)("cube"),
      issuedAt: 1,
      request: { _tag: "Input", bytes: new TextEncoder().encode("hi") }
    })

    assert.include(encoded, '"bytes":"aGk="')
  })

  it("relay hub commands old daemons never saw, and say why a relay failed", () => {
    const relayed = Schema.decodeSync(HubCommand)({
      _tag: "Relayed",
      id: "019a5f3e-6a2b-7c4d-8e9f-0a1b2c3d4e5f",
      sealed: { payload: "{}", signature: "" }
    })

    assert.strictEqual(relayed._tag, "Relayed")
    assert.strictEqual(new RelayFailed({ reason: "cube isn't connected" }).message, "cube isn't connected")
  })

  it("cuts bytes into chunks no bigger than a message may carry, and keeps an empty read as one empty chunk", () => {
    const sizes = chunksOf(new Uint8Array(maxChunkBytes * 2 + 3)).map((chunk) => chunk.length)

    assert.deepStrictEqual(sizes, [maxChunkBytes, maxChunkBytes, 3])
    assert.deepStrictEqual(
      chunksOf(new Uint8Array()).map((chunk) => chunk.length),
      [0]
    )
  })

  it.effect("makes version 7 ids of the kind asked for", () =>
    Effect.gen(function* () {
      const id = yield* newId(SessionId)

      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    }).pipe(Effect.provide(SecureRandom.layerWebCrypto))
  )
})
