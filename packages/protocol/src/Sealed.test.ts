import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, HashMap, Layer, Schema } from "effect"
import { SecureRandom, Signature } from "effect/crypto"
import { Base64Url } from "effect/encoding"
import { firstSighting, isFresh } from "./Freshness.ts"
import { Hello, helloHeader, sealedHello } from "./Hello.ts"
import { MachineName } from "./Ids.ts"
import { PublicKeyText, newKeyPair, pemOf, privateKeyFromPem, publicKeyFrom, publicKeyOf, textOf } from "./Keys.ts"
import { peek, seal, unseal } from "./Sealed.ts"

const crypto = Signature.layerWebCrypto.pipe(Layer.provideMerge(SecureRandom.layerWebCrypto))

const Note = Schema.Struct({ text: Schema.String })

const tower = MachineName.make("tower")

describe("machine keys", () => {
  it.effect("survive a trip through the key file and the public key text", () =>
    Effect.gen(function* () {
      const pair = yield* newKeyPair
      const pem = yield* pemOf(pair.privateKey)
      const reread = yield* privateKeyFromPem(pem)
      const derived = yield* publicKeyFrom(reread)
      const text = yield* textOf(derived)
      const sealed = yield* seal(Note, reread, "command", { text: "hi" })
      const reloaded = yield* publicKeyOf(text)
      const opened = yield* unseal(Note, reloaded, "command", sealed)

      assert.match(pem, /^-----BEGIN PRIVATE KEY-----/)
      assert.match(text, /^[A-Za-z0-9_-]{43}$/)
      assert.deepStrictEqual(opened, { text: "hi" })
    }).pipe(Effect.provide(crypto))
  )

  it.effect("refuse a key file that isn't a key", () =>
    Effect.gen(function* () {
      const pem = yield* Effect.flip(privateKeyFromPem("not a key"))

      assert.include(pem.message, "This machine key can't be used")
    }).pipe(Effect.provide(crypto))
  )
})

describe("sealed messages", () => {
  it.effect("refuse another key, another purpose, an edited payload and a mangled signature", () =>
    Effect.gen(function* () {
      const mine = yield* newKeyPair
      const theirs = yield* newKeyPair
      const notAPoint = yield* publicKeyOf(PublicKeyText.make("_".repeat(42) + "w"))
      const sealed = yield* seal(Note, mine.privateKey, "command", { text: "run this" })
      const refusals = yield* Effect.forEach(
        [
          unseal(Note, theirs.publicKey, "command", sealed),
          unseal(Note, notAPoint, "command", sealed),
          unseal(Note, mine.publicKey, "reply", sealed),
          unseal(Note, mine.publicKey, "command", { ...sealed, payload: '{"text":"run that"}' }),
          unseal(Note, mine.publicKey, "command", { ...sealed, signature: "!!" }),
          unseal(Note, mine.publicKey, "command", { ...sealed, signature: Base64Url.encode(new Uint8Array(3)) })
        ],
        (attempt) => Effect.flip(attempt).pipe(Effect.map((error) => error.message))
      )

      const forCommand = "the command's signature doesn't match the sender's key"
      const forReply = "the reply's signature doesn't match the sender's key"

      assert.deepStrictEqual(refusals, [forCommand, forCommand, forReply, forCommand, forCommand, forCommand])
    }).pipe(Effect.provide(crypto))
  )

  it.effect("say when a payload doesn't read or can't be encoded", () =>
    Effect.gen(function* () {
      const mine = yield* newKeyPair
      const unreadable = yield* Effect.flip(peek(Note, "command", { payload: "{", signature: "" }))
      const unencodable = yield* Effect.flip(
        seal(Schema.Struct({ n: Schema.Int }), mine.privateKey, "command", { n: 1.5 })
      )

      assert.include(unreadable.message, "the command doesn't read")
      assert.include(unencodable.message, "can't encode the command")
    }).pipe(Effect.provide(crypto))
  )
})

describe("hello header", () => {
  it.effect("carries the machine, a fresh time and a nonce, signed by the machine", () =>
    Effect.gen(function* () {
      const pair = yield* newKeyPair
      const header = yield* helloHeader(tower, pair.privateKey)
      const sealed = yield* sealedHello(header)
      const hello = yield* unseal(Hello, pair.publicKey, "hello", sealed)
      const now = yield* DateTime.now

      assert.strictEqual(hello.machine, "tower")
      assert.isTrue(isFresh(hello.issuedAt, now))
      assert.match(hello.nonce, /^[A-Za-z0-9_-]{22}$/)
    }).pipe(Effect.provide(crypto))
  )

  it.effect("refuses headers that aren't one", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.forEach(
        ["Bearer abc", "Sth-Seat !!", `Sth-Seat ${Base64Url.encode("{")}`],
        (header) => Effect.flip(sealedHello(header)).pipe(Effect.map((error) => error._tag))
      )

      assert.deepStrictEqual(refused, ["SealBroken", "SealBroken", "SealBroken"])
    })
  )
})

describe("freshness", () => {
  it("accepts a minute either way, and nothing older or newer", () => {
    const now = DateTime.makeUnsafe(1_000_000)

    assert.deepStrictEqual(
      [940_000, 1_060_000, 939_999, 1_060_001].map((issuedAt) => isFresh(issuedAt, now)),
      [true, true, false, false]
    )
  })

  it("takes an id once, and forgets it after two minutes", () => {
    const start = DateTime.makeUnsafe(1_000_000)
    const [first, seen] = firstSighting(HashMap.empty(), "a", start)
    const [again] = firstSighting(seen, "a", DateTime.makeUnsafe(1_100_000))
    const [later] = firstSighting(seen, "a", DateTime.makeUnsafe(1_120_001))

    assert.deepStrictEqual([first, again, later], [true, false, true])
  })
})
