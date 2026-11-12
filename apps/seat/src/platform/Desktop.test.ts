import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, FileSystem, Layer, Option, Redacted } from "effect"
import { MachineLabel, SecretName, Title, WebUrl } from "@sth-seat/protocol/Ids.ts"
import { script } from "../testing/Seat.testing.ts"
import { Desktop } from "./Desktop.ts"
import { DesktopSession } from "./Session.ts"

const sessionIn = (folder: string) =>
  DesktopSession.wayland({ runtimeDir: Option.some(folder), waylandDisplay: Option.none() })

const url = WebUrl.make("https://example.com/")

const logged = (folder: string) => FileSystem.FileSystem.use((fs) => fs.readFileString(`${folder}/log`))

const name = SecretName.make("plex-token")

const browserEntry = (folder: string) => script(folder, "xdg-mime", "echo browser.desktop")

const toTower = Option.some({
  machine: MachineLabel.make("Tower"),
  file: "~/.local/share/sth-seat/secrets/plex-token"
})

const onLinux = (folder: string, open: string, gdbus: string, hyprctl = `${folder}/missing`) =>
  Desktop.linux({
    open,
    notifySend: open,
    zenity: open,
    gdbus,
    hyprctl,
    shell: "/bin/sh",
    wlCopy: "/bin/true",
    xdgMime: `${folder}/xdg-mime`,
    launcher: open,
    openerWindow: Duration.millis(300)
  }).pipe(Layer.provide(sessionIn(folder)))

const askOnMac = (secretPrompt: string, osascript: string, destination: typeof toTower) =>
  Desktop.use((desktop) => desktop.askSecret(name, "Plex token?", destination)).pipe(
    Effect.provide(
      Desktop.darwin({
        open: osascript,
        handoff: osascript,
        osascript,
        secretPrompt,
        pbcopy: "/bin/true",
        plutil: "/nonexistent/plutil",
        launchServices: "/nonexistent.plist"
      })
    )
  )

