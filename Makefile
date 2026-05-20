APPLET_UUID    := claude-agent-state@tommasnik
APPLET_DEST    := $(HOME)/.local/share/cinnamon/applets/$(APPLET_UUID)
GNOME_EXT_DEST := $(HOME)/.local/share/gnome-shell/extensions/$(APPLET_UUID)

.PHONY: reload applet gnome server server-restart server-logs test test-server test-render test-ui \
        install install-gnome install-cinnamon smoke logs-check check

# Cinnamon dev reload
reload: applet server

# Generate the Cinnamon-compatible version of shared/core.mjs by stripping
# `export` keywords (Cinnamon's GJS has no ESM module resolver). The result
# is loaded via `imports.ui.appletManager.applets[UUID].core` at runtime.
applet/core.js: shared/core.mjs
	sed -E 's/^export (function|class|const|let|var) /\1 /; s/^export default //' $< > $@

applet: applet/core.js
	mkdir -p "$(APPLET_DEST)"
	cp applet/applet.js     $(APPLET_DEST)/
	cp applet/core.js       $(APPLET_DEST)/
	cp applet/metadata.json $(APPLET_DEST)/
	DISPLAY=$${DISPLAY:-:0} gdbus call --session \
	  --dest org.Cinnamon --object-path /org/Cinnamon \
	  --method org.Cinnamon.ReloadXlet \
	  "$(APPLET_UUID)" "APPLET"
	@echo "applet reloaded"

# GNOME dev reload (disable+enable cycles the extension without shell restart)
gnome:
	mkdir -p "$(GNOME_EXT_DEST)"
	cp gnome-extension/extension.js  "$(GNOME_EXT_DEST)/"
	cp gnome-extension/metadata.json "$(GNOME_EXT_DEST)/"
	cp shared/core.mjs               "$(GNOME_EXT_DEST)/"
	gnome-extensions disable "$(APPLET_UUID)" 2>/dev/null || true
	sleep 0.3
	gnome-extensions enable  "$(APPLET_UUID)"
	@echo "GNOME extension reloaded"

server: server-restart

server-restart:
	systemctl --user restart claude-state-server
	@echo "server restarted (status: $$(systemctl --user is-active claude-state-server))"

server-logs:
	journalctl --user -u claude-state-server -f

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
test: test-server test-render test-ui

test-server:
	cd server && npm test

test-render:
	node --test test/render.test.mjs

test-ui:
	node --test test/ui.test.mjs

# ---------------------------------------------------------------------------
# Smoke / log checks — quick agent-runnable sanity checks against a live env.
# ---------------------------------------------------------------------------
SMOKE_PID := 99001
smoke:
	@echo "→ posting fake agent (pid=$(SMOKE_PID))…"
	@curl -fsS -X POST http://127.0.0.1:7855/agent \
	  -H 'Content-Type: application/json' \
	  -d '{"pid":$(SMOKE_PID),"cwd":"/tmp/smoke","project_root":"/tmp/smoke","state":"working","started_at":1,"hook_event":"PreToolUse"}' >/dev/null
	@sleep 0.3
	@curl -fsS -X POST http://127.0.0.1:7855/agent \
	  -H 'Content-Type: application/json' \
	  -d '{"pid":$(SMOKE_PID),"state":"done","hook_event":"Stop"}' >/dev/null
	@sleep 0.3
	@curl -fsS http://127.0.0.1:7855/status | grep -q '"$(SMOKE_PID)"' \
	  && echo "✓ smoke OK (pid $(SMOKE_PID) present in /status)" \
	  || (echo "✗ smoke FAILED (pid $(SMOKE_PID) not in /status)"; exit 1)
	@# Cleanup: PID won't be alive, pid_checker reaps it within ~5s. Leave it.

# Grep recent shell logs for our UUID + errors. Exit 1 on any hit so an AI
# agent gets a hard signal that the loader didn't come up cleanly.
logs-check:
	@since="$${SINCE:-5 min ago}"; \
	hits=$$(journalctl --user --since "$$since" 2>/dev/null \
	  | grep -i "$(APPLET_UUID)" \
	  | grep -iE "error|exception|traceback|stack" || true); \
	xs=$$(grep -i "$(APPLET_UUID)" $$HOME/.xsession-errors 2>/dev/null \
	  | grep -iE "error|exception|traceback|stack" || true); \
	if [ -n "$$hits$$xs" ]; then \
	  echo "✗ found errors for $(APPLET_UUID):"; \
	  printf '%s\n' "$$hits" "$$xs"; \
	  exit 1; \
	else \
	  echo "✓ no recent errors for $(APPLET_UUID)"; \
	fi

# Composite: applet build + JS syntax check + tests
check: applet/core.js
	@node --check applet/core.js && echo "✓ applet/core.js syntax OK"
	@node --check applet/applet.js && echo "✓ applet/applet.js syntax OK" || true
	@node --check gnome-extension/extension.js 2>/dev/null && echo "✓ extension.js syntax OK" || \
	  echo "(extension.js uses ESM import — skip node --check)"
	@$(MAKE) test-render test-ui

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
install:
	bash install.sh

install-gnome:
	bash install.sh gnome

install-cinnamon: applet/core.js
	bash install.sh cinnamon
