import { assert, describe, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import {
  PolicyFile,
  acceptsMessagesFrom,
  copiesMessages,
  decide,
  defaultPolicy,
  deliveriesOf,
  deliveryRefusal,
  hubDelivers,
  received,
  expandHome,
  hub,
  keepsSecrets,
  keyOf
} from "./Policy.ts"
import type { Ask, Capability, Caller } from "./Policy.ts"

const home = "/home/user"

const tower = MachineName.make("tower")

const cube = MachineName.make("cube")

const personal = Schema.decodeSync(PolicyFile)({
  machines: { tower: "a".repeat(43) },
  allow: [
    { from: ["tower"], can: ["shell", "read", "write", "receive"] },
    { from: ["hub"], can: ["receive", "read"], folders: ["~/tmp/", "/srv"] },
    { from: ["*"], can: ["receive"] }
  ]
})

const ask = (caller: Caller, capability: Capability, path?: string): Ask => ({
  caller,
  capability,
  path: Option.fromNullishOr(path)
})

const allowed = (policy: PolicyFile, question: Ask) => Result.isSuccess(decide(policy, question, home))

describe("policy", () => {
  it("lets each caller do only what a rule names, inside the rule's folders", () => {
    assert.deepStrictEqual(
      [
        ask(tower, "shell"),
        ask(tower, "read", "/home/user/code/a.ts"),
        ask(tower, "read", "/etc/passwd"),
        ask(hub, "read", "/home/user/tmp/report.html"),
        ask(hub, "read", "/home/user/tmpfile"),
        ask(hub, "read", "/srv"),
        ask(hub, "shell"),
        ask(cube, "receive"),
        ask(cube, "shell")
      ].map((question) => allowed(personal, question)),
      [true, true, false, true, false, true, false, true, false]
    )
  })

  it("lets the hub only deliver things when there is no policy file", () => {
    assert.deepStrictEqual(
      [ask(hub, "receive"), ask(hub, "read", "/home/user/a"), ask(tower, "receive")].map((question) =>
        allowed(defaultPolicy, question)
      ),
      [true, false, false]
    )
  })

  it("says what was refused and where the policy lives", () => {
    assert.deepStrictEqual(
      decide(personal, ask(hub, "shell"), home),
      Result.fail("This machine's policy doesn't let the hub shell (~/.config/sth-seat/policy.yaml).")
    )
    assert.deepStrictEqual(
      decide(personal, ask(cube, "read", "/etc/passwd"), home),
      Result.fail("This machine's policy doesn't let cube read on /etc/passwd (~/.config/sth-seat/policy.yaml).")
    )
  })

  it("lets receive cover everything the hub delivers, and a rule name each capability on its own", () => {
    const oneWay = Schema.decodeSync(PolicyFile)({
      allow: [{ from: ["hub"], can: ["open-url", "open-file", "reveal", "notify"] }]
    })

    assert.deepStrictEqual(hubDelivers(defaultPolicy, home), received)
    assert.deepStrictEqual(hubDelivers(oneWay, home), ["open-url", "open-file", "reveal", "notify"])
    assert.isFalse(allowed(oneWay, ask(hub, "receive")))
    assert.deepStrictEqual(
      decide(oneWay, ask(hub, "open-tunnelled-page"), home),
      Result.fail(
        "This machine's policy doesn't let the hub open-tunnelled-page (open another machine's localhost page through a tunnel, which carries data both ways) (~/.config/sth-seat/policy.yaml)."
      )
    )
    assert.deepStrictEqual(
      [oneWay, Schema.decodeSync(PolicyFile)({ allow: [] }), defaultPolicy].map((policy) => deliveriesOf(policy, home)),
      [
        "the hub may open-url, open-file, reveal, notify (for any machine); refused: ask-secret, store-secret, open-tunnelled-page",
        "the hub may nothing; refused: open-url, open-file, reveal, notify, ask-secret, store-secret, open-tunnelled-page",
        "the hub may open-url, open-file, reveal, notify, ask-secret, store-secret, open-tunnelled-page (for any machine); refused: nothing"
      ]
    )
  })

  it("takes deliveries only for this machine and those under deliveries: from, when the policy names them", () => {
    const work = MachineName.make("work")
    const sided = Schema.decodeSync(PolicyFile)({
      allow: [{ from: [hub], can: ["receive"] }],
      deliveries: { from: [cube] }
    })
    const open = Schema.decodeSync(PolicyFile)({ allow: [{ from: [hub], can: ["receive"] }] })

    assert.deepStrictEqual(
      [work, cube, tower, undefined].map((origin) => Option.isNone(deliveryRefusal(sided, origin, work))),
      [true, true, false, false]
    )
    assert.include(
      Option.getOrElse(deliveryRefusal(sided, tower, work), () => ""),
      "nothing the hub delivers for tower"
    )
    assert.include(
      Option.getOrElse(deliveryRefusal(sided, undefined, work), () => ""),
      "didn't say which machine"
    )
    assert.isTrue(Option.isNone(deliveryRefusal(open, undefined, work)))
    assert.strictEqual(
      deliveriesOf(sided, home),
      "the hub may open-url, open-file, reveal, notify, ask-secret, store-secret, open-tunnelled-page (only for this machine, cube); refused: nothing"
    )
  })

  it("means any listed machine by *, never the hub", () => {
    const anyMachine = Schema.decodeSync(PolicyFile)({ allow: [{ from: ["*"], can: ["receive", "read"] }] })

    assert.deepStrictEqual(
      [ask(cube, "receive"), ask(hub, "receive"), ask(tower, "read", "/home/user/a")].map((question) =>
        allowed(anyMachine, question)
      ),
      [true, false, true]
    )
  })

  it("matches a caller anywhere in a rule's list", () => {
    const both = Schema.decodeSync(PolicyFile)({ allow: [{ from: ["tower", "cube"], can: ["shell"] }] })

    assert.deepStrictEqual(
      [ask(tower, "shell"), ask(cube, "shell")].map((question) => allowed(both, question)),
      [true, true]
    )
  })

  it("lets a rule for every folder cover the whole disk", () => {
    const everywhere = Schema.decodeSync(PolicyFile)({
      allow: [{ from: ["tower"], can: ["read"], folders: ["/"] }]
    })

    assert.isTrue(allowed(everywhere, ask(tower, "read", "/etc/hosts")))
  })

  it("knows the pinned key of each machine it lists", () => {
    assert.deepStrictEqual(keyOf(personal, tower), Option.some("a".repeat(43)))
    assert.deepStrictEqual(keyOf(personal, cube), Option.none())
  })

  it("takes messages only from the machines it names (or any with *), apart from what they may run", () => {
    const named = Schema.decodeSync(PolicyFile)({ messages: { from: ["tower"], clipboard: true } })
    const anyone = Schema.decodeSync(PolicyFile)({ messages: { from: ["*"] } })

    assert.deepStrictEqual(
      [named, anyone, personal].map((policy) => [
        acceptsMessagesFrom(policy, tower),
        acceptsMessagesFrom(policy, cube),
        copiesMessages(policy)
      ]),
      [
        [true, false, true],
        [true, true, false],
        [false, false, false]
      ]
    )
  })

  it("keeps secrets here only when it says secrets: here", () => {
    const here = Schema.decodeSync(PolicyFile)({ secrets: "here" })
    const seat = Schema.decodeSync(PolicyFile)({ secrets: "seat" })

    assert.deepStrictEqual([here, seat, personal].map(keepsSecrets), [true, false, false])
  })

  it("expands ~ to the home folder", () => {
    assert.deepStrictEqual(
      ["~", "~/tmp", "/srv", "~user"].map((path) => expandHome(path, home)),
      ["/home/user", "/home/user/tmp", "/srv", "~user"]
    )
  })
})
