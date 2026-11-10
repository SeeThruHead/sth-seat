const hasScheme = /^[a-z][a-z0-9+.-]*:/i

export const localTarget = (raw: string, cwd: string, home: string): string => {
  if (hasScheme.test(raw)) return raw
  if (raw.startsWith("/")) return raw
  if (raw === "~") return home
  if (raw.startsWith("~/")) return `${home}/${raw.slice(2)}`

  return `${cwd.replace(/\/$/, "")}/${raw.replace(/^\.\//, "")}`
}
