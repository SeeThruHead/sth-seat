import { Console, Duration, Effect, FileSystem, Option, Path, Record, Result, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { MachineName } from "@sth-seat/protocol/Ids.ts"
import { telemetryLayer } from "@sth-seat/protocol/Telemetry.ts"
import { Audit, AuditEntry } from "../../domains/audit/Audit.ts"
import { Checks, fail, healthy, lineOf, ok, toolCheck, warn } from "../../domains/doctor/Doctor.ts"
import type { Check } from "../../domains/doctor/Doctor.ts"
import { Files } from "../../domains/files/Files.ts"
import { Policies } from "../../domains/policy/Policies.ts"
import { brewStablePath, isBunRuntime } from "../../domains/service/Service.ts"
import { platformLayer, serviceLayer, toolsNeededOn } from "../../platform/Platform.ts"
import { ServiceManager } from "../../platform/Service.ts"
import { Ports } from "../../platform/Ports.ts"
import { Shell } from "../../platform/Shell.ts"
import { onPath } from "../../platform/Tools.ts"
import { daemon } from "../Daemon.ts"
import { askHub } from "../Hub.ts"
import { issueKey, readIdentity } from "../Identity.ts"
import type { Identity } from "../Identity.ts"
import { jsonFlag, report } from "./Output.ts"
import { hubUrlOf, machineLayers, settings, withHub } from "./Settings.ts"
import type { Settings } from "./Settings.ts"

export const daemonCommand = (version: string) =>
  Command.make(
    "daemon",
    {},
    Effect.fn("Cli.daemon")(function* () {
      const found = yield* withHub
      const remote = { home: found.home, maxRun: Duration.hours(24) }

      return yield* daemon({ hubUrl: found.hubUrl, identity: found.identity, remote }, version).pipe(
        Effect.provide([
          platformLayer({ os: process.platform, handoff: found.handoff, ...found.session }),
          Files.layer(found.inbox, found.secrets),
          Shell.layer(found.shell),
          Ports.layer,
          machineLayers(found),
          telemetryLayer({ collector: found.collector, serviceName: "sth-seat-daemon", serviceVersion: version })
        ])
      )
    })
  ).pipe(
    Command.withDescription(
      "Run this machine's daemon: link to the hub, report idle time, open what the hub sends, run what the policy allows. Started by systemd or launchd; see the README."
    )
  )

const key = Command.make(
  "key",
  {
    name: Flag.String("name").pipe(
      Flag.withSchema(MachineName),
      Flag.withDescription("This machine's name in the hub's config (lowercase letters, digits and dashes)")
    ),
    hub: Flag.String("hub").pipe(
      Flag.withDescription("The hub's daemon URL, such as wss://seat.example.com/daemon; saved for this machine"),
      Flag.optional
    ),
    force: Flag.Boolean("force").pipe(Flag.withDescription("Replace an existing key"), Flag.withDefault(false))
  },
  Effect.fn("Cli.key")(function* ({ name, hub, force }) {
    const found = yield* settings
    const fs = yield* FileSystem.FileSystem
    yield* issueKey(found.identity, name, force)
    if (Option.isNone(hub)) return

    yield* fs.writeFileString(found.hubFile, `${hub.value}\n`, { mode: 0o600 })

    yield* Console.log(`This machine's hub: ${hub.value} (in ${found.hubFile}).`)
  })
).pipe(
  Command.withDescription(
    "Set this machine up: make its key pair, save its name and hub, and print the public key for the hub's config"
  )
)

const setLock = (locked: boolean) =>
  Effect.fn(locked ? "Cli.lock" : "Cli.unlock")(function* () {
    const found = yield* settings
    yield* Audit.use((audit) => audit.setLocked(locked)).pipe(Effect.provide(Audit.layer(found.stateDir)))

    yield* Console.log(locked ? "Locked: this machine refuses everything until `sth-seat unlock`." : "Unlocked.")
  })

const lock = Command.make("lock", {}, setLock(true)).pipe(
  Command.withDescription("Refuse every command from other machines and the hub until `sth-seat unlock`")
)

const unlock = Command.make("unlock", {}, setLock(false)).pipe(Command.withDescription("Take commands again"))

const entryLine = (entry: AuditEntry): string =>
  `${entry.at}  ${entry.caller}  ${entry.action}  ${entry.target}  ${entry.result}`

const log = Command.make(
  "log",
  { count: Flag.Int("count").pipe(Flag.withDescription("How many entries"), Flag.withDefault(20)), json: jsonFlag },
  Effect.fn("Cli.log")(function* ({ count, json }) {
    const found = yield* settings
    const entries = yield* Audit.use((audit) => audit.recent(count)).pipe(Effect.provide(Audit.layer(found.stateDir)))

    yield* report(Schema.Array(AuditEntry), json, entries, entries.map(entryLine).join("\n"))
  })
).pipe(Command.withDescription("What other machines and the hub did on this machine, newest last"))

export class InstallProblem extends Schema.TaggedError<InstallProblem, { readonly brand: unique symbol }>()(
  "InstallProblem",
  { problem: Schema.String }
) {
  override get message() {
    return this.problem
  }
}

const wrapperAt = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem
  const present = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
  if (!present)
    return yield* new InstallProblem({
      problem: `${target} is missing. Install a release binary, or copy apps/seat/install/sth-seat there (see the README).`
    })

  return target
})

