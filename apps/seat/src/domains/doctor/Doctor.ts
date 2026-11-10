import { Schema } from "effect"

export const CheckStatus = Schema.Literals(["ok", "warn", "fail"])
export type CheckStatus = typeof CheckStatus.Type

export const Check = Schema.Struct({ name: Schema.String, status: CheckStatus, detail: Schema.String })
export type Check = typeof Check.Type

export const Checks = Schema.Array(Check)

export const ok = (name: string, detail: string): Check => ({ name, status: "ok", detail })

export const warn = (name: string, detail: string): Check => ({ name, status: "warn", detail })

export const fail = (name: string, detail: string): Check => ({ name, status: "fail", detail })

const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const

export const lineOf = (check: Check): string => `${mark[check.status]}  ${check.name}: ${check.detail}`

export const healthy = (checks: ReadonlyArray<Check>): boolean => checks.every((check) => check.status !== "fail")

export const toolCheck = (tool: string, found: boolean, why: string): Check =>
  found ? ok(tool, "found") : warn(tool, `not on PATH; ${why}`)
