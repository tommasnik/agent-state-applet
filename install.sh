#!/usr/bin/env bash
set -euo pipefail

APPLET_UUID="claude-agent-state@tommasnik"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/server/claude_state_server.py"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="claude-state-server.service"

# ---------------------------------------------------------------------------
# Desktop detection
# ---------------------------------------------------------------------------
detect_de() {
    local de="${XDG_CURRENT_DESKTOP:-}"
    local session="${DESKTOP_SESSION:-}"
    local combined="${de} ${session}"
    if echo "$combined" | grep -qi cinnamon; then
        echo "cinnamon"
    elif echo "$combined" | grep -qi gnome; then
        echo "gnome"
    else
        echo "unknown"
    fi
}

# Allow explicit override: ./install.sh cinnamon  or  ./install.sh gnome
DE="${1:-$(detect_de)}"

case "$DE" in
    cinnamon|gnome) ;;
    unknown)
        echo "ERROR: Could not detect desktop environment."
        echo "       Pass 'cinnamon' or 'gnome' as the first argument."
        echo "       Example: bash install.sh gnome"
        exit 1
        ;;
    *)
        echo "ERROR: Unknown argument '$DE'. Use 'cinnamon' or 'gnome'."
        exit 1
        ;;
esac

echo "=== Claude Agent State installer (DE: $DE) ==="
echo ""

# ---------------------------------------------------------------------------
# [1/3] Server (common to both DEs)
# ---------------------------------------------------------------------------
chmod +x "$SERVER_SCRIPT"
mkdir -p "$SERVICE_DIR"
sed "s|__SERVER_PATH__|$SERVER_SCRIPT|g" \
    "$SCRIPT_DIR/server/claude-state-server.service.template" \
    > "$SERVICE_DIR/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"
echo "[1/3] Service enabled and started ($(systemctl --user is-active $SERVICE_NAME))"

# ---------------------------------------------------------------------------
# [2/3] Panel component
# ---------------------------------------------------------------------------
if [[ "$DE" == "cinnamon" ]]; then
    APPLET_DEST="$HOME/.local/share/cinnamon/applets/$APPLET_UUID"
    mkdir -p "$APPLET_DEST"
    cp "$SCRIPT_DIR/applet/applet.js"     "$APPLET_DEST/"
    cp "$SCRIPT_DIR/applet/metadata.json" "$APPLET_DEST/"
    echo "[2/3] Cinnamon applet installed to $APPLET_DEST"
else
    EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$APPLET_UUID"
    mkdir -p "$EXT_DEST"
    cp "$SCRIPT_DIR/gnome-extension/extension.js"  "$EXT_DEST/"
    cp "$SCRIPT_DIR/gnome-extension/metadata.json" "$EXT_DEST/"
    cp "$SCRIPT_DIR/shared/render-logic.mjs"       "$EXT_DEST/"
    echo "[2/3] GNOME extension installed to $EXT_DEST"
fi

# ---------------------------------------------------------------------------
# [3/3] Activate / reload panel component
# ---------------------------------------------------------------------------
if [[ "$DE" == "cinnamon" ]]; then
    if pgrep -x cinnamon &>/dev/null; then
        DISPLAY="${DISPLAY:-:0}" cinnamon --replace &>/dev/null &
        disown
        echo "[3/3] Cinnamon restarted — add the applet via right-click → Add applets"
    else
        echo "[3/3] Cinnamon not running — start it and add the applet manually"
    fi
else
    # Enable extension (gnome-extensions CLI available since GNOME 3.34)
    if command -v gnome-extensions &>/dev/null; then
        gnome-extensions enable "$APPLET_UUID" 2>/dev/null || true
        echo "[3/3] GNOME extension enabled"
    else
        # Fallback: edit gsettings directly
        CURRENT=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
        if ! echo "$CURRENT" | grep -q "$APPLET_UUID"; then
            NEW=$(echo "$CURRENT" | sed "s/\]$/, '$APPLET_UUID']/")
            gsettings set org.gnome.shell enabled-extensions "$NEW"
        fi
        echo "[3/3] GNOME extension enabled via gsettings"
    fi
    echo "      NOTE: On Wayland you may need to log out and back in for the extension to appear."
    echo "      On X11 you can press Alt+F2, type 'r', Enter to restart the shell without logging out."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Hook API:   POST http://127.0.0.1:7855/agent"
echo "State file: /tmp/claude-agents.json"
echo "Logs:       journalctl --user -u $SERVICE_NAME -f"
echo ""
if [[ "$DE" == "gnome" ]]; then
    echo "To reload the extension during development:"
    echo "  make gnome"
fi
