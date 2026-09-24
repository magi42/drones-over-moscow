extends Node

const RouteMapControl = preload("res://scripts/route_map.gd")
const DroneBlueprintControl = preload("res://scripts/drone_blueprint.gd")
const OperatorRoomControl = preload("res://scripts/operator_room.gd")
const BootTerminalControl = preload("res://scripts/boot_terminal.gd")
const ACID := Color("#b7f238")
const CYAN := Color("#72e5d2")
const INK := Color("#090b0d")
const PANEL := Color("#101815")
const MUTED := Color("#829087")

var game_state := GameState.new()
var screen: Control
var flight_world: FlightWorld
var ui_layer: CanvasLayer
var hud: Dictionary = {}
var pause_overlay: Control
var settings_overlay: Control
var binding_target := ""
var binding_buttons: Dictionary = {}
var music: AudioStreamPlayer
var phase := "boot"
var smoke_test_mode := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var user_args := OS.get_cmdline_user_args()
	smoke_test_mode = "--smoke-test" in user_args
	if not smoke_test_mode:
		_load_preferences()
		_start_music()
	_show_boot()
	if "--boot-preview" in user_args:
		return
	if "--operator-preview" in user_args:
		_show_operator()
		return
	if "--country-preview" in user_args:
		_show_country_select()
		return
	if "--briefing-preview" in user_args:
		_show_briefing()
		return
	if "--flight-preview" in user_args:
		_start_run()
		return
	if smoke_test_mode:
		if screen.get_node_or_null("BootTerminal") == null:
			printerr("SMOKE_TEST_FAILED: boot terminal did not load")
			get_tree().quit(1)
			return
		_show_operator()
		_show_settings()
		if not is_instance_valid(settings_overlay):
			printerr("SMOKE_TEST_FAILED: settings did not open")
			get_tree().quit(1)
			return
		_close_settings()
		await get_tree().process_frame
		_show_country_select()
		await get_tree().process_frame
		_show_briefing()
		await get_tree().process_frame
		_start_run()
		await get_tree().process_frame
		await get_tree().process_frame
		await get_tree().process_frame
		if not is_instance_valid(flight_world):
			printerr("SMOKE_TEST_FAILED: flight world did not start")
			get_tree().quit(1)
			return
		var oil_tanks := 0
		var air_defenses := 0
		for target in flight_world.targets:
			if target.kind == "oil_tank":
				oil_tanks += 1
			elif target.kind == "air_defense":
				air_defenses += 1
		if flight_world.buildings.size() != 52 or oil_tanks != 12 or air_defenses != 12:
			printerr("SMOKE_TEST_FAILED: city layout counts do not match the web version")
			get_tree().quit(1)
			return
		var first_tank: Dictionary = flight_world.targets[0]
		var tank_mesh := first_tank.body.mesh as CylinderMesh
		var first_station: Dictionary = flight_world.targets[oil_tanks]
		if (
			not is_equal_approx(float(first_tank.node.position.y), 1.5)
			or not is_equal_approx(tank_mesh.top_radius, 4.3)
			or not is_equal_approx(tank_mesh.height, 6.2)
			or first_station.node.get_node_or_null("LauncherTubes") == null
		):
			printerr("SMOKE_TEST_FAILED: target models do not match the migrated dimensions")
			get_tree().quit(1)
			return
		if not is_instance_valid(flight_world.storm_rain) or flight_world.storm_rain.multimesh.instance_count != 150:
			printerr("SMOKE_TEST_FAILED: full-route storm field was not created")
			get_tree().quit(1)
			return
		if flight_world.cross_roads.is_empty() or flight_world.cross_roads[0].get_child_count() != 21:
			printerr("SMOKE_TEST_FAILED: marked cross streets were not created")
			get_tree().quit(1)
			return
		if flight_world.rooftop_people.is_empty():
			printerr("SMOKE_TEST_FAILED: rooftop civilians were not created")
			get_tree().quit(1)
			return
		var first_person: Dictionary = flight_world.rooftop_people[0]
		first_person.jump_delay = 0.0
		flight_world.rooftop_people[0] = first_person
		var original_fleet_z: float = flight_world.formation.position.z
		var person_building: Dictionary = flight_world.buildings[int(first_person.building_index)]
		var jump_row := int(person_building.row) - int(first_person.jump_ahead)
		flight_world.formation.position.z = FlightWorld.CITY_FIRST_ROW_Z - float(jump_row) * FlightWorld.CITY_ROW_SPACING
		flight_world._update_rooftop_people(1.0 / 60.0)
		flight_world.formation.position.z = original_fleet_z
		if flight_world.rooftop_people[0].phase != "jumping":
			printerr("SMOKE_TEST_FAILED: rooftop jump did not begin in its row window")
			get_tree().quit(1)
			return
		var previous_reduced_effects := game_state.reduced_effects
		game_state.reduced_effects = true
		var untouched_tank := 6
		flight_world._destroy_target(untouched_tank, false)
		var tank: Dictionary = flight_world.targets[untouched_tank]
		if not tank.node.visible or not tank.body.visible or tank.destroyable_visuals[0].visible or flight_world.pollution_clouds.is_empty():
			printerr("SMOKE_TEST_FAILED: destroyed tank aftermath is incomplete")
			get_tree().quit(1)
			return
		var cloud: Dictionary = flight_world.pollution_clouds[0]
		if cloud.rain.multimesh.instance_count != 28:
			printerr("SMOKE_TEST_FAILED: reduced-effects pollution rain is missing")
			get_tree().quit(1)
			return
		flight_world._update_pollution(2.0)
		cloud = flight_world.pollution_clouds[0]
		if (
			not is_equal_approx(float(cloud.node.scale.x), 0.575)
			or not is_equal_approx(float(cloud.node.position.x), 0.76)
			or not is_equal_approx(float(cloud.node.position.y), 23.0)
		):
			printerr("SMOKE_TEST_FAILED: pollution cloud growth and drift are incomplete")
			get_tree().quit(1)
			return
		var collapse_index := -1
		for building_index in range(flight_world.buildings.size()):
			if not bool(flight_world.buildings[building_index].protected):
				collapse_index = building_index
				break
		if collapse_index < 0:
			printerr("SMOKE_TEST_FAILED: no building is available for collapse testing")
			get_tree().quit(1)
			return
		var original_building: Dictionary = flight_world.buildings[collapse_index]
		var original_height: float = float(original_building.size.y)
		var original_y: float = float(original_building.node.position.y)
		flight_world._damage_building(collapse_index)
		flight_world._update_building_damage(FlightWorld.BUILDING_COLLAPSE_SECONDS * 0.5)
		var collapsed_building: Dictionary = flight_world.buildings[collapse_index]
		var collapsed_shape := (collapsed_building.collision.get_child(0) as CollisionShape3D).shape as BoxShape3D
		var exposed_top: Vector3 = Vector3(collapsed_building.collision.position) + Vector3.UP * (collapsed_shape.size.y * 0.5 - 0.1)
		if (
			not is_equal_approx(float(collapsed_building.node.position.y), original_y - original_height / 3.0)
			or not is_equal_approx(collapsed_shape.size.y, original_height * (2.0 / 3.0))
			or collapsed_building.collision.collision_layer == 0
			or flight_world._find_building_hit(exposed_top, -1, 0.0) != collapse_index
		):
			printerr("SMOKE_TEST_FAILED: damaged building did not leave a collidable collapsing ruin")
			get_tree().quit(1)
			return
		for target_index in range(5):
			flight_world._launch_attack(target_index)
		for _frame in range(240):
			flight_world._physics_process(1.0 / 60.0)
		game_state.reduced_effects = previous_reduced_effects
		if not flight_world.pending_targets.is_empty():
			printerr("SMOKE_TEST_FAILED: queued attack did not dispatch")
			get_tree().quit(1)
			return
		var lid_impact_buildings: Array[int] = []
		for building_index in range(flight_world.buildings.size()):
			if not bool(flight_world.buildings[building_index].damaged):
				lid_impact_buildings.append(building_index)
				if lid_impact_buildings.size() == 2:
					break
		var test_lid := RigidBody3D.new()
		flight_world.add_child(test_lid)
		for building_index in lid_impact_buildings:
			flight_world._on_lid_body_entered(flight_world.buildings[building_index].collision, test_lid)
		if (
			lid_impact_buildings.size() != 2
			or not bool(flight_world.buildings[lid_impact_buildings[0]].damaged)
			or not bool(flight_world.buildings[lid_impact_buildings[1]].damaged)
			or Dictionary(test_lid.get_meta("building_impacts", {})).size() != 2
		):
			printerr("SMOKE_TEST_FAILED: a flying tank lid could not damage multiple buildings")
			get_tree().quit(1)
			return
		test_lid.queue_free()
		flight_world._finish_run(true)
		if phase != "results":
			printerr("SMOKE_TEST_FAILED: results screen did not open")
			get_tree().quit(1)
			return
		_clear_screen()
		if is_instance_valid(music):
			music.stop()
			music.stream = null
			music.queue_free()
		await get_tree().process_frame
		print("SMOKE_TEST_OK")
		get_tree().quit()
		return
	await get_tree().create_timer(1.8).timeout
	if phase == "boot":
		_show_operator()


