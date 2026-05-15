APPLET_UUID  := claude-agent-state@daktela
APPLET_DEST  := $(HOME)/.local/share/cinnamon/applets/$(APPLET_UUID)

.PHONY: reload applet server test install

# Reload everything needed for active development
reload: applet server

applet:
	cp applet/applet.js    $(APPLET_DEST)/
	cp applet/metadata.json $(APPLET_DEST)/
	DISPLAY=$${DISPLAY:-:0} dbus-send --session \
	  --dest=org.Cinnamon --type=method_call /org/Cinnamon \
	  org.Cinnamon.ReloadXlet \
	  string:"$(APPLET_UUID)" string:"APPLET"
	@echo "applet reloaded"

server:
	systemctl --user restart claude-state-server
	@echo "server restarted (status: $$(systemctl --user is-active claude-state-server))"

test:
	python3 -m pytest server/tests/ -v

# Full first-time install (registers systemd service, restarts Cinnamon)
install:
	bash install.sh
