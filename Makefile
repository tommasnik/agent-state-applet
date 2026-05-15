APPLET_UUID   := claude-agent-state@daktela
APPLET_DEST   := $(HOME)/.local/share/cinnamon/applets/$(APPLET_UUID)
GNOME_EXT_DEST := $(HOME)/.local/share/gnome-shell/extensions/$(APPLET_UUID)

.PHONY: reload applet gnome server test install install-gnome

# Cinnamon dev reload
reload: applet server

applet:
	cp applet/applet.js     $(APPLET_DEST)/
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
	gnome-extensions disable "$(APPLET_UUID)" 2>/dev/null || true
	sleep 0.3
	gnome-extensions enable  "$(APPLET_UUID)"
	@echo "GNOME extension reloaded"

server:
	systemctl --user restart claude-state-server
	@echo "server restarted (status: $$(systemctl --user is-active claude-state-server))"

test:
	python3 -m pytest server/tests/ -v

# First-time install — auto-detects DE, or pass target explicitly
install:
	bash install.sh

install-gnome:
	bash install.sh gnome

install-cinnamon:
	bash install.sh cinnamon