func _unhandled_input(event: InputEvent) -> void:
	if binding_target != "" and event is InputEventKey and event.pressed and not event.echo:
		var code := int(event.physical_keycode)
		if code > 0:
			game_state.bindings[binding_target] = code
			binding_buttons[binding_target].text = OS.get_keycode_string(code)
			binding_target = ""
			_save_preferences()
			get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and int(event.physical_keycode) == int(game_state.bindings.pause):
		if is_instance_valid(settings_overlay):
			_close_settings()
			get_viewport().set_input_as_handled()
			return
		if phase == "flight":
			_toggle_pause()
			get_viewport().set_input_as_handled()


func _start_music() -> void:
	var stream = load("res://assets/music/moscow-midnight-circuit.mp3")
	if stream == null:
		return
	music = AudioStreamPlayer.new()
	music.stream = stream
	music.volume_db = -14.0
	music.autoplay = true
	music.finished.connect(music.play)
	add_child(music)
	_apply_volume()
	music.stream_paused = true


func _clear_screen() -> void:
	get_tree().paused = false
	Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	if is_instance_valid(screen):
		screen.queue_free()
	if is_instance_valid(flight_world):
		flight_world.queue_free()
	if is_instance_valid(ui_layer):
		ui_layer.queue_free()
	screen = null
	flight_world = null
	ui_layer = null
	hud.clear()
	pause_overlay = null
	settings_overlay = null
	binding_target = ""
	binding_buttons.clear()


