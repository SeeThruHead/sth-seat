import { Effect, Layer, Option, Schema } from "effect"
import type { FileSystem, Path } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { Desktop, openerWindow } from "./Desktop.ts"
import { Idle } from "./Idle.ts"
import { ServiceManager } from "./Service.ts"
import { DesktopSession } from "./Session.ts"
import type { SessionSettings } from "./Session.ts"

export class UnsupportedPlatform extends Schema.TaggedError<UnsupportedPlatform, { readonly brand: unique symbol }>()(
  "UnsupportedPlatform",
  { platform: Schema.String }
) {
  override get message() {
    return `sth-seat runs on macOS and Linux, not ${this.platform}. On Windows, run it inside WSL.`
  }
}

export type PlatformSettings = SessionSettings & {
  readonly os: string
  readonly handoff: string
  readonly home: string
}

const darwinTools = {
  open: "open",
  ioreg: "ioreg",
  osascript: "osascript",
  secretPrompt: "herdr-secret",
  pbcopy: "pbcopy",
  plutil: "plutil"
}

const launchServicesIn = (home: string): string =>
  `${home}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist`

const linuxTools = {
  open: "xdg-open",
  swayidle: "swayidle",
  notifySend: "notify-send",
  zenity: "zenity",
  gdbus: "gdbus",
  hyprctl: "hyprctl",
  shell: "/bin/sh",
  wlCopy: "wl-copy",
  xdgMime: "xdg-mime",
  launcher: "gtk-launch"
}

type PlatformLayer = Layer.Layer<Desktop | Idle, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem>

const layers = (settings: PlatformSettings): Readonly<Record<string, PlatformLayer>> => ({
  darwin: Layer.mergeAll(
    Desktop.darwin({
      open: darwinTools.open,
      handoff: settings.handoff,
      osascript: darwinTools.osascript,
      secretPrompt: darwinTools.secretPrompt,
      pbcopy: darwinTools.pbcopy,
      plutil: darwinTools.plutil,
      launchServices: launchServicesIn(settings.home)
    }),
    Idle.darwin(darwinTools.ioreg)
  ),
  linux: Layer.mergeAll(
    Desktop.linux({
      open: linuxTools.open,
      notifySend: linuxTools.notifySend,
      zenity: linuxTools.zenity,
      gdbus: linuxTools.gdbus,
      hyprctl: linuxTools.hyprctl,
      shell: linuxTools.shell,
      wlCopy: linuxTools.wlCopy,
      xdgMime: linuxTools.xdgMime,
      launcher: linuxTools.launcher,
      openerWindow
    }),
    Idle.wayland(linuxTools.swayidle)
  ).pipe(Layer.provide(DesktopSession.wayland(settings)))
})

export const platformLayer = (settings: PlatformSettings) =>
  Layer.unwrap(
    Effect.fromOption(Option.fromNullishOr(layers(settings)[settings.os])).pipe(
      Effect.mapError(() => new UnsupportedPlatform({ platform: settings.os }))
    )
  )

export type NeededTool = { readonly tool: string; readonly why: string }

const neededTools: Readonly<Record<string, ReadonlyArray<NeededTool>>> = {
  darwin: [
    {
      tool: darwinTools.open,
      why: "URLs open in the default browser with it (`open -b`), and `open --reveal` shows files in Finder with it"
    },
    { tool: "handoff", why: "files for the seat go to Handoff with it; install Handoff's CLI or set SEAT_HANDOFF" },
    { tool: darwinTools.osascript, why: "notifications and secret prompts use it" },
    { tool: darwinTools.ioreg, why: "idle time comes from it" }
  ],
  linux: [
    { tool: linuxTools.open, why: "files open with it (xdg-utils)" },
    { tool: linuxTools.xdgMime, why: "the default browser comes from it (xdg-utils)" },
    { tool: linuxTools.launcher, why: "URLs open in the default browser with it, never through xdg-open (gtk3)" },
    { tool: linuxTools.swayidle, why: "idle time comes from it, so this machine can be the seat" },
    { tool: linuxTools.notifySend, why: "notifications use it (libnotify)" },
    { tool: linuxTools.zenity, why: "secret prompts use it" },
    { tool: linuxTools.gdbus, why: "`open --reveal` asks the file manager to show a file with it (glib2)" }
  ]
}

export const toolsNeededOn = (os: string): ReadonlyArray<NeededTool> => neededTools[os] ?? []

type ServiceLayer = Layer.Layer<
  ServiceManager,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
>

const serviceLayers = (home: string, uid: number): Readonly<Record<string, ServiceLayer>> => ({
  darwin: ServiceManager.launchd(home, uid),
  linux: ServiceManager.systemd(home)
})

export const serviceLayer = (os: string, home: string, uid: number) =>
  Layer.unwrap(
    Effect.fromOption(Option.fromNullishOr(serviceLayers(home, uid)[os])).pipe(
      Effect.mapError(() => new UnsupportedPlatform({ platform: os }))
    )
  )
