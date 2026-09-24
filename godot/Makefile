FLATPAK ?= flatpak
GODOT_APP_ID ?= org.godotengine.Godot
GODOT = $(FLATPAK) run $(GODOT_APP_ID)

.PHONY: open run test smoke export-linux

open:
	$(GODOT) --editor --path "$(CURDIR)"

run:
	$(GODOT) --path "$(CURDIR)"

test:
	$(GODOT) --headless --path "$(CURDIR)" --script res://tests/test_game_state.gd
	$(GODOT) --headless --path "$(CURDIR)" --script res://tests/test_flight_math.gd
	$(GODOT) --headless --path "$(CURDIR)" --script res://tests/test_web_random.gd

smoke:
	$(GODOT) --headless --path "$(CURDIR)" -- --smoke-test

export-linux:
	mkdir -p "$(CURDIR)/../build"
	$(GODOT) --headless --path "$(CURDIR)" --export-release Linux
	mkdir -p "$(CURDIR)/../build/licenses"
	cp "$(CURDIR)/assets/fonts/barlow_condensed/OFL.txt" "$(CURDIR)/../build/licenses/BarlowCondensed-OFL.txt"
	cp "$(CURDIR)/assets/fonts/ibm_plex_mono/OFL.txt" "$(CURDIR)/../build/licenses/IBMPlexMono-OFL.txt"