func _show_boot() -> void:
	_clear_screen()
	phase = "boot"
	screen = _base_screen(Color("#090b0d"))
	var terminal := BootTerminalControl.new()
	terminal.name = "BootTerminal"
	terminal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(terminal)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(center)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 54)
	center.add_child(row)
	var reticle_space := Control.new()
	reticle_space.custom_minimum_size = Vector2(230, 230)
	row.add_child(reticle_space)
	var copy := VBoxContainer.new()
	copy.add_theme_constant_override("separation", 8)
	row.add_child(copy)
	copy.add_child(_label("REMOTE AVIATION TERMINAL / 04", 13, MUTED))
	copy.add_child(_label("DRONES\nover MOSCOW", 58, Color("#edf3ee")))
	var progress := ProgressBar.new()
	progress.custom_minimum_size = Vector2(420, 4)
	progress.show_percentage = false
	progress.value = 0
	progress.add_theme_stylebox_override("background", _box(Color("#242b27"), 0))
	progress.add_theme_stylebox_override("fill", _box(ACID, 0))
	copy.add_child(progress)
	copy.add_child(_label("ESTABLISHING ENCRYPTED UPLINK", 12, MUTED))
	var progress_tween := create_tween()
	progress_tween.set_trans(Tween.TRANS_CUBIC)
	progress_tween.set_ease(Tween.EASE_IN_OUT)
	progress_tween.tween_property(progress, "value", 100.0, 1.8)


