import { Array, Option, Result, Schema } from "effect"

const webSchemes = ["http:", "https:"]

export const webAddress = (url: string): Result.Result<string, string> => {
  const parsed = URL.parse(url)
  if (parsed === null) return Result.fail(`${url} isn't a URL it can read.`)
  if (!webSchemes.includes(parsed.protocol))
    return Result.fail(`only http and https links open in the browser here, not ${parsed.protocol} links.`)

  return Result.succeed(parsed.href)
}

export const safari = "com.apple.Safari"

const Handler = Schema.Struct({
  LSHandlerURLScheme: Schema.optionalKey(Schema.String),
  LSHandlerRoleAll: Schema.optionalKey(Schema.String)
})

const decodeHandlers = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Handler)))

export const defaultBrowserIn = (handlers: string): string =>
  decodeHandlers(handlers).pipe(
    Option.flatMap(Array.findFirst((handler) => handler.LSHandlerURLScheme === "https")),
    Option.flatMap((handler) => Option.fromNullishOr(handler.LSHandlerRoleAll)),
    Option.getOrElse(() => safari)
  )
