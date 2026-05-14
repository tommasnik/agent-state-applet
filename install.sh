#!/usr/bin/env bash
set -euo pipefail

APPLET_UUID="claude-agent-state@daktela"
APPLET_DEST="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="claude-state-server.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/server/claude_state_server.py"

echo "=== Claude Agent State Applet installer ==="
echo ""

# Applet
mkdir -p "$APPLET_DEST"
cp "$SCRIPT_DIR/applet/applet.js"    "$APPLET_DEST/"
cp "$SCRIPT_DIR/applet/metadata.json" "$APPLET_DEST/"
echo "[1/3] Applet installed to $APPLET_DEST"

# Server script
chmod +x "$SERVER_SCRIPT"

# Systemd service
mkdir -p "$SERVICE_DIR"
sed "s|__SERVER_PATH__|$SERVER_SCRIPT|g" \
    "$SCRIPT_DIR/server/claude-state-server.service.template" \
    > "$SERVICE_DIR/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"
echo "[2/3] Service enabled and started ($(systemctl --user is-active $SERVICE_NAME))"

# Restart Cinnamon to pick up the new applet
if pgrep -x cinnamon &>/dev/null; then
    DISPLAY="${DISPLAY:-:0}" cinnamon --replace &>/dev/null &
    disown
    echo "[3/3] Cinnamon restarted to load applet"
else
    echo "[3/3] Cinnamon not running — start it and add the applet manually"
fi

echo ""
echo "Next steps:"
echo "  • Right-click the panel → Add applets → search 'Claude Agent State' → Add"
echo "  • Hook API endpoint:  POST http://127.0.0.1:7855/agent"
echo "  • State file:         /tmp/claude-agents.json"
echo "  • Service logs:       journalctl --user -u $SERVICE_NAME -f"
echo ""
echo "Hook payload (Content-Type: application/json):"
cat <<'JSON'
{
  "pid":           1234,
  "cwd":           "/home/tom/myproject",
  "state":         "busy",
  "hook_event":    "PreToolUse",
  "tool_name":     "Bash",
  "session_id":    "abc123",
  "subagent_count": 0
}
JSON
echo ""
echo "Valid states: idle | busy | waiting_for_approval | session_end"