func _show_operator() -> void:
	_clear_screen()
	phase = "operator"
	if is_instance_valid(music):
		music.stream_paused = false
	screen = _base_screen(Color("#0c100d"))
	var room := OperatorRoomControl.new()
	room.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(room)
	var title := _label("DRONES over MOSCOW", 64, Color("#edf3ee"))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.set_anchors_preset(Control.PRESET_TOP_WIDE)
	title.offset_top = 45
	title.offset_bottom = 125
	screen.add_child(title)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(760, 390)
	card.add_theme_stylebox_override("panel", _box(Color("#0b1711"), 2, Color("#33463a"), 2))
	center.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 54)
	margin.add_theme_constant_override("margin_right", 54)
	margin.add_theme_constant_override("margin_top", 42)
	margin.add_theme_constant_override("margin_bottom", 42)
	card.add_child(margin)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 17)
	margin.add_child(content)
	content.add_child(_label("IDENTITY CONFIRMED", 13, ACID))
	content.add_child(_label("FIRE POINT FP-1 OPERATOR", 46, Color("#e5eee7")))
	var description := _label("Four FP-1 drones await your guidance, with twenty more in reserve. Keep the formation intact, strike priority targets, and reach extraction.", 17, Color("#a6b4aa"))
	description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	description.custom_minimum_size.y = 76
	content.add_child(description)
	var accept := _button("ACCEPT MISSION  →")
	accept.pressed.connect(_show_country_select)
	content.add_child(accept)
	var settings := _button("SETTINGS")
	settings.pressed.connect(_show_settings)
	content.add_child(settings)


func _show_country_select() -> void:
	_clear_screen()
	phase = "country"
	screen = _base_screen(Color("#0c1110"))
	_add_grid(screen)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 74)
	margin.add_theme_constant_override("margin_right", 74)
	margin.add_theme_constant_override("margin_top", 54)
	margin.add_theme_constant_override("margin_bottom", 54)
	screen.add_child(margin)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 18)
	margin.add_child(content)
	content.add_child(_label("PHASE 01 / ORIGIN VECTOR", 13, ACID))
	content.add_child(_label("SELECT LAUNCH CORRIDOR", 50, Color("#e6eee8")))
	var separator := HSeparator.new()
	content.add_child(separator)
	var route_layout := HBoxContainer.new()
	route_layout.size_flags_vertical = Control.SIZE_EXPAND_FILL
	route_layout.add_theme_constant_override("separation", 24)
	content.add_child(route_layout)
	var route_map := RouteMapControl.new()
	route_map.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	route_map.ukraine_selected.connect(_show_briefing)
	route_layout.add_child(route_map)
	var route_list := VBoxContainer.new()
	route_list.custom_minimum_size.x = 390
	route_list.add_theme_constant_override("separation", 8)
	route_layout.add_child(route_list)
	route_list.add_child(_label("AVAILABLE CORRIDORS", 13, ACID))
	var routes := [
		["01  FINLAND", "NORTH WIND", "LOCKED"],
		["02  ESTONIA", "PINE NEEDLE", "LOCKED"],
		["03  LATVIA", "AMBER ROAD", "LOCKED"],
		["04  UKRAINE", "SUNFLOWER", "×1.30"],
	]
	for route in routes:
		var button := _button("%s     / %s                                      %s" % route)
		button.custom_minimum_size.y = 72
		if route[2] == "LOCKED":
			button.disabled = true
		else:
			button.pressed.connect(_show_briefing)
		route_list.add_child(button)
	var note := _label("FICTIONAL ROUTES · STYLIZED GEOGRAPHY", 12, MUTED)
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	route_list.add_child(note)


