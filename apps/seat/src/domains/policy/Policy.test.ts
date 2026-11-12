import { assert, describe, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import {
  PolicyFile,
  acceptsMessagesFrom,
  copiesMessages,
  decide,
  defaultPolicy,
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

  it("lets receive cover every kind of delivery, and a rule name only some of them", () => {
    const deliveries: ReadonlyArray<Capability> = ["url", "file", "notify", "page", "secret"]
    const oneWay = Schema.decodeSync(PolicyFile)({ allow: [{ from: ["hub"], can: ["file", "url", "notify"] }] })

    assert.deepStrictEqual(
      deliveries.map((capability) => allowed(defaultPolicy, ask(hub, capability))),
      [true, true, true, true, true]
    )
    assert.deepStrictEqual(
      deliveries.concat(["receive", "read"]).map((capability) => allowed(oneWay, ask(hub, capability))),
      [true, true, true, false, false, false, false]
    )
    assert.deepStrictEqual(
      decide(oneWay, ask(hub, "page"), home),
      Result.fail(
        "This machine's policy doesn't let the hub open a localhost page from another machine through a tunnel, which carries data both ways (page) (~/.config/sth-seat/policy.yaml)."
      )
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
