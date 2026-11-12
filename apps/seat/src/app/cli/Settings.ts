import { Config, Console, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { secretsFolder } from "@sth-seat/protocol/Daemon.ts"
import { Audit } from "../../domains/audit/Audit.ts"
import { Link, linkProblem } from "../../domains/link/Link.ts"
import { requireDaemon } from "../LocalClient.ts"
import { Messages } from "../../domains/messages/Messages.ts"
import { Policies } from "../../domains/policy/Policies.ts"

const SeatConfig = Config.all({
  hubUrl: Config.option(Config.String("SEAT_HUB_URL")),
  configDir: Config.option(Config.String("SEAT_CONFIG_DIR")),
  inbox: Config.option(Config.String("SEAT_INBOX")),
  stateDir: Config.option(Config.String("SEAT_STATE_DIR")),
  handoff: Config.String("SEAT_HANDOFF").pipe(Config.withDefault("handoff")),
  shell: Config.String("SHELL").pipe(Config.withDefault("/bin/sh")),
  path: Config.String("PATH").pipe(Config.withDefault("")),
  home: Config.String("HOME"),
  runtimeDir: Config.option(Config.String("XDG_RUNTIME_DIR")),
  waylandDisplay: Config.option(Config.String("WAYLAND_DISPLAY")),
  collector: Config.option(Config.URL("OTEL_EXPORTER_OTLP_ENDPOINT"))
})

export const settings = Effect.gen(function* () {
  const config = yield* SeatConfig
  const path = yield* Path.Path
  const configDir = Option.getOrElse(config.configDir, () => path.join(config.home, ".config", "sth-seat"))
  const dataDir = path.join(config.home, ".local", "share", "sth-seat")

  return {
    hubUrl: config.hubUrl,
    hubFile: path.join(configDir, "hub"),
    collector: config.collector,
    home: config.home,
    handoff: config.handoff,
    shell: config.shell,
    searchPath: config.path,
    session: { runtimeDir: config.runtimeDir, waylandDisplay: config.waylandDisplay },
    identity: { keyFile: path.join(configDir, "key"), nameFile: path.join(configDir, "name") },
    policyFile: path.join(configDir, "policy.yaml"),
    stateDir: Option.getOrElse(config.stateDir, () => path.join(config.home, ".local", "state", "sth-seat")),
    inbox: Option.getOrElse(config.inbox, () => path.join(dataDir, "inbox")),
    secrets: path.join(config.home, ...secretsFolder)
  }
})

export type Settings = Effect.Success<typeof settings>

export class HubMissing extends Schema.TaggedError<HubMissing, { readonly brand: unique symbol }>()("HubMissing", {
  file: Schema.String
}) {
  override get message() {
    return `No hub set for this machine. Run \`sth-seat key --name <this machine> --hub wss://<your hub>/daemon\` (it writes ${this.file}), or set SEAT_HUB_URL.`
  }
}

export const hubUrlOf = Effect.fnUntraced(function* (found: Settings) {
  const fs = yield* FileSystem.FileSystem
  if (Option.isSome(found.hubUrl)) return found.hubUrl.value

  const text = yield* fs.readFileString(found.hubFile).pipe(Effect.orElseSucceed(() => ""))
  if (text.trim() === "") return yield* new HubMissing({ file: found.hubFile })

  return text.trim()
})

export const withHub = Effect.gen(function* () {
  const found = yield* settings
  const hubUrl = yield* hubUrlOf(found)

  return { ...found, hubUrl }
})

export const machineLayers = (found: Pick<Settings, "policyFile" | "stateDir">) =>
  Layer.mergeAll(
    Policies.layer(found.policyFile),
    Audit.layer(found.stateDir),
    Messages.layer(found.stateDir),
    Link.layer(found.stateDir)
  )

export const linkState = (found: Pick<Settings, "stateDir">) =>
  Link.use((link) => link.state).pipe(Effect.provide(Link.layer(found.stateDir)))

export const warnIfUnlinked = Effect.fnUntraced(function* (found: Pick<Settings, "stateDir">) {
  const state = yield* linkState(found)
  const now = yield* DateTime.now
  const problem = linkProblem(state, now)
  if (Option.isNone(problem)) return

  yield* Console.error(`warning: ${problem.value}`)
})

export const withDaemon = settings.pipe(
  Effect.tap((found) => requireDaemon(found)),
  Effect.tap(warnIfUnlinked)
)