func _show_briefing() -> void:
	_clear_screen()
	phase = "briefing"
	screen = _base_screen(Color("#0a0e0c"))
	_add_grid(screen)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(940, 560)
	card.add_theme_stylebox_override("panel", _box(Color("#09110d"), 1, Color("#3c4a42"), 2))
	center.add_child(card)
	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 0)
	card.add_child(columns)
	var blueprint := DroneBlueprintControl.new()
	columns.add_child(blueprint)
	var copy_margin := MarginContainer.new()
	copy_margin.custom_minimum_size.x = 480
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		copy_margin.add_theme_constant_override(side, 42)
	columns.add_child(copy_margin)
	var copy := VBoxContainer.new()
	copy.add_theme_constant_override("separation", 13)
	copy_margin.add_child(copy)
	copy.add_child(_label("LAUNCH ORIGIN", 13, ACID))
	copy.add_child(_label("UKRAINE", 54, Color("#e7eee7")))
	var brief := _label("Fire Point FP-1 formation. Summer storm and aggressive tracking make this the hardest, highest-reward route.", 16, Color("#9caaa1"))
	brief.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	brief.custom_minimum_size.y = 92
	copy.add_child(brief)
	copy.add_child(_label("WEATHER                 SUMMER STORM", 14, CYAN))
	copy.add_child(_label("FORMATION               ARROWHEAD", 14, CYAN))
	copy.add_child(_label("DEFENSE LOAD            130%", 14, CYAN))
	copy.add_child(_label("SCORE FACTOR            ×1.30", 14, CYAN))
	copy.add_child(_label("WASD / LEFT STICK  GUIDE · CLICK  ATTACK · ESC  PAUSE", 12, MUTED))
	var launch := _button("LAUNCH FP-1 FORMATION  ↗")
	launch.pressed.connect(_start_run)
	copy.add_child(launch)


func _start_run() -> void:
	_clear_screen()
	phase = "flight"
	Input.set_default_cursor_shape(Input.CURSOR_CROSS)
	if is_instance_valid(music):
		music.stream_paused = false
	game_state.reset_run()
	flight_world = FlightWorld.new()
	add_child(flight_world)
	flight_world.hud_changed.connect(_update_hud)
	flight_world.run_finished.connect(_show_results)
	flight_world.setup(game_state)
	_build_hud()


