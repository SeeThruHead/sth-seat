import * as Path from "node:path"
import { Predicate } from "effect"

type Loc = { readonly start: { readonly line: number }; readonly end: { readonly line: number } }

type Node = { readonly type: string; readonly loc: Loc; readonly parent?: Node | null }

type Report = { readonly node: Node; readonly message: string }

type Context = {
  readonly filename: string
  readonly report: (report: Report) => void
  readonly sourceCode: { readonly getAllComments: () => ReadonlyArray<Node> }
}

type Visitor = Readonly<Record<string, (node: Node) => void>>

type Rule = { readonly meta: { readonly type: "problem" }; readonly create: (context: Context) => Visitor }

const isNode = (value: unknown): value is Node => Predicate.hasProperty(value, "type") && Predicate.isString(value.type)

const field = (node: unknown, key: string): unknown => (Predicate.hasProperty(node, key) ? node[key] : undefined)

const nameOf = (node: unknown): string | undefined => {
  const name = field(node, "name")

  return Predicate.isString(name) ? name : undefined
}

const stringValue = (node: unknown): string | undefined => {
  const value = field(node, "value")

  return Predicate.isString(value) ? value : undefined
}

const memberParts = (
  node: unknown
): { readonly object: string | undefined; readonly property: string | undefined } => ({
  object: nameOf(field(node, "object")),
  property: nameOf(field(node, "property"))
})

const isFunction = (node: Node): boolean =>
  ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)

const rule = (create: (context: Context) => Visitor): Rule => ({ meta: { type: "problem" }, create })

const reportAll =
  (context: Context, message: string) =>
  (node: Node): void =>
    context.report({ node, message })

const posix = (file: string): string => file.split(Path.sep).join("/")

const srcPath = (file: string): string | undefined => {
  const normalized = posix(Path.resolve(file))
  const index = normalized.lastIndexOf("/src/")

  return index === -1 ? undefined : normalized.slice(index + "/src/".length)
}

const appFolder = /^.*\/apps\/([^/]+)\//

const appOf = (file: string): string | undefined => appFolder.exec(posix(Path.resolve(file)))?.[1]

const packageFolder = /^.*\/packages\/([^/]+)\//

const packageOf = (file: string): string | undefined => packageFolder.exec(posix(Path.resolve(file)))?.[1]

const workspaceApp = /^(hub|seat)(\/|$)/

const importedApp = (file: string, specifier: string): string | undefined => {
  if (specifier.startsWith(".")) return appOf(Path.resolve(Path.dirname(file), specifier))

  return workspaceApp.exec(specifier)?.[1]
}

const resolvedSrc = (file: string, specifier: string): string | undefined =>
  specifier.startsWith(".") ? srcPath(Path.resolve(Path.dirname(file), specifier)) : undefined

const domainOf = (path: string | undefined): string | undefined =>
  path?.startsWith("domains/") === true ? path.split("/")[1] : undefined

const isTestFile = (file: string): boolean => file.endsWith(".test.ts") || file.endsWith(".testing.ts")

const isEntryPoint = (file: string): boolean => {
  const path = srcPath(file)
  if (path === "app/main.ts") return true
  if (path === "app/server.ts") return true

  return posix(file).endsWith("-hook.ts")
}

const transportBuilders = new Set(["Rpc.make", "RpcGroup.make", "Tool.make", "Toolkit.make"])

const isTransportModule = (file: string): boolean => posix(file).endsWith("packages/protocol/src/Action.ts")

const processModules = /^(effect\/process|node:child_process|child_process|bun)$/

const mayRunProcesses = (file: string): boolean => {
  if (isTestFile(file)) return true

  return srcPath(file)?.startsWith("platform/") === true
}

const transports = /^effect\/(rpc|ai|http|socket)/

const crossAppViolation = (file: string, specifier: string): string | undefined => {
  const from = appOf(file)
  const target = importedApp(file, specifier)
  if (from === undefined) return undefined
  if (target === undefined) return undefined
  if (from === target) return undefined

  return `apps/${from} must not import apps/${target}; they share only packages/protocol`
}

const crossDomainViolation = (file: string, specifier: string): string | undefined => {
  const from = domainOf(srcPath(file))
  const target = domainOf(resolvedSrc(file, specifier))
  if (from === undefined) return undefined
  if (target === undefined) return undefined
  if (from === target) return undefined

  return `domains/${from} must not import domains/${target}; put steps that span domains in a feature handler`
}

const processViolation = (file: string, specifier: string): string | undefined => {
  if (!processModules.test(specifier)) return undefined
  if (mayRunProcesses(file)) return undefined

  return "only src/platform/ may start processes; ask a platform service instead"
}

const handlerViolation = (file: string, specifier: string): string | undefined => {
  if (!posix(file).endsWith("/handler.ts")) return undefined
  if (!transports.test(specifier)) return undefined

  return "a handler orchestrates services; transports (RPC, MCP, HTTP) belong in src/app"
}

const protocolViolation = (file: string, specifier: string): string | undefined => {
  if (packageOf(file) !== "protocol") return undefined
  if (!/^(@effect\/platform|effect\/process|node:|bun)/.test(specifier)) return undefined

  return "packages/protocol holds schemas and contracts only; no platform or process imports"
}

const boundaryViolation = (file: string, specifier: string): string | undefined =>
  [crossAppViolation, crossDomainViolation, processViolation, handlerViolation, protocolViolation]
    .map((check) => check(file, specifier))
    .find((message) => message !== undefined)

const checkSource = (context: Context) => (node: Node) => {
  const specifier = stringValue(field(node, "source"))
  if (specifier === undefined) return
  const message = boundaryViolation(context.filename, specifier)
  if (message === undefined) return

  context.report({ node, message })
}

