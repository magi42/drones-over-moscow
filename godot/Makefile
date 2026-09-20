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

smoke:
	$(GODOT) --headless --path "$(CURDIR)" -- --smoke-test

export-linux:
	$(GODOT) --headless --path "$(CURDIR)" --export-release Linux