func _build_hud() -> void:
	ui_layer = CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)
	screen = Control.new()
	screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui_layer.add_child(screen)

	var top := HBoxContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.offset_left = 28
	top.offset_right = -28
	top.offset_top = 22
	top.offset_bottom = 82
	top.alignment = BoxContainer.ALIGNMENT_CENTER
	screen.add_child(top)
	var brand := _label("●  REMOTE FLIGHT / SUNFLOWER", 16, Color("#e7eee7"))
	brand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(brand)
	hud.score = _label("SCORE  0000000", 25, Color("#e7eee7"))
	hud.score.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud.score.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(hud.score)
	var pause := _button("Ⅱ")
	pause.custom_minimum_size = Vector2(54, 46)
	pause.mouse_filter = Control.MOUSE_FILTER_STOP
	pause.pressed.connect(_toggle_pause)
	top.add_child(pause)

	hud.altitude = _label("ALT\n170m", 19, Color("#e7eee7"))
	hud.altitude.position = Vector2(30, 118)
	hud.altitude.size = Vector2(120, 70)
	screen.add_child(hud.altitude)

	hud.status = _label("AIR DEFENSE\n0/0 DESTROYED · CLICK A TARGET", 14, ACID)
	hud.status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.status.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hud.status.offset_top = 96
	hud.status.offset_bottom = 148
	screen.add_child(hud.status)

	var formation_panel := PanelContainer.new()
	formation_panel.position = Vector2(28, 500)
	formation_panel.size = Vector2(280, 140)
	formation_panel.add_theme_stylebox_override("panel", _box(Color(0.03, 0.06, 0.05, 0.82), 1, Color("#415047"), 1))
	screen.add_child(formation_panel)
	var formation_margin := MarginContainer.new()
	formation_margin.add_theme_constant_override("margin_left", 18)
	formation_margin.add_theme_constant_override("margin_right", 18)
	formation_margin.add_theme_constant_override("margin_top", 14)
	formation_margin.add_theme_constant_override("margin_bottom", 14)
	formation_panel.add_child(formation_margin)
	hud.formation = _label("FP-1 FLEET\n◆ ◆ ◆ ◆\n4/4 DRONES\n24 LAUNCHES AVAILABLE", 14, Color("#e1eae3"))
	formation_margin.add_child(hud.formation)

	var progress_row := HBoxContainer.new()
	progress_row.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	progress_row.offset_left = 330
	progress_row.offset_right = -330
	progress_row.offset_top = -84
	progress_row.offset_bottom = -50
	progress_row.add_theme_constant_override("separation", 12)
	screen.add_child(progress_row)
	progress_row.add_child(_label("ENTRY", 11, MUTED))
	hud.progress = ProgressBar.new()
	hud.progress.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hud.progress.show_percentage = false
	hud.progress.add_theme_stylebox_override("background", _box(Color("#28302c"), 0))
	hud.progress.add_theme_stylebox_override("fill", _box(ACID, 0))
	progress_row.add_child(hud.progress)
	progress_row.add_child(_label("EXTRACT", 11, MUTED))

	var controls := _label("WASD / LEFT STICK   FORMATION CONTROL    ·    MOUSE CLICK   ATTACK STATION OR OIL TANK", 12, Color("#c4d0c7"))
	controls.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	controls.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	controls.offset_top = -38
	controls.offset_bottom = -12
	screen.add_child(controls)


func _update_hud(data: Dictionary) -> void:
	if phase != "flight" or hud.is_empty():
		return
	hud.score.text = "SCORE  %07d" % int(data.score)
	hud.altitude.text = "ALT\n%dm" % int(data.altitude)
	hud.status.text = "ATTACK LINK\nDRONE INTERCEPT IN PROGRESS" if int(data.attacks) > 0 else "AIR DEFENSE\n%d/%d DESTROYED · CLICK A TARGET" % [int(data.stations_destroyed), int(data.stations_total)]
	hud.progress.value = float(data.progress) * 100.0
	var pips := ""
	for slot in data.slots:
		pips += "◆ " if slot == "READY" else ("◇ " if slot == "REFILL" else "× ")
	var queued := "\n%d ATTACKS QUEUED" % int(data.queued) if int(data.queued) > 0 else ""
	hud.formation.text = "FP-1 FLEET\n%s\n%d/4 DRONES\n%d LAUNCHES AVAILABLE%s" % [pips.strip_edges(), int(data.survivors), int(data.launches), queued]


func _toggle_pause() -> void:
	if phase != "flight":
		return
	get_tree().paused = not get_tree().paused
	if is_instance_valid(music):
		music.stream_paused = get_tree().paused
	if get_tree().paused:
		_show_pause_overlay()
	elif is_instance_valid(pause_overlay):
		pause_overlay.queue_free()
		pause_overlay = null


