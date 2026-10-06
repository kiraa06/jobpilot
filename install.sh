#!/usr/bin/env bash
# Installs the JobPilot native-messaging helper for Arc (and Chrome, if installed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
JP_HOME="${JOBPILOT_HOME:-$HOME/.jobpilot}"
HOST_NAME="com.kiraa06.jobpilot"

PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo "✗ python3 not found on PATH"; exit 1; }
CLAUDE="$(command -v claude || true)"
[ -n "$CLAUDE" ] || { echo "✗ claude CLI not found on PATH — install Claude Code first"; exit 1; }
EXT_ID="$("$PY" "$ROOT/scripts/extension_id.py" "$ROOT/extension/manifest.json")"

mkdir -p "$JP_HOME/imports"
"$PY" - "$JP_HOME/config.json" "$CLAUDE" <<'EOF'
import json, sys
json.dump({"claudeBin": sys.argv[2]}, open(sys.argv[1], "w"), indent=2)
EOF

# Browsers launch hosts with a minimal PATH, so pin absolute paths in a wrapper.
cat > "$JP_HOME/jobpilot-host" <<EOF
#!/bin/sh
exec "$PY" "$ROOT/host/jobpilot_host.py" "\$@"
EOF
chmod +x "$JP_HOME/jobpilot-host"

installed=0
for dir in \
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"; do
  if [ -d "$(dirname "$dir")" ]; then
    mkdir -p "$dir"
    "$PY" - "$dir/$HOST_NAME.json" "$HOST_NAME" "$JP_HOME/jobpilot-host" "$EXT_ID" <<'EOF'
import json, sys
path, name, exe, ext = sys.argv[1:]
json.dump({"name": name, "description": "JobPilot helper", "path": exe, "type": "stdio",
           "allowed_origins": [f"chrome-extension://{ext}/"]}, open(path, "w"), indent=2)
EOF
    echo "✓ Host manifest → $dir"
    installed=1
  fi
done
[ "$installed" = 1 ] || { echo "✗ Neither Arc nor Chrome profile directory found"; exit 1; }

echo "✓ Helper:       $JP_HOME/jobpilot-host"
echo "✓ claude:       $CLAUDE"
echo "✓ Extension ID: $EXT_ID"
echo "Next: arc://extensions → Developer mode → Load unpacked → $ROOT/extension"
