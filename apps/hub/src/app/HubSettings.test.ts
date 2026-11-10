import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { readSettings } from "./HubSettings.ts"

const hash = "Jh-QIFj5X06s7n_QSKVocwAKR0h9L1M9THVfkUrmaH8"

const settingsFile = Effect.fnUntraced(function* (text: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ suffix: ".yaml" })
  yield* fs.writeFileString(path, text)

  return path
})

describe("readSettings", () => {
  it.effect(
    "reads machines and the MCP token hash, defaulting hostnames to none and ignoring fields it no longer uses",
    () =>
      Effect.gen(function* () {
        const path = yield* settingsFile(
          [
            `mcpTokenHash: ${hash}`,
            "machines:",
            "  - name: tower",
            "    label: Tower",
            "    address: 192.0.2.10",
            `    tokenHash: ${hash}`,
            `    publicKey: ${"a".repeat(43)}`
          ].join("\n")
        )
        const settings = yield* readSettings(path)

        assert.deepStrictEqual(
          settings.machines.map((machine) => [String(machine.name), machine.publicKey, machine.hostnames.length]),
          [["tower", "a".repeat(43), 0]]
        )
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.effect("refuses a file that is missing, isn't YAML, or doesn't fit", () =>
    Effect.gen(function* () {
      const notYaml = yield* settingsFile("machines: [\n")
      const wrong = yield* settingsFile(`mcpTokenHash: short\nmachines: []\n`)
      const errors = yield* Effect.forEach(["/nonexistent/sth-seat.yaml", notYaml, wrong], (path) =>
        Effect.flip(readSettings(path))
      )

      assert.deepStrictEqual(
        errors.map((error) => error.message.startsWith(`The settings file ${error.path} can't be used:`)),
        [true, true, true]
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})