func _show_pause_overlay() -> void:
	pause_overlay = ColorRect.new()
	pause_overlay.process_mode = Node.PROCESS_MODE_ALWAYS
	pause_overlay.color = Color(0.01, 0.015, 0.012, 0.88)
	pause_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	pause_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(pause_overlay)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pause_overlay.add_child(center)
	var menu := VBoxContainer.new()
	menu.custom_minimum_size.x = 360
	menu.add_theme_constant_override("separation", 14)
	center.add_child(menu)
	menu.add_child(_label("UPLINK SUSPENDED", 13, ACID))
	menu.add_child(_label("PAUSED", 55, Color("#e7eee7")))
	var resume := _button("RESUME")
	resume.pressed.connect(_toggle_pause)
	menu.add_child(resume)
	var restart := _button("RESTART GAME")
	restart.pressed.connect(_start_run)
	menu.add_child(restart)
	var settings := _button("SETTINGS")
	settings.pressed.connect(_show_settings)
	menu.add_child(settings)
	var main_menu := _button("MAIN SCREEN")
	main_menu.pressed.connect(_show_operator)
	menu.add_child(main_menu)


func _show_results(_won: bool) -> void:
	if not smoke_test_mode:
		_save_preferences()
	_clear_screen()
	phase = "results"
	screen = _base_screen(Color("#090d0b"))
	_add_grid(screen)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(650, 500)
	card.add_theme_stylebox_override("panel", _box(PANEL, 2, Color("#3b4b42"), 2))
	center.add_child(card)
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 48)
	card.add_child(margin)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 17)
	margin.add_child(content)
	content.add_child(_label("FP-1 FLEET RECOVERED" if game_state.run_won else "FP-1 FLEET LOST", 13, ACID))
	content.add_child(_label("FORMATION EXTRACTED" if game_state.run_won else "MISSION INTERRUPTED", 43, Color("#e7eee7")))
	content.add_child(_label("UKRAINE CORRIDOR / MOSCOW FLYOVER", 13, MUTED))
	var score := _label("FINAL SCORE\n%d" % game_state.score, 38, CYAN)
	score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(score)
	content.add_child(_label("%d/4 FP-1 DRONES RECOVERED        PERSONAL BEST  %d" % [game_state.survivors, game_state.best_score], 14, Color("#c6d0c9")))
	var restart := _button("RESTART GAME")
	restart.pressed.connect(_start_run)
	content.add_child(restart)
	var main_menu := _button("MAIN SCREEN")
	main_menu.pressed.connect(_show_operator)
	content.add_child(main_menu)


func _show_settings() -> void:
	if is_instance_valid(settings_overlay) or not is_instance_valid(screen):
		return
	settings_overlay = ColorRect.new()
	settings_overlay.process_mode = Node.PROCESS_MODE_ALWAYS
	settings_overlay.color = Color(0.01, 0.015, 0.012, 0.92)
	settings_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	settings_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.add_child(settings_overlay)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	settings_overlay.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(560, 650)
	panel.add_theme_stylebox_override("panel", _box(PANEL, 2, Color("#435249"), 2))
	center.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 34)
	panel.add_child(margin)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 12)
	margin.add_child(content)
	content.add_child(_label("SYSTEM", 13, ACID))
	content.add_child(_label("SETTINGS", 42, Color("#e7eee7")))

	var volume_label := _label("MASTER VOLUME   %d%%" % roundi(game_state.master_volume * 100.0), 15, Color("#cbd5ce"))
	content.add_child(volume_label)
	var volume := HSlider.new()
	volume.min_value = 0.0
	volume.max_value = 1.0
	volume.step = 0.05
	volume.value = game_state.master_volume
	volume.custom_minimum_size.y = 34
	volume.value_changed.connect(_on_volume_changed.bind(volume_label))
	content.add_child(volume)

	var reduced := CheckButton.new()
	reduced.text = "REDUCED EFFECTS  /  FEWER CLOUDS, WEATHER PARTICLES, AND DEBRIS"
	reduced.button_pressed = game_state.reduced_effects
	reduced.add_theme_font_size_override("font_size", 13)
	reduced.toggled.connect(_on_reduced_effects_toggled)
	content.add_child(reduced)
	content.add_child(_label("INPUT BINDINGS", 13, MUTED))
	binding_buttons.clear()
	for action in ["left", "right", "up", "down", "pause"]:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var action_label := _label(String(action).to_upper(), 14, Color("#cbd5ce"))
		action_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(action_label)
		var binding := _button(OS.get_keycode_string(int(game_state.bindings[action])))
		binding.custom_minimum_size = Vector2(190, 42)
		binding.pressed.connect(_listen_for_binding.bind(action))
		row.add_child(binding)
		binding_buttons[action] = binding
		content.add_child(row)
	var apply := _button("APPLY")
	apply.pressed.connect(_close_settings)
	content.add_child(apply)


