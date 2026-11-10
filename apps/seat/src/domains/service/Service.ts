import { Option } from "effect"

export const launchdLabel = "sth-seat.daemon"

export const systemdUnit = (executable: string): string => `[Unit]
Description=sth-seat daemon: tells the hub when this machine is in use, opens what the hub sends, and runs what this machine's policy allows
After=network-online.target

[Service]
ExecStart=${executable} daemon
Restart=always
RestartSec=10
SuccessExitStatus=130 143
KillMode=process

[Install]
WantedBy=default.target
`

const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const launchdPlist = (
  executable: string,
  logFile: string,
  home: string
): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escaped(executable)}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escaped(home)}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escaped(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escaped(logFile)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`

export const isBunRuntime = (executable: string): boolean => /(^|\/)bun(-[a-z0-9]+)?$/.test(executable)

const brewCellar = /^(.+)\/Cellar\/sth-seat\/[^/]+\/bin\/sth-seat$/

export const brewStablePath = (executable: string): Option.Option<string> =>
  Option.map(Option.fromNullishOr(brewCellar.exec(executable)?.[1]), (prefix) => `${prefix}/bin/sth-seat`)