const mutatingMethods = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"])

const isModuleName = (name: string | undefined): boolean => name !== undefined && /^[A-Z]/.test(name)

const freshValueTypes = new Set([
  "ObjectExpression",
  "ArrayExpression",
  "ArrowFunctionExpression",
  "FunctionExpression"
])

const isFreshValue = (node: unknown): boolean => isNode(node) && freshValueTypes.has(node.type)

const nestedInIf = (node: Node): boolean => {
  const parent: unknown = node.parent
  if (!isNode(parent)) return false
  if (isFunction(parent)) return false
  if (parent.type === "IfStatement" && field(parent, "alternate") === node) return nestedInIf(parent)
  if (parent.type === "IfStatement") return true

  return nestedInIf(parent)
}

const isEffectGenCall = (node: unknown): boolean => {
  if (!isNode(node) || node.type !== "CallExpression") return false
  const callee = memberParts(field(node, "callee"))

  return callee.object === "Effect" && callee.property === "gen"
}

const returnsOnlyEffectGen = (body: unknown): boolean => {
  if (isEffectGenCall(body)) return true
  if (!isNode(body) || body.type !== "BlockStatement") return false
  const statements = field(body, "body")
  if (!Array.isArray(statements) || statements.length !== 1) return false

  return isEffectGenCall(field(statements[0], "argument"))
}

const isThunkArgument = (node: Node): boolean => {
  const params = field(node, "params")
  if (!Array.isArray(params) || params.length > 0) return false

  return node.parent?.type === "CallExpression"
}

const isAsConst = (node: Node): boolean => nameOf(field(field(node, "typeAnnotation"), "typeName")) === "const"

const runtimes = new Set(["Effect", "BunRuntime", "NodeRuntime"])

const rules: Readonly<Record<string, Rule>> = {
  "no-loops": rule((context) => {
    const report = reportAll(context, "no loops; use Array methods, Effect.forEach or recursion")

    return {
      ForStatement: report,
      ForInStatement: report,
      ForOfStatement: report,
      WhileStatement: report,
      DoWhileStatement: report
    }
  }),

  "no-let": rule((context) => ({
    VariableDeclaration: (node) => {
      const kind = field(node, "kind")
      if (kind !== "let" && kind !== "var") return

      context.report({ node, message: "const only; no let or var" })
    }
  })),

  "no-mutation": rule((context) => ({
    CallExpression: (node) => {
      const parts = memberParts(field(node, "callee"))
      const args = field(node, "arguments")
      const first = Array.isArray(args) ? args[0] : undefined

      if (parts.object === "Object" && parts.property === "assign" && !isFreshValue(first))
        return context.report({ node, message: "Object.assign onto an existing value mutates it; spread instead" })
      if (parts.property === undefined || !mutatingMethods.has(parts.property)) return
      if (isModuleName(parts.object)) return

      context.report({ node, message: `${parts.property}() mutates in place; use toSorted, toReversed or a spread` })
    },
    AssignmentExpression: (node) => {
      if (field(field(node, "left"), "type") !== "MemberExpression") return

      context.report({ node, message: "no property assignment; build a new value" })
    },
    UpdateExpression: reportAll(context, "no ++ or --; build a new value")
  })),

  "no-comments": rule((context) => ({
    Program: () =>
      context.sourceCode
        .getAllComments()
        .forEach(reportAll(context, "no comments; rationale goes in the commit or docs"))
  })),

  "no-nested-if": rule((context) => ({
    IfStatement: (node) => {
      if (!nestedInIf(node)) return

      context.report({ node, message: "no nested if; use guard clauses or a named helper" })
    }
  })),

  "no-multiline-logical": rule((context) => ({
    LogicalExpression: (node) => {
      if (node.parent?.type === "LogicalExpression") return
      if (field(node, "operator") === "??") return
      if (node.loc.start.line === node.loc.end.line) return

      context.report({ node, message: "no multi-line && / || chains; name the condition as a helper of guards" })
    }
  })),

  "no-casts": rule((context) => ({
    TSAsExpression: (node) => {
      if (isAsConst(node)) return

      context.report({ node, message: "no casts; restructure until it typechecks" })
    },
    TSTypeAssertion: reportAll(context, "no casts; restructure until it typechecks")
  })),

  "run-at-entry-only": rule((context) => ({
    MemberExpression: (node) => {
      const parts = memberParts(node)
      if (parts.object === undefined || !runtimes.has(parts.object)) return
      if (parts.property === undefined || !parts.property.startsWith("run")) return
      if (isEntryPoint(context.filename)) return

      context.report({
        node,
        message: "Effect.run* and runMain belong only in src/app/main.ts, src/app/server.ts and hooks"
      })
    }
  })),

  "transports-from-contracts": rule((context) => ({
    MemberExpression: (node) => {
      const parts = memberParts(node)
      if (!transportBuilders.has(`${parts.object}.${parts.property}`)) return
      if (isTransportModule(context.filename)) return

      context.report({
        node,
        message:
          "declare an action in packages/protocol/src/Actions.ts with action(...), which builds its RPC and MCP tool; only Action.ts builds transports"
      })
    }
  })),

  "no-gen-wrapper": rule((context) => {
    const check = (node: Node) => {
      if (isThunkArgument(node)) return
      if (!returnsOnlyEffectGen(field(node, "body"))) return

      context.report({
        node,
        message: "a function that only returns Effect.gen should be Effect.fn or Effect.fnUntraced"
      })
    }

    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check }
  }),

  boundaries: rule((context) => {
    const check = checkSource(context)

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check
    }
  })
}

export default { meta: { name: "house" }, rules }