func _listen_for_binding(action: String) -> void:
	binding_target = action
	binding_buttons[action].text = "PRESS KEY"


func _on_volume_changed(value: float, label: Label) -> void:
	game_state.master_volume = value
	label.text = "MASTER VOLUME   %d%%" % roundi(value * 100.0)
	_apply_volume()


func _on_reduced_effects_toggled(enabled: bool) -> void:
	game_state.reduced_effects = enabled


func _close_settings() -> void:
	if not smoke_test_mode:
		_save_preferences()
	binding_target = ""
	binding_buttons.clear()
	if is_instance_valid(settings_overlay):
		settings_overlay.queue_free()
	settings_overlay = null


func _apply_volume() -> void:
	AudioServer.set_bus_mute(0, game_state.master_volume <= 0.001)
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(0.001, game_state.master_volume)))


func _base_screen(color: Color) -> Control:
	var root := ColorRect.new()
	root.color = color
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(root)
	return root


func _add_grid(parent: Control) -> void:
	var grid := GridContainer.new()
	grid.modulate = Color(1, 1, 1, 0.05)
	grid.columns = 20
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	grid.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(grid)
	for index in range(240):
		var cell := Panel.new()
		cell.custom_minimum_size = Vector2(64, 60)
		cell.add_theme_stylebox_override("panel", _box(Color.TRANSPARENT, 0, Color("#7ea98d"), 1))
		grid.add_child(cell)


func _label(text: String, size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label


func _button(text: String) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(220, 52)
	button.add_theme_font_size_override("font_size", 15)
	button.add_theme_color_override("font_color", INK)
	button.add_theme_color_override("font_hover_color", INK)
	button.add_theme_stylebox_override("normal", _box(ACID, 1))
	button.add_theme_stylebox_override("hover", _box(Color("#d1ff71"), 1))
	button.add_theme_stylebox_override("pressed", _box(Color("#8bbb27"), 1))
	button.add_theme_stylebox_override("disabled", _box(Color("#28302c"), 1))
	return button


func _box(color: Color, radius: int, border_color := Color.TRANSPARENT, border_width := 0) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.corner_radius_top_left = radius
	box.corner_radius_top_right = radius
	box.corner_radius_bottom_left = radius
	box.corner_radius_bottom_right = radius
	if border_width > 0:
		box.border_color = border_color
		box.set_border_width_all(border_width)
	return box


func _load_preferences() -> void:
	var config := ConfigFile.new()
	if config.load("user://settings.cfg") == OK:
		game_state.best_score = int(config.get_value("scores", "best", 0))
		game_state.master_volume = float(config.get_value("settings", "master_volume", 0.65))
		game_state.reduced_effects = bool(config.get_value("settings", "reduced_effects", false))
		for action in game_state.bindings.keys():
			game_state.bindings[action] = int(config.get_value("bindings", action, game_state.bindings[action]))


func _save_preferences() -> void:
	var config := ConfigFile.new()
	config.set_value("scores", "best", game_state.best_score)
	config.set_value("settings", "master_volume", game_state.master_volume)
	config.set_value("settings", "reduced_effects", game_state.reduced_effects)
	for action in game_state.bindings.keys():
		config.set_value("bindings", action, game_state.bindings[action])
	config.save("user://settings.cfg")