const copiedTo = Effect.fnUntraced(function* (running: string, target: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(target), { recursive: true })
  yield* fs.copyFile(running, `${target}.new`)
  yield* fs.chmod(`${target}.new`, 0o755)
  yield* fs.rename(`${target}.new`, target)

  return target
})

const brewInstalled = Effect.fnUntraced(function* (running: string) {
  const fs = yield* FileSystem.FileSystem
  const real = yield* fs.realPath(running).pipe(Effect.orElseSucceed(() => running))

  return brewStablePath(real)
})

const installedExecutable = Effect.fnUntraced(function* (found: Settings) {
  const path = yield* Path.Path
  const target = path.join(found.home, ".local", "bin", "sth-seat")
  const running = process.execPath
  if (isBunRuntime(running)) return yield* wrapperAt(target)
  if (running === target) return target
  const brew = yield* brewInstalled(running)
  if (Option.isSome(brew)) return brew.value

  return yield* copiedTo(running, target)
})

const serviceFor = (found: Settings) => serviceLayer(process.platform, found.home, process.getuid?.() ?? 0)

const install = Command.make(
  "install",
  {},
  Effect.fn("Cli.install")(function* () {
    const found = yield* settings
    const executable = yield* installedExecutable(found)
    const done = yield* ServiceManager.use((manager) => manager.install(executable)).pipe(
      Effect.provide(serviceFor(found))
    )

    yield* Console.log(`sth-seat is at ${executable}. ${done}`)
  })
).pipe(
  Command.withDescription(
    "Install this machine's daemon as a user service (systemd on Linux, launchd on macOS) and start it; run `sth-seat key` first"
  )
)

const uninstall = Command.make(
  "uninstall",
  {},
  Effect.fn("Cli.uninstall")(function* () {
    const found = yield* settings
    const done = yield* ServiceManager.use((manager) => manager.uninstall).pipe(Effect.provide(serviceFor(found)))

    yield* Console.log(done)
  })
).pipe(Command.withDescription("Stop this machine's daemon and remove its user service; keys and policy stay"))

export class SetupIncomplete extends Schema.TaggedError<SetupIncomplete, { readonly brand: unique symbol }>()(
  "SetupIncomplete",
  { failing: Schema.Int }
) {
  override get message() {
    return `${this.failing} check(s) failed; fix the FAIL lines above.`
  }
}

const identityCheck = (found: Option.Option<Identity>): Check =>
  Option.match(found, {
    onNone: () => fail("key", "no key yet; run `sth-seat key --name <this machine> --hub wss://<your hub>/daemon`"),
    onSome: (me) => ok("key", `${me.name}, public key ${me.publicText}`)
  })

