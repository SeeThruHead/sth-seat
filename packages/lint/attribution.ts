import { Effect, FileSystem, Schema } from "effect"

export class AttributionFound extends Schema.TaggedError<AttributionFound, { readonly brand: unique symbol }>()(
  "AttributionFound",
  { lines: Schema.Array(Schema.String) }
) {
  override get message() {
    return `commit message carries AI attribution:\n${this.lines.join("\n")}`
  }
}

export class Usage extends Schema.TaggedError<Usage, { readonly brand: unique symbol }>()("Usage", {}) {
  override get message() {
    return "usage: bun packages/lint/attribution-hook.ts <commit-message-file>"
  }
}

const patterns: ReadonlyArray<RegExp> = [
  /co-authored-by:[^\n]*\b(claude|anthropic|openai|codex|copilot|chatgpt|gpt-\d)/i,
  /generated (with|by)[^\n]*\b(claude|chatgpt|copilot|codex|an? ai)\b/i,
  /claude-session:/i,
  /claude\.ai\/code\/session/i,
  /\u{1F916}/u
]

export const offendingLines = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => patterns.some((pattern) => pattern.test(line)))

export const checkMessageFile = Effect.fn("attribution.checkMessageFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(path)
  const lines = offendingLines(text)
  if (lines.length > 0) return yield* new AttributionFound({ lines })
})

export const main = Effect.fn("attribution.main")(function* (argv: ReadonlyArray<string>) {
  const path = argv[2]
  if (path === undefined) return yield* new Usage()

  yield* checkMessageFile(path)
})