describe("Desktop", () => {
  it.live("puts text on the clipboard through the platform's copy tool, on stdin", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      const copy = yield* script(folder, "copy", `cat >> ${folder}/log; echo " <- $0" >> ${folder}/log`)
      const missing = `${folder}/missing`
      const mac = Desktop.darwin({
        open: missing,
        handoff: missing,
        osascript: missing,
        secretPrompt: missing,
        pbcopy: copy,
        plutil: missing,
        launchServices: missing
      })
      const linux = Desktop.linux({
        open: missing,
        notifySend: missing,
        zenity: missing,
        gdbus: missing,
        hyprctl: missing,
        shell: "/bin/sh",
        wlCopy: copy,
        xdgMime: missing,
        launcher: missing,
        openerWindow: Duration.millis(300)
      }).pipe(Layer.provide(sessionIn(folder)))
      yield* Desktop.use((desktop) => desktop.copyText("from the Mac")).pipe(Effect.provide(mac))
      yield* Desktop.use((desktop) => desktop.copyText("from Linux")).pipe(Effect.provide(linux))
      const log = yield* logged(folder)

      assert.strictEqual(log, `from the Mac <- ${copy}\nfrom Linux <- ${copy}\n`)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live(
    "on macOS opens URLs in the default browser by its bundle id and hands files to Handoff with their title",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const folder = yield* fs.makeTempDirectoryScoped()
        const open = yield* script(folder, "open", `echo "open $*" >> ${folder}/log`)
        const plutil = yield* script(
          folder,
          "plutil",
          `[ "$6" = "${folder}/ls.plist" ] && echo '[{"LSHandlerURLScheme":"https","LSHandlerRoleAll":"com.google.chrome"}]'`
        )
        const handoff = yield* script(folder, "handoff", `echo "handoff $*" >> ${folder}/log`)
        const osascript = yield* script(folder, "osascript", `echo "osascript $*" >> ${folder}/log`)
        yield* Effect.gen(function* () {
          const desktop = yield* Desktop
          yield* desktop.openUrl(url)
          yield* desktop.openFile("/tmp/a.html", Option.some(Title.make("Report")))
          yield* desktop.openFile("/tmp/b.html", Option.none())
          yield* desktop.notify(Title.make("Done"), 'It "passed"')
        }).pipe(
          Effect.provide(
            Desktop.darwin({
              open,
              handoff,
              osascript,
              secretPrompt: `${folder}/missing`,
              pbcopy: "/bin/true",
              plutil,
              launchServices: `${folder}/ls.plist`
            })
          )
        )
        const log = yield* logged(folder)

        assert.strictEqual(
          log,
          'open -b com.google.chrome https://example.com/\nhandoff /tmp/a.html --title Report\nhandoff /tmp/b.html\nosascript -e on run argv -e display notification (item 2 of argv) with title (item 1 of argv) -e end run Done It "passed"\n'
        )
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux opens URLs in the default browser's desktop entry and files with xdg-open", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      yield* browserEntry(folder)
      const open = yield* script(folder, "xdg-open", `echo "xdg-open $WAYLAND_DISPLAY $*" >> ${folder}/log`)
      yield* Effect.gen(function* () {
        const desktop = yield* Desktop
        yield* desktop.openUrl(url)
        yield* desktop.openFile("/tmp/a.html", Option.some(Title.make("Report")))
        yield* desktop.notify(Title.make("Done"), "It passed")
      }).pipe(
        Effect.provide(
          Desktop.linux({
            open,
            notifySend: open,
            zenity: open,
            gdbus: open,
            hyprctl: `${folder}/missing`,
            shell: "/bin/sh",
            wlCopy: "/bin/true",
            xdgMime: `${folder}/xdg-mime`,
            launcher: open,
            openerWindow: Duration.millis(300)
          }).pipe(Layer.provide(sessionIn(folder)))
        )
      )
      const log = yield* logged(folder)

      assert.strictEqual(
        log,
        "xdg-open wayland-1 browser.desktop https://example.com/\nxdg-open wayland-1 /tmp/a.html\nxdg-open wayland-1 --app-name=sth-seat -- Done It passed\n"
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux says nobody is logged in when there is no desktop session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const open = yield* script(folder, "xdg-open", "exit 0")
      const failed = yield* Effect.flip(
        Desktop.use((desktop) => desktop.openUrl(url)).pipe(
          Effect.provide(
            Desktop.linux({
              open,
              notifySend: open,
              zenity: open,
              gdbus: open,
              hyprctl: `${folder}/missing`,
              shell: "/bin/sh",
              wlCopy: "/bin/true",
              xdgMime: `${folder}/xdg-mime`,
              launcher: open,
              openerWindow: Duration.millis(300)
            }).pipe(Layer.provide(sessionIn(folder)))
          )
        )
      )
      const unset = yield* Effect.flip(
        Desktop.use((desktop) => desktop.openUrl(url)).pipe(
          Effect.provide(
            Desktop.linux({
              open,
              notifySend: open,
              zenity: open,
              gdbus: open,
              hyprctl: `${folder}/missing`,
              shell: "/bin/sh",
              wlCopy: "/bin/true",
              xdgMime: `${folder}/xdg-mime`,
              launcher: open,
              openerWindow: Duration.millis(300)
            }).pipe(Layer.provide(DesktopSession.wayland({ runtimeDir: Option.none(), waylandDisplay: Option.none() })))
          )
        )
      )

      const gone = yield* Effect.flip(
        Desktop.use((desktop) => desktop.openUrl(url)).pipe(
          Effect.provide(
            Desktop.linux({
              open,
              notifySend: open,
              zenity: open,
              gdbus: open,
              hyprctl: `${folder}/missing`,
              shell: "/bin/sh",
              wlCopy: "/bin/true",
              xdgMime: `${folder}/xdg-mime`,
              launcher: open,
              openerWindow: Duration.millis(300)
            }).pipe(Layer.provide(sessionIn(`${folder}/missing`)))
          )
        )
      )

      assert.deepStrictEqual(
        [failed.problem, unset.problem, gone.problem],
        [1, 2, 3].map(() => "nobody is logged in to the desktop here")
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live(
    "reveals a file in Finder on macOS and brings Finder forward, and through the file manager's D-Bus service on Linux",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const folder = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(`${folder}/wayland-1`, "")
        const open = yield* script(folder, "open", `echo "open $*" >> ${folder}/log`)
        const gdbus = yield* script(folder, "gdbus", `echo "gdbus $*" >> ${folder}/log`)
        yield* Desktop.use((desktop) => desktop.revealFile("/inbox/app.dmg")).pipe(
          Effect.provide(
            Desktop.darwin({
              open,
              handoff: open,
              osascript: open,
              secretPrompt: open,
              pbcopy: "/bin/true",
              plutil: "/nonexistent/plutil",
              launchServices: "/nonexistent.plist"
            })
          )
        )
        yield* Desktop.use((desktop) => desktop.revealFile("/inbox/Bob's report #1.pdf")).pipe(
          Effect.provide(onLinux(folder, open, gdbus))
        )
        const log = yield* logged(folder)

        assert.strictEqual(
          log,
          "open -R /inbox/app.dmg\nopen -a Finder\ngdbus call --session --dest org.freedesktop.FileManager1 --object-path /org/freedesktop/FileManager1 --method org.freedesktop.FileManager1.ShowItems ['file:///inbox/Bob%27s%20report%20%231.pdf'] \n"
        )
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux sends a notification instead of opening while a game has focus", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      const desktop = yield* script(folder, "desktop", `echo "$(basename "$0") $*" >> ${folder}/log`)
      const wow = yield* script(
        folder,
        "hyprctl",
        `echo "$*" >> ${folder}/asked; echo '{"class":"wow.exe","fullscreen":0}'`
      )
      const kitty = yield* script(folder, "hyprctl-kitty", `echo '{"class":"kitty","fullscreen":0}'`)
      yield* browserEntry(folder)
      const openWith = (hyprctl: string) =>
        Desktop.use((linux) => linux.openUrl(url)).pipe(Effect.provide(onLinux(folder, desktop, desktop, hyprctl)))
      yield* openWith(wow)
      const whilePlaying = yield* logged(folder)
      const asked = yield* fs.readFileString(`${folder}/asked`)
      yield* openWith(kitty)
      yield* openWith(`${folder}/missing`)
      const after = yield* logged(folder)

      assert.strictEqual(asked, "-i 0 activewindow -j\n")
      assert.strictEqual(whilePlaying, "desktop --app-name=sth-seat -- sth-seat Ready to open: https://example.com/\n")
      assert.strictEqual(
        after,
        "desktop --app-name=sth-seat -- sth-seat Ready to open: https://example.com/\ndesktop browser.desktop https://example.com/\ndesktop browser.desktop https://example.com/\n"
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux opens the file's folder when no file manager answers on D-Bus", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      const open = yield* script(folder, "xdg-open", `echo "xdg-open $*" >> ${folder}/log`)
      const gdbus = yield* script(folder, "gdbus", "echo 'The name is not activatable' >&2; exit 1")
      yield* Desktop.use((desktop) => desktop.revealFile("/inbox/id/app.dmg")).pipe(
        Effect.provide(onLinux(folder, open, gdbus))
      )
      const log = yield* logged(folder)

      assert.strictEqual(log, "xdg-open /inbox/id\n")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on macOS asks through the secret prompt program, showing where the secret goes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const prompt = yield* script(
        folder,
        "herdr-secret",
        `echo "$HERDR_SECRET_WAIT $*" >> ${folder}/log; printf s3cret`
      )
      const osascript = yield* script(folder, "osascript", `echo "osascript $*" >> ${folder}/log; echo dialog`)
      const answer = yield* askOnMac(prompt, osascript, toTower)
      const log = yield* logged(folder)

      assert.strictEqual(Redacted.value(answer), "s3cret")
      assert.strictEqual(
        log,
        "160 --stdout --machine Tower --file ~/.local/share/sth-seat/secrets/plex-token -- plex-token Plex token?\n"
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on macOS falls back to a hidden dialog naming the machine and file when the prompt program can't ask", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const unavailable = yield* script(folder, "herdr-secret", "exit 3")
      const osascript = yield* script(folder, "osascript", `echo "$*" >> ${folder}/log; echo s3cret`)
      const fromDialog = yield* askOnMac(unavailable, osascript, toTower)
      const whenMissing = yield* askOnMac(`${folder}/missing`, osascript, toTower)
      const log = yield* logged(folder)

      assert.deepStrictEqual([Redacted.value(fromDialog), Redacted.value(whenMissing)], ["s3cret", "s3cret"])
      assert.include(log, "with hidden answer")
      assert.include(
        log,
        "Plex token?\n\nGoes to: Tower\nFile: ~/.local/share/sth-seat/secrets/plex-token sth-seat: plex-token\n"
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on macOS uses the hidden dialog when an older hub doesn't say where the secret goes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const prompt = yield* script(folder, "herdr-secret", `echo prompt >> ${folder}/log; printf wrong`)
      const osascript = yield* script(folder, "osascript", `echo "$*" >> ${folder}/log; echo s3cret`)
      const answer = yield* askOnMac(prompt, osascript, Option.none())
      const log = yield* logged(folder)

      assert.strictEqual(Redacted.value(answer), "s3cret")
      assert.notInclude(log, "prompt")
      assert.include(log, "Plex token? sth-seat: plex-token\n")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on macOS doesn't ask twice when the user cancels the prompt program", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const cancelled = yield* script(folder, "herdr-secret", "exit 1")
      const osascript = yield* script(folder, "osascript", `echo asked >> ${folder}/log; echo s3cret`)
      const error = yield* Effect.flip(askOnMac(cancelled, osascript, toTower))
      const asked = yield* fs.exists(`${folder}/log`)

      assert.strictEqual(error.ending, 1)
      assert.isFalse(asked)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux asks with a hidden zenity entry that names the machine and file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      const zenity = yield* script(folder, "zenity", `echo "$*" >> ${folder}/log; printf 'line-secret'`)
      const answer = yield* Desktop.use((desktop) => desktop.askSecret(name, "Plex token?", toTower)).pipe(
        Effect.provide(
          Desktop.linux({
            open: zenity,
            notifySend: zenity,
            zenity,
            gdbus: zenity,
            hyprctl: `${folder}/missing`,
            shell: "/bin/sh",
            wlCopy: "/bin/true",
            xdgMime: `${folder}/xdg-mime`,
            launcher: zenity,
            openerWindow: Duration.millis(300)
          }).pipe(Layer.provide(sessionIn(folder)))
        )
      )
      const log = yield* logged(folder)

      assert.strictEqual(Redacted.value(answer), "line-secret")
      assert.strictEqual(
        log,
        "--entry --hide-text --title=sth-seat: plex-token --text=Plex token?\n\nGoes to: Tower\nFile: ~/.local/share/sth-seat/secrets/plex-token\n"
      )
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux leaves a browser that keeps running open, and reports an opener that fails at once", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      const lingering = yield* script(
        folder,
        "lingering-open",
        `echo chatter; echo noise >&2; sleep 1; echo still > ${folder}/survived`
      )
      const broken = yield* script(folder, "broken-open", "echo no method >&2; exit 3")
      yield* browserEntry(folder)
      const layerWith = (open: string) =>
        Desktop.linux({
          open,
          notifySend: open,
          zenity: open,
          gdbus: open,
          hyprctl: `${folder}/missing`,
          shell: "/bin/sh",
          wlCopy: "/bin/true",
          xdgMime: `${folder}/xdg-mime`,
          launcher: open,
          openerWindow: Duration.millis(300)
        }).pipe(Layer.provide(sessionIn(folder)))
      yield* Desktop.use((desktop) => desktop.openUrl(url)).pipe(Effect.provide(layerWith(lingering)))
      const failed = yield* Effect.flip(
        Desktop.use((desktop) => desktop.openUrl(url)).pipe(Effect.provide(layerWith(broken)))
      )
      yield* Effect.sleep("1500 millis")
      const survived = yield* fs.exists(`${folder}/survived`)

      assert.include(failed.message, "broken-open browser.desktop https://example.com/ failed: exit code 3: no method")
      assert.isTrue(survived)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("refuses a link it can't read as http or https on both platforms, launching nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      yield* browserEntry(folder)
      const open = yield* script(folder, "open", `echo "open $*" >> ${folder}/log`)
      const broken = WebUrl.make("http://[")
      const mac = Desktop.darwin({
        open,
        handoff: open,
        osascript: open,
        secretPrompt: open,
        pbcopy: open,
        plutil: open,
        launchServices: open
      })
      const refusals = yield* Effect.forEach([mac, onLinux(folder, open, open)], (platform) =>
        Effect.flip(Desktop.use((desktop) => desktop.openUrl(broken)).pipe(Effect.provide(platform)))
      )
      const launched = yield* fs.exists(`${folder}/log`)

      assert.deepStrictEqual(
        refusals.map((error) => error.message),
        ["open failed: http://[ isn't a URL it can read.", "open failed: http://[ isn't a URL it can read."]
      )
      assert.isFalse(launched)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on Linux says how to set a default browser when there is none, instead of falling back to xdg-open", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      yield* fs.writeFileString(`${folder}/wayland-1`, "")
      yield* script(folder, "xdg-mime", "echo")
      const open = yield* script(folder, "xdg-open", `echo "xdg-open $*" >> ${folder}/log`)
      const failed = yield* Effect.flip(
        Desktop.use((desktop) => desktop.openUrl(url)).pipe(Effect.provide(onLinux(folder, open, open)))
      )
      const launched = yield* fs.exists(`${folder}/log`)

      assert.include(failed.message, "no default browser is set")
      assert.isFalse(launched)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.live("on macOS opens URLs in Safari when Launch Services names no browser", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const folder = yield* fs.makeTempDirectoryScoped()
      const open = yield* script(folder, "open", `echo "open $*" >> ${folder}/log`)
      const missing = `${folder}/missing`
      yield* Desktop.use((desktop) => desktop.openUrl(url)).pipe(
        Effect.provide(
          Desktop.darwin({
            open,
            handoff: missing,
            osascript: missing,
            secretPrompt: missing,
            pbcopy: missing,
            plutil: missing,
            launchServices: missing
          })
        )
      )
      const log = yield* logged(folder)

      assert.strictEqual(log, "open -b com.apple.Safari https://example.com/\n")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )
})
