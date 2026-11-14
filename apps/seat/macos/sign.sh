#!/usr/bin/env bash
set -euo pipefail

: "${RCODESIGN:?path to rcodesign}"
: "${SIGNING_KEY:?path to the release signing key (PEM)}"
: "${SIGNING_CERT:?path to the release signing certificate (PEM)}"

cd "$(dirname "$0")/.."
version=$(sed -n 's/^export const version = "\(.*\)"$/\1/p' src/app/Cli.ts)
release=dist/release
identifier=com.seethruhead.sth-seat

sign() {
  "$RCODESIGN" sign --pem-file "$SIGNING_KEY" --pem-file "$SIGNING_CERT" "$@"
}

bundle() {
  local arch=$1
  local staging="$release/app-$arch"
  local app="$staging/sth-seat.app"
  rm -rf "$staging"
  mkdir -p "$app/Contents/MacOS"
  cp "$release/sth-seat-darwin-$arch" "$app/Contents/MacOS/sth-seat"
  sed "s/VERSION/$version/g" macos/Info.plist > "$app/Contents/Info.plist"
  sign "$app"
  tar -C "$staging" -czf "$release/sth-seat-darwin-$arch.app.tar.gz" sth-seat.app
  rm -rf "$staging"
}

for arch in arm64 x64; do
  sign --binary-identifier "$identifier" "$release/sth-seat-darwin-$arch"
  bundle "$arch"
done
