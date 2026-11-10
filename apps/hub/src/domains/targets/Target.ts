import { Option, Schema } from "effect"
import { FilePath, WebUrl } from "@sth-seat/protocol/Ids.ts"
import { Port } from "@sth-seat/protocol/Remote.ts"

export type Target =
  | { readonly _tag: "Url"; readonly url: URL; readonly local: boolean }
  | { readonly _tag: "File"; readonly path: FilePath }
  | { readonly _tag: "Invalid"; readonly reason: string }

const loopbackHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"])

const isLoopback = (url: URL): boolean => loopbackHosts.has(url.hostname) || url.hostname.endsWith(".localhost")

const decodePath = Schema.decodeUnknownOption(FilePath)

const decodeUrl = Schema.decodeUnknownOption(WebUrl)

const invalid = (reason: string): Target => ({ _tag: "Invalid", reason })

const fileAt = (path: string): Target =>
  Option.match(decodePath(path), {
    onNone: () => invalid(`"${path}" isn't an absolute file path.`),
    onSome: (found): Target => ({ _tag: "File", path: found })
  })

const parsed = (target: string): Option.Option<URL> => Option.fromNullishOr(URL.parse(target))

const fromUrl = (url: URL): Target => {
  if (url.protocol === "file:") return fileAt(decodeURIComponent(url.pathname))
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return invalid(`Only http(s) URLs and files can be opened, not ${url.protocol} links.`)

  return { _tag: "Url", url, local: isLoopback(url) }
}

export const classify = (target: string): Target => {
  const trimmed = target.trim()
  if (trimmed.startsWith("/")) return fileAt(trimmed)

  return Option.match(parsed(trimmed), {
    onNone: () => invalid(`"${trimmed}" is neither a URL nor an absolute file path.`),
    onSome: fromUrl
  })
}

export type TunnelTarget = { readonly scheme: "http" | "https"; readonly port: Port; readonly path: string }

const defaultPort = { http: 80, https: 443 } as const

export const tunnelTo = (url: URL): TunnelTarget => {
  const scheme = url.protocol === "https:" ? "https" : "http"
  const port = Port.make(url.port === "" ? defaultPort[scheme] : Number(url.port))

  return { scheme, port, path: `${url.pathname}${url.search}${url.hash}` }
}

export const asWebUrl = (url: URL): Option.Option<WebUrl> => decodeUrl(url.href)