const hubLinkChecks = Effect.fnUntraced(function* (found: Settings, hubUrl: string, me: Identity) {
  const whereabouts = yield* askHub({ hubUrl, identity: found.identity }, (hub) => hub.Where()).pipe(
    Effect.timeout("15 seconds"),
    Effect.result
  )
  if (Result.isFailure(whereabouts)) return [fail("hub", `${hubUrl}: ${whereabouts.failure.message}`)]

  const here = whereabouts.success.machines.find((machine) => machine.name === me.name)
  const daemonCheck =
    here?.online === true
      ? ok("daemon", "connected to the hub")
      : warn("daemon", "not connected; start it (systemctl --user start sth-seat, or launchctl on macOS)")

  return [ok("hub", `${hubUrl}: ${whereabouts.success.message}`), daemonCheck]
})

const policyCheck = Effect.fnUntraced(function* (found: Settings) {
  const fs = yield* FileSystem.FileSystem
  const present = yield* fs.exists(found.policyFile).pipe(Effect.orElseSucceed(() => false))
  if (!present) return warn("policy", `no ${found.policyFile}: only the hub may deliver pages and files here`)

  const policy = yield* Policies.use((policies) => policies.current).pipe(
    Effect.provide(Policies.layer(found.policyFile)),
    Effect.result
  )
  if (Result.isFailure(policy)) return fail("policy", policy.failure.message)

  const trusted = Record.keys(policy.success.machines)

  return ok(
    "policy",
    `${policy.success.allow.length} rule(s); trusts ${trusted.length === 0 ? "no machines" : trusted.join(", ")}`
  )
})

const doctorChecks = Effect.fnUntraced(function* () {
  const found = yield* settings
  const identity = yield* readIdentity(found.identity).pipe(Effect.result)
  const identityResult = Result.match(identity, {
    onFailure: (problem) => fail("key", problem.message),
    onSuccess: identityCheck
  })
  const hubUrl = yield* hubUrlOf(found).pipe(Effect.result)
  const me = Result.isSuccess(identity) ? identity.success : Option.none<Identity>()
  const linkChecks =
    Result.isSuccess(hubUrl) && Option.isSome(me)
      ? yield* hubLinkChecks(found, hubUrl.success, me.value)
      : [
          Result.match(hubUrl, {
            onFailure: (missing) => fail("hub", missing.message),
            onSuccess: (url) => warn("hub", `${url}: not tried without a key`)
          })
        ]
  const policy = yield* policyCheck(found)
  const locked = yield* Audit.use((audit) => audit.isLocked).pipe(Effect.provide(Audit.layer(found.stateDir)))
  const lockCheck = locked ? warn("lock", "locked; run `sth-seat unlock`") : ok("lock", "taking commands")
  const tools = yield* Effect.forEach(toolsNeededOn(process.platform), (needed) =>
    Effect.map(onPath(needed.tool, found.searchPath), (present) => toolCheck(needed.tool, present, needed.why))
  )
  const checks: ReadonlyArray<Check> = [identityResult, ...linkChecks, policy, lockCheck, ...tools]

  return checks
})

const doctor = Command.make(
  "doctor",
  { json: jsonFlag },
  Effect.fn("Cli.doctor")(function* ({ json }) {
    const checks = yield* doctorChecks()
    yield* report(Checks, json, checks, checks.map(lineOf).join("\n"))
    if (healthy(checks)) return

    return yield* new SetupIncomplete({ failing: checks.filter((check) => check.status === "fail").length })
  })
).pipe(
  Command.withDescription(
    "Check this machine's setup: key, hub, the daemon's link, policy, lock and the desktop tools it needs. Run it first when anything fails."
  )
)

export const localCommands = (version: string) =>
  [daemonCommand(version), key, install, uninstall, lock, unlock, log, doctor] as const
