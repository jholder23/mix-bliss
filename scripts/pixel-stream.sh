#!/usr/bin/env bash
# Pixel-stream Impasto on 127.0.0.1:43171 (HTTP) + :8888 (streamer WS).
# Optional desktop/Linux helper only. Cloud VMs with no UE editor / no GPU
# cannot run this. Do not substitute a WebGL preview.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTTP_PORT="${IMPASTO_HTTP_PORT:-43171}"
STREAM_PORT="${IMPASTO_STREAM_PORT:-8888}"
BIND="${IMPASTO_BIND:-127.0.0.1}"
INFRA_DIR="${PIXEL_STREAMING_INFRA:-$ROOT/.ps-infra}"

find_editor() {
  if [[ -n "${UE_EDITOR:-}" && -x "$UE_EDITOR" ]]; then
    printf '%s\n' "$UE_EDITOR"
    return 0
  fi
  if [[ -n "${UE_ROOT:-}" && -x "$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" ]]; then
    printf '%s\n' "$UE_ROOT/Engine/Binaries/Linux/UnrealEditor"
    return 0
  fi
  local c
  for c in \
    UnrealEditor \
    /opt/UnrealEngine/Engine/Binaries/Linux/UnrealEditor \
    /opt/Epic/UnrealEngine/Engine/Binaries/Linux/UnrealEditor \
    "$HOME/UnrealEngine/Engine/Binaries/Linux/UnrealEditor" \
    "$HOME/UE_5.8/Engine/Binaries/Linux/UnrealEditor" \
    /usr/local/UnrealEngine/Engine/Binaries/Linux/UnrealEditor
  do
    if command -v "$c" >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
    if [[ -x "$c" ]]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

echo "== Impasto Pixel Streaming =="
echo "HTTP  http://${BIND}:${HTTP_PORT}"
echo "WS    ws://${BIND}:${STREAM_PORT}"

if ! EDITOR="$(find_editor)"; then
  cat <<EOF

BLOCKED — Unreal Engine 5.8 is not on this machine.

Cannot Pixel Stream without:
  1. UE 5.8 editor (Epic Games Launcher, or GitHub EpicGames/UnrealEngine after linking
     https://www.unrealengine.com/ue4-on-github)
  2. A GPU with Vulkan (this cloud VM has none: no nvidia-smi, empty /dev/dri)
  3. Optional: EPIC_GITHUB_TOKEN if an agent should download Linux binaries

Refusing to start a WebGL / Vite stand-in.

EOF
  exit 2
fi

echo "Editor: $EDITOR"

if [[ ! -d "$INFRA_DIR/.git" ]]; then
  echo "Cloning PixelStreamingInfrastructure (UE5.8)..."
  git clone --depth 1 --branch UE5.8 https://github.com/EpicGamesExt/PixelStreamingInfrastructure.git "$INFRA_DIR"
fi

START="$INFRA_DIR/SignallingWebServer/platform_scripts/bash/start.sh"
if [[ ! -x "$START" ]]; then
  echo "Missing signalling start script at $START" >&2
  exit 1
fi

echo "Starting signalling on ${BIND}:${HTTP_PORT}..."
# --publicIp keeps the player talking to loopback when we bind 127.0.0.1
"$START" --httpPort "$HTTP_PORT" --streamerPort "$STREAM_PORT" --bind "$BIND" --publicIp "$BIND" &
SIG_PID=$!
trap 'kill "$SIG_PID" 2>/dev/null || true' EXIT
sleep 2

echo "Launching Impasto (-game) as a Pixel Streaming peer..."
"$EDITOR" "$ROOT/Impasto.uproject" /Engine/Maps/Templates/Template_Default -game \
  -PixelStreamingURL="ws://${BIND}:${STREAM_PORT}" \
  -PixelStreamingIP="$BIND" \
  -ForceRes -ResX=1280 -ResY=720 \
  -AllowPixelStreamingCommands \
  -log
