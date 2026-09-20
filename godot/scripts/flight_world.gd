class_name FlightWorld
extends Node3D

signal hud_changed(data: Dictionary)
signal run_finished(won: bool)

const FORWARD_SPEED := 3.05
const FORMATION_OFFSETS := [
	Vector3(0.0, 0.0, 0.0),
	Vector3(-4.4, -0.35, 2.4),
	Vector3(4.4, -0.35, 2.4),
	Vector3(0.0, -0.55, 5.0),
]
const CHECKPOINTS := [0.20, 0.42, 0.66, 0.86]
const CITY_FIRST_ROW_Z := 8.0
const CITY_ROW_SPACING := 15.0
const CITY_COLUMNS := [-72.0, -48.0, -24.0, 0.0, 24.0, 48.0, 72.0]

var state: GameState
var formation: Node3D
var camera: Camera3D
var drones: Array[Node3D] = []
var targets: Array[Dictionary] = []
var attacks: Array[Dictionary] = []
var missiles: Array[Dictionary] = []
var refills: Array[Dictionary] = []
var pending_targets: Array[Dictionary] = []
var buildings: Array[Dictionary] = []
var pollution_clouds: Array[Dictionary] = []
var rooftop_people: Array[Dictionary] = []
var blackened_slots := [false, false, false, false]
var ground_texture: Texture2D
var wall_textures: Array[Texture2D] = []
var tank_roof_scene: PackedScene
var engine_audio: AudioStreamPlayer
var engine_playback: AudioStreamGeneratorPlayback
var engine_phase_a := 0.0
var engine_phase_b := 0.0
var propellers: Array[MeshInstance3D] = []
var elapsed := 0.0
var checkpoint_index := 0
var missile_clock := 0.0
var hud_clock := 0.0
var stations_destroyed := 0
var total_stations := 0
var finished := false
var damage_cooldown := 0.0
var near_miss_clock := 11.5
var periodic_score_index := 1
var rng := RandomNumberGenerator.new()


func setup(game_state: GameState) -> void:
	state = game_state
	rng.seed = state.run_seed
	ground_texture = load("res://assets/textures/texture-ground.jpg")
	wall_textures = [
		load("res://assets/textures/texture-house-wall-10-storeys-white.jpg"),
		load("res://assets/textures/texture-house-wall-11-storeys-white.jpg"),
		load("res://assets/textures/texture-house-wall-15-storeys-white.jpg"),
	]
	tank_roof_scene = load("res://assets/models/oil_tank_roof_blowoff_flat.glb")
	_build_environment()
	_build_city()
	_build_formation()
	if "--smoke-test" not in OS.get_cmdline_user_args():
		_start_engine_audio()
	_emit_hud()


func _exit_tree() -> void:
	if is_instance_valid(engine_audio):
		engine_audio.stop()
		engine_audio.stream = null
	engine_playback = null


func _process(delta: float) -> void:
	if finished:
		return
	_fill_engine_audio()
	_spin_propellers(delta)
	elapsed += delta
	damage_cooldown = maxf(0.0, damage_cooldown - delta)
	_update_formation(delta)
	_update_attacks(delta)
	_update_refills(delta)
	_update_missiles(delta)
	_update_pollution(delta)
	_update_rooftop_people(delta)
	_check_formation_collisions()
	_update_camera(delta)
	_update_progress()
	hud_clock += delta
	if hud_clock >= 0.08:
		hud_clock = 0.0
		_emit_hud()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		_pick_target(event.position)


func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#9baaa5")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#adc0b6")
	environment.ambient_light_energy = 0.62
	environment.fog_enabled = true
	environment.fog_light_color = Color("#8c9e95")
	environment.fog_density = 0.006
	environment.fog_height = 5.0
	environment.fog_height_density = 0.05
	world_environment.environment = environment
	add_child(world_environment)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52.0, -28.0, 0.0)
	sun.light_color = Color("#f0d6ae")
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	add_child(sun)

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(190.0, 520.0)
	ground.mesh = plane
	ground.position = Vector3(0.0, -3.0, -210.0)
	var ground_material := _material(Color("#b5bab4"), 1.0)
	ground_material.albedo_texture = ground_texture
	ground_material.uv1_scale = Vector3(18.0, 14.0, 1.0)
	ground.material_override = ground_material
	add_child(ground)
	_add_static_collision(ground.position - Vector3(0.0, 0.25, 0.0), Vector3(190.0, 0.5, 520.0))

	for x in [-10.0, 10.0]:
		var road := MeshInstance3D.new()
		var road_mesh := PlaneMesh.new()
		road_mesh.size = Vector2(8.0, 520.0)
		road.mesh = road_mesh
		road.position = Vector3(x, -2.96, -210.0)
		road.material_override = _material(Color("#303632"), 1.0)
		add_child(road)

	for row in range(16):
		var cross_road := MeshInstance3D.new()
		var cross_mesh := PlaneMesh.new()
		cross_mesh.size = Vector2(190.0, 4.5)
		cross_road.mesh = cross_mesh
		cross_road.position = Vector3(0.0, -2.94, -7.5 - row * 30.0)
		cross_road.material_override = _material(Color("#343a36"), 1.0)
		add_child(cross_road)


func _build_city() -> void:
	var colors := [Color("#9a9184"), Color("#7f8984"), Color("#a39d8e"), Color("#777b72")]
	var cells: Array[Dictionary] = []
	for row in range(28):
		for column in range(CITY_COLUMNS.size()):
			cells.append({
				"x": CITY_COLUMNS[column],
				"z": CITY_FIRST_ROW_Z - float(row) * CITY_ROW_SPACING,
				"row": row,
				"column": column,
			})
	_shuffle_cells(cells)

	var tank_cells: Array[Dictionary] = []
	var building_candidates: Array[Dictionary] = []
	for index in range(cells.size()):
		if index < 12:
			tank_cells.append(cells[index])
		elif int(cells[index].row) >= 3:
			building_candidates.append(cells[index])

	var station_cells: Array[Dictionary] = []
	for band in range(3):
		var count := 0
		for cell in building_candidates:
			if int(cell.row) / 10 == band:
				station_cells.append(cell)
				count += 1
				if count == 4:
					break

	var station_keys := {}
	for cell in station_cells:
		station_keys["%d:%d" % [int(cell.row), int(cell.column)]] = true
	var building_cells: Array[Dictionary] = station_cells.duplicate()
	for cell in building_candidates:
		if building_cells.size() >= 52:
			break
		var key := "%d:%d" % [int(cell.row), int(cell.column)]
		if not station_keys.has(key):
			building_cells.append(cell)

	var station_buildings: Array[int] = []
	for building_index in range(building_cells.size()):
		var cell := building_cells[building_index]
		var storey_roll := rng.randf()
		var storeys := 10 if storey_roll < 0.4 else (11 if storey_roll < 0.7 else 15)
		var height := 1.8 + float(storeys) * 1.6
		var size := Vector3(13.4, height, 9.0)
		var building := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = size
		building.mesh = box
		building.position = Vector3(float(cell.x), -3.0 + height * 0.5, float(cell.z))
		building.rotation.y = PI if rng.randf() > 0.5 else 0.0
		building.material_override = _building_material(
			colors[rng.randi_range(0, colors.size() - 1)],
			height
		)
		add_child(building)
		var collision := _add_static_collision(building.position, size)
		collision.rotation.y = building.rotation.y
		collision.set_meta("building_index", building_index)
		var has_station := building_index < station_cells.size()
		var has_person := building_index % 2 == 0 and not has_station
		buildings.append({
			"node": building,
			"collision": collision,
			"position": building.position,
			"size": size,
			"row": int(cell.row),
			"damaged": false,
			"protected": has_station or has_person,
		})
		_add_windows(building, size.x, size.y)
		if has_station:
			station_buildings.append(building_index)
		elif has_person:
			_add_rooftop_person(building.position, size)

	for cell in tank_cells:
		_create_tank(Vector3(float(cell.x), -1.1, float(cell.z)))
	for building_index in station_buildings:
		_create_station(building_index)


func _shuffle_cells(cells: Array[Dictionary]) -> void:
	for index in range(cells.size() - 1, 0, -1):
		var swap_index := rng.randi_range(0, index)
		var temporary := cells[index]
		cells[index] = cells[swap_index]
		cells[swap_index] = temporary


func _add_static_collision(position: Vector3, size: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = position
	var shape_node := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	shape_node.shape = shape
	body.add_child(shape_node)
	add_child(body)
	return body


func _add_rooftop_person(building_position: Vector3, building_size: Vector3) -> void:
	var person := Node3D.new()
	var direction := -signf(building_position.x)
	if direction == 0.0:
		direction = 1.0
	person.position = Vector3(
		building_position.x + direction * building_size.x * 0.34,
		building_position.y + building_size.y * 0.5 + 0.75,
		building_position.z + rng.randf_range(-2.0, 2.0)
	)
	var body := MeshInstance3D.new()
	var body_mesh := CapsuleMesh.new()
	body_mesh.radius = 0.18
	body_mesh.height = 0.72
	body.mesh = body_mesh
	body.material_override = _material(Color("#345d9b") if rng.randf() > 0.5 else Color("#a84138"), 0.9)
	person.add_child(body)
	var head := MeshInstance3D.new()
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.2
	head_mesh.height = 0.4
	head.mesh = head_mesh
	head.position.y = 0.55
	head.material_override = _material(Color("#c89c78"), 0.9)
	person.add_child(head)
	add_child(person)
	rooftop_people.append({
		"node": person,
		"jumped": false,
		"velocity": Vector3.ZERO,
		"direction": direction,
	})


func _add_windows(building: MeshInstance3D, width: float, height: float) -> void:
	var windows := MultiMeshInstance3D.new()
	var multi := MultiMesh.new()
	var pane := QuadMesh.new()
	pane.size = Vector2(0.55, 0.8)
	pane.material = _material(Color("#c7b572"), 0.3, Color("#6d5c27"))
	multi.mesh = pane
	var floors := mini(10, floori(height / 2.0))
	var across := mini(5, floori(width / 2.0))
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.instance_count = floors * across
	var index := 0
	for floor_index in range(floors):
		for across_index in range(across):
			var px := -width * 0.38 + (float(across_index) / maxf(1.0, across - 1.0)) * width * 0.76
			var py := -height * 0.39 + floor_index * 1.65
			multi.set_instance_transform(index, Transform3D(Basis.IDENTITY, Vector3(px, py, -5.01)))
			index += 1
	windows.multimesh = multi
	building.add_child(windows)


func _create_tank(position: Vector3) -> void:
	var area := Area3D.new()
	area.position = position
	var body := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 3.6
	cylinder.bottom_radius = 3.6
	cylinder.height = 3.8
	body.mesh = cylinder
	body.material_override = _material(Color("#bab6a1"), 0.7)
	area.add_child(body)
	var stripe := MeshInstance3D.new()
	var stripe_mesh := CylinderMesh.new()
	stripe_mesh.top_radius = 3.68
	stripe_mesh.bottom_radius = 3.68
	stripe_mesh.height = 0.25
	stripe.mesh = stripe_mesh
	stripe.position.y = 0.8
	stripe.material_override = _material(Color("#8f3429"), 0.75)
	area.add_child(stripe)
	var roof := _make_tank_roof()
	roof.position.y = 2.0
	area.add_child(roof)
	var shape := CollisionShape3D.new()
	var cylinder_shape := CylinderShape3D.new()
	cylinder_shape.radius = 3.8
	cylinder_shape.height = 4.2
	shape.shape = cylinder_shape
	area.add_child(shape)
	_add_target_indicator(area, 4.9, 3.2)
	_register_target(area, "oil_tank")


func _create_station(building_index: int) -> void:
	var building: Dictionary = buildings[building_index]
	var building_node: MeshInstance3D = building.node
	var area := Area3D.new()
	area.position = Vector3(0.0, float(building.size.y) * 0.5 + 0.65, 0.0)
	var base := MeshInstance3D.new()
	var base_mesh := BoxMesh.new()
	base_mesh.size = Vector3(4.5, 1.1, 4.5)
	base.mesh = base_mesh
	base.material_override = _material(Color("#48574a"), 0.9)
	area.add_child(base)
	var radar := MeshInstance3D.new()
	var dish := SphereMesh.new()
	dish.radius = 1.6
	dish.height = 0.65
	radar.mesh = dish
	radar.position.y = 1.2
	radar.rotation_degrees.x = 28.0
	radar.material_override = _material(Color("#87927e"), 0.65)
	area.add_child(radar)
	var antenna := MeshInstance3D.new()
	var antenna_mesh := CylinderMesh.new()
	antenna_mesh.top_radius = 0.12
	antenna_mesh.bottom_radius = 0.18
	antenna_mesh.height = 3.5
	antenna.mesh = antenna_mesh
	antenna.position.y = 1.4
	antenna.material_override = _material(Color("#313a32"), 0.9)
	area.add_child(antenna)
	var shape := CollisionShape3D.new()
	var box_shape := BoxShape3D.new()
	box_shape.size = Vector3(5.0, 5.0, 5.0)
	shape.shape = box_shape
	area.add_child(shape)
	_add_target_indicator(area, 4.2, 4.2)
	building_node.add_child(area)
	_register_target(area, "air_defense", building_index)
	total_stations += 1


func _add_target_indicator(area: Area3D, radius: float, height: float) -> void:
	var indicator := MeshInstance3D.new()
	indicator.name = "TargetIndicator"
	var ring := TorusMesh.new()
	ring.inner_radius = radius - 0.22
	ring.outer_radius = radius
	ring.rings = 12
	ring.ring_segments = 32
	indicator.mesh = ring
	indicator.position.y = height
	var material := _material(Color(1.0, 0.35, 0.12, 0.58), 0.35, Color("#ff5b35"))
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	indicator.material_override = material
	area.add_child(indicator)


func _make_tank_roof() -> Node3D:
	if tank_roof_scene != null:
		var imported := tank_roof_scene.instantiate() as Node3D
		imported.rotation.x = -PI * 0.5
		imported.scale = Vector3.ONE * 1.06
		return imported
	var fallback := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 3.7
	mesh.bottom_radius = 3.7
	mesh.height = 0.22
	fallback.mesh = mesh
	fallback.material_override = _material(Color("#b5b09d"), 0.55)
	return fallback


func _register_target(area: Area3D, kind: String, building_index := -1) -> void:
	var index := targets.size()
	area.set_meta("target_index", index)
	area.collision_layer = 2
	area.collision_mask = 0
	if not area.is_inside_tree():
		add_child(area)
	targets.append({
		"node": area,
		"kind": kind,
		"destroyed": false,
		"targeted": false,
		"building_index": building_index,
		"indicator": area.get_node_or_null("TargetIndicator"),
	})


func _build_formation() -> void:
	formation = Node3D.new()
	formation.position = Vector3(0.0, 5.0, 12.0)
	add_child(formation)
	for offset in FORMATION_OFFSETS:
		var drone := _make_drone()
		drone.position = offset
		formation.add_child(drone)
		drones.append(drone)

	camera = Camera3D.new()
	camera.fov = 58.0
	camera.near = 0.1
	camera.far = 700.0
	camera.position = formation.position + Vector3(0.0, 5.5, 15.0)
	add_child(camera)
	camera.look_at(formation.position + Vector3(0.0, 0.0, -10.0))


func _make_drone(blackened := false) -> Node3D:
	var drone := Node3D.new()
	var dark := Color("#1b211e") if blackened else Color("#d2d0bb")
	var fuselage := MeshInstance3D.new()
	var fuselage_mesh := CylinderMesh.new()
	fuselage_mesh.top_radius = 0.22
	fuselage_mesh.bottom_radius = 0.38
	fuselage_mesh.height = 3.8
	fuselage.mesh = fuselage_mesh
	fuselage.rotation_degrees.x = 90.0
	fuselage.material_override = _material(Color("#161815") if blackened else Color("#d5d0b9"), 0.62)
	drone.add_child(fuselage)
	_add_box(drone, Vector3(5.8, 0.12, 0.72), Vector3(0.0, 0.0, -0.25), Color("#131512") if blackened else Color("#c9c5af"))
	_add_box(drone, Vector3(2.1, 0.10, 0.48), Vector3(0.0, 0.05, 1.45), Color("#171916") if blackened else Color("#b9b6a4"))
	_add_box(drone, Vector3(0.10, 0.90, 0.62), Vector3(0.0, 0.46, 1.58), Color("#10120f") if blackened else Color("#aaa795"))
	_add_box(drone, Vector3(0.72, 0.34, 1.15), Vector3(0.0, -0.28, -0.65), Color("#090a09") if blackened else Color("#707467"))
	var nose := MeshInstance3D.new()
	var cone := CylinderMesh.new()
	cone.top_radius = 0.05
	cone.bottom_radius = 0.38
	cone.height = 0.9
	nose.mesh = cone
	nose.position = Vector3(0.0, 0.0, -2.0)
	nose.rotation_degrees.x = -90.0
	nose.material_override = _material(dark, 0.85)
	drone.add_child(nose)
	var hub := MeshInstance3D.new()
	var hub_mesh := CylinderMesh.new()
	hub_mesh.top_radius = 0.20
	hub_mesh.bottom_radius = 0.24
	hub_mesh.height = 0.34
	hub.mesh = hub_mesh
	hub.position.z = 2.02
	hub.rotation_degrees.x = 90.0
	hub.material_override = _material(Color("#4b4d46"), 0.72)
	drone.add_child(hub)
	var propeller := MeshInstance3D.new()
	var propeller_mesh := BoxMesh.new()
	propeller_mesh.size = Vector3(1.45, 0.055, 0.10)
	propeller.mesh = propeller_mesh
	propeller.position.z = 2.22
	var propeller_material := _material(Color(0.85, 0.84, 0.77, 0.68), 0.5)
	propeller_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	propeller.material_override = propeller_material
	drone.add_child(propeller)
	propellers.append(propeller)
	return drone


func _add_box(parent: Node3D, size: Vector3, position: Vector3, color: Color) -> void:
	var instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	instance.mesh = mesh
	instance.position = position
	instance.material_override = _material(color, 0.82)
	parent.add_child(instance)


func _material(color: Color, roughness := 0.8, emission := Color(0, 0, 0, 1)) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	if emission != Color(0, 0, 0, 1):
		material.emission_enabled = true
		material.emission = emission
	return material


func _building_material(color: Color, height: float) -> StandardMaterial3D:
	var material := _material(color.lightened(0.24), 0.9)
	var texture_index := 0 if height < 17.0 else (1 if height < 21.0 else 2)
	if texture_index < wall_textures.size():
		material.albedo_texture = wall_textures[texture_index]
		material.uv1_scale = Vector3(1.0, maxf(1.0, height / 15.0), 1.0)
	return material


func _start_engine_audio() -> void:
	var generator := AudioStreamGenerator.new()
	generator.mix_rate = 22050.0
	generator.buffer_length = 0.25
	engine_audio = AudioStreamPlayer.new()
	engine_audio.stream = generator
	engine_audio.volume_db = -27.0
	add_child(engine_audio)
	engine_audio.play()
	engine_playback = engine_audio.get_stream_playback() as AudioStreamGeneratorPlayback


func _fill_engine_audio() -> void:
	if engine_playback == null:
		return
	var frames := engine_playback.get_frames_available()
	var mix_rate := 22050.0
	for _frame in range(frames):
		engine_phase_a = fmod(engine_phase_a + 72.0 / mix_rate, 1.0)
		engine_phase_b = fmod(engine_phase_b + 76.0 / mix_rate, 1.0)
		var saw := engine_phase_a * 2.0 - 1.0
		var square := 1.0 if engine_phase_b < 0.5 else -1.0
		var sample := (saw * 0.62 + square * 0.38) * 0.15
		engine_playback.push_frame(Vector2(sample, sample))


func _spin_propellers(delta: float) -> void:
	for index in range(propellers.size() - 1, -1, -1):
		if not is_instance_valid(propellers[index]):
			propellers.remove_at(index)
			continue
		propellers[index].rotation.z += delta * 32.0


func _update_formation(delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var keyboard := Vector2.ZERO
	if Input.is_physical_key_pressed(int(state.bindings.left)): keyboard.x -= 1.0
	if Input.is_physical_key_pressed(int(state.bindings.right)): keyboard.x += 1.0
	if Input.is_physical_key_pressed(int(state.bindings.up)): keyboard.y -= 1.0
	if Input.is_physical_key_pressed(int(state.bindings.down)): keyboard.y += 1.0
	if Input.get_connected_joypads().size() > 0:
		var joypad := Input.get_connected_joypads()[0]
		var stick := Vector2(
			Input.get_joy_axis(joypad, JOY_AXIS_LEFT_X),
			Input.get_joy_axis(joypad, JOY_AXIS_LEFT_Y)
		)
		if stick.length() > 0.18 and stick.length_squared() > direction.length_squared():
			direction = stick
	if keyboard.length_squared() > direction.length_squared():
		direction = keyboard.normalized()
	formation.position.x = clampf(formation.position.x + direction.x * 10.0 * delta, -32.0, 32.0)
	formation.position.y = clampf(formation.position.y - direction.y * 10.0 * delta, 0.5, 28.0)
	formation.position.z -= FORWARD_SPEED * delta
	formation.rotation.z = lerpf(formation.rotation.z, -direction.x * 0.16, delta * 4.0)
	formation.rotation.x = lerpf(formation.rotation.x, direction.y * 0.08, delta * 4.0)


func _update_camera(delta: float) -> void:
	var desired := formation.position + Vector3(0.0, 5.5, 15.0)
	camera.position = camera.position.lerp(desired, 1.0 - exp(-delta * 4.0))
	camera.look_at(formation.position + Vector3(0.0, -0.8, -11.0))


func _pick_target(screen_position: Vector2) -> void:
	var origin := camera.project_ray_origin(screen_position)
	var endpoint := origin + camera.project_ray_normal(screen_position) * 800.0
	var query := PhysicsRayQueryParameters3D.create(origin, endpoint)
	query.collide_with_areas = true
	query.collide_with_bodies = false
	query.collision_mask = 2
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return
	var collider: Object = hit.collider
	if not collider.has_meta("target_index"):
		return
	_launch_attack(int(collider.get_meta("target_index")))


func _launch_attack(target_index: int) -> void:
	if target_index < 0 or target_index >= targets.size():
		return
	var target := targets[target_index]
	if target.destroyed or target.targeted:
		return
	var launch := state.launch_drone()
	if not launch.accepted:
		return
	targets[target_index].targeted = true
	_set_target_indicator(target_index, true)
	var request := {
		"target_index": target_index,
		"replacement_available": bool(launch.replacement_available),
	}
	var slot := _available_slot()
	if slot < 0:
		pending_targets.append(request)
		_emit_hud()
		return
	_begin_attack(request, slot)


func _begin_attack(request: Dictionary, slot: int) -> void:
	var target_index := int(request.target_index)
	var target := targets[target_index]
	drones[slot].visible = false
	var attack_drone := _make_drone(bool(blackened_slots[slot]))
	add_child(attack_drone)
	attack_drone.global_position = formation.to_global(FORMATION_OFFSETS[slot])
	var distance := attack_drone.global_position.distance_to(target.node.global_position)
	attacks.append({
		"node": attack_drone,
		"target_index": target_index,
		"start": attack_drone.global_position,
		"progress": 0.0,
		"duration": clampf(distance / 25.0, 1.2, 4.5),
	})
	if bool(request.replacement_available):
		blackened_slots[slot] = false
		var replacement := _make_drone()
		add_child(replacement)
		replacement.global_position = formation.to_global(FORMATION_OFFSETS[slot] + Vector3(0.0, -1.5, 38.0 + slot * 3.0))
		refills.append({"slot": slot, "time": 3.2, "duration": 3.2, "node": replacement})
	elif state.survivors <= 0:
		_finish_run(false)
	_emit_hud()


func _available_slot() -> int:
	for index in range(drones.size()):
		if drones[index].visible and not _slot_refilling(index):
			return index
	return -1


func _slot_refilling(slot: int) -> bool:
	for refill in refills:
		if int(refill.slot) == slot:
			return true
	return false


func _update_attacks(delta: float) -> void:
	for index in range(attacks.size() - 1, -1, -1):
		var attack := attacks[index]
		var target := targets[int(attack.target_index)]
		if not is_instance_valid(attack.node) or not is_instance_valid(target.node):
			attacks.remove_at(index)
			continue
		attack.progress = float(attack.progress) + delta / float(attack.duration)
		var t: float = minf(1.0, attack.progress)
		var target_position: Vector3 = target.node.global_position
		var position: Vector3 = Vector3(attack.start).lerp(target_position, t)
		position.y += sin(t * PI) * 8.0
		attack.node.global_position = position
		if position.distance_squared_to(target_position) > 0.001:
			attack.node.look_at(target_position, Vector3.UP)
		if t > 0.04:
			var structure_hit := _find_structure_hit(position, int(attack.target_index))
			if not structure_hit.is_empty():
				_apply_structure_hit(structure_hit)
				targets[int(attack.target_index)].targeted = false
				_set_target_indicator(int(attack.target_index), false)
				_spawn_explosion(position)
				attack.node.queue_free()
				attacks.remove_at(index)
				continue
		attacks[index] = attack
		if t >= 1.0:
			_destroy_target(int(attack.target_index))
			attack.node.queue_free()
			attacks.remove_at(index)


func _update_refills(delta: float) -> void:
	for index in range(refills.size() - 1, -1, -1):
		refills[index].time = float(refills[index].time) - delta
		var slot := int(refills[index].slot)
		var replacement: Node3D = refills[index].node
		var target_position := formation.to_global(FORMATION_OFFSETS[slot])
		replacement.global_position = replacement.global_position.lerp(target_position, minf(1.0, delta * 2.2))
		var building_hit := _find_building_hit(replacement.global_position)
		if building_hit >= 0:
			_damage_building(building_hit)
			_spawn_explosion(replacement.global_position)
			replacement.queue_free()
			refills.remove_at(index)
			state.lose_drone()
			if state.survivors <= 0:
				_finish_run(false)
			continue
		if float(refills[index].time) <= 0.0:
			replacement.queue_free()
			drones[slot].visible = true
			refills.remove_at(index)
	_dispatch_pending()


func _find_structure_hit(position: Vector3, intended_target_index: int) -> Dictionary:
	var intended_building := int(targets[intended_target_index].building_index)
	var building_index := _find_building_hit(position, intended_building)
	if building_index >= 0:
		return {"kind": "building", "index": building_index}
	for target_index in range(targets.size()):
		if target_index == intended_target_index or targets[target_index].destroyed:
			continue
		var target := targets[target_index]
		var target_position: Vector3 = target.node.global_position
		var horizontal := Vector2(position.x - target_position.x, position.z - target_position.z)
		var radius := 4.5 if target.kind == "oil_tank" else 3.8
		if horizontal.length() <= radius and absf(position.y - target_position.y) <= 3.8:
			return {"kind": "target", "index": target_index}
	return {}


func _find_building_hit(position: Vector3, excluded_index := -1) -> int:
	for building_index in range(buildings.size()):
		if building_index == excluded_index or buildings[building_index].damaged:
			continue
		var building := buildings[building_index]
		var center: Vector3 = building.position
		var size: Vector3 = building.size
		if (
			absf(position.x - center.x) <= size.x * 0.5 + 0.8
			and absf(position.y - center.y) <= size.y * 0.5 + 0.5
			and absf(position.z - center.z) <= size.z * 0.5 + 1.2
		):
			return building_index
	return -1


func _apply_structure_hit(hit: Dictionary) -> void:
	if hit.kind == "building":
		_damage_building(int(hit.index))
	else:
		_destroy_target(int(hit.index), true)


func _dispatch_pending() -> void:
	while not pending_targets.is_empty():
		var slot := _available_slot()
		if slot < 0:
			return
		var request: Dictionary = pending_targets.pop_front()
		var target := targets[int(request.target_index)]
		if target.destroyed:
			continue
		_begin_attack(request, slot)


func _destroy_target(target_index: int, award_score := true) -> void:
	var target := targets[target_index]
	if target.destroyed:
		return
	targets[target_index].destroyed = true
	if target.kind == "air_defense":
		stations_destroyed += 1
		if award_score:
			state.add_score("air_defense")
	else:
		if award_score:
			state.add_score("oil_tank")
		_spawn_tank_aftermath(target.node.global_position)
	_spawn_explosion(target.node.global_position)
	target.node.visible = false
	target.node.set_deferred("collision_layer", 0)
	target.node.set_deferred("monitorable", false)
	target.node.set_deferred("monitoring", false)


func _set_target_indicator(target_index: int, targeted: bool) -> void:
	if target_index < 0 or target_index >= targets.size():
		return
	var indicator: MeshInstance3D = targets[target_index].indicator
	if not is_instance_valid(indicator):
		return
	var material := indicator.material_override as StandardMaterial3D
	material.albedo_color = Color(1.0, 0.80, 0.25, 0.92) if targeted else Color(1.0, 0.35, 0.12, 0.58)
	material.emission = Color("#ffcf45") if targeted else Color("#ff5b35")


func _spawn_explosion(position: Vector3) -> void:
	var flash := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 1.2
	sphere.height = 2.4
	flash.mesh = sphere
	flash.position = position
	var material := _material(Color("#ff9d24"), 0.25, Color("#ff5d16"))
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	flash.material_override = material
	add_child(flash)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(flash, "scale", Vector3.ONE * (4.0 if state.reduced_effects else 7.0), 0.7)
	tween.tween_property(material, "albedo_color:a", 0.0, 0.7)
	tween.chain().tween_callback(flash.queue_free)


func _spawn_tank_aftermath(position: Vector3) -> void:
	_spawn_pollution_cloud(position + Vector3(0.0, 24.0, 0.0))
	if state.reduced_effects:
		return
	var lid := RigidBody3D.new()
	lid.mass = 7.0
	lid.contact_monitor = true
	lid.max_contacts_reported = 4
	lid.position = position + Vector3(0.0, 2.4, 0.0)
	lid.linear_damp = 0.12
	lid.angular_damp = 0.08
	lid.add_child(_make_tank_roof())
	var shape_node := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 3.7
	shape.height = 0.22
	shape_node.shape = shape
	lid.add_child(shape_node)
	add_child(lid)
	lid.body_entered.connect(_on_lid_body_entered.bind(lid))
	lid.apply_central_impulse(Vector3(rng.randf_range(-12.0, 12.0), 34.0, rng.randf_range(-10.0, 5.0)))
	lid.angular_velocity = Vector3(rng.randf_range(-5.0, 5.0), rng.randf_range(-3.0, 3.0), rng.randf_range(-5.0, 5.0))
	get_tree().create_timer(14.0).timeout.connect(lid.queue_free)


func _on_lid_body_entered(body: Node, lid: RigidBody3D) -> void:
	if not is_instance_valid(lid) or lid.has_meta("building_impact"):
		return
	if not body.has_meta("building_index"):
		return
	lid.set_meta("building_impact", true)
	_damage_building(int(body.get_meta("building_index")))
	_spawn_explosion(lid.global_position)


func _spawn_pollution_cloud(position: Vector3) -> void:
	var cloud := Node3D.new()
	cloud.position = position
	add_child(cloud)
	var blob_count := 4 if state.reduced_effects else 9
	for _index in range(blob_count):
		var blob := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = rng.randf_range(2.2, 4.2)
		sphere.height = sphere.radius * 2.0
		blob.mesh = sphere
		blob.position = Vector3(rng.randf_range(-5.0, 5.0), rng.randf_range(-1.0, 3.5), rng.randf_range(-4.0, 4.0))
		var smoke := _material(Color(0.055, 0.065, 0.06, 0.82), 1.0)
		smoke.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		blob.material_override = smoke
		cloud.add_child(blob)
	pollution_clouds.append({"node": cloud, "age": 0.0, "radius": 10.5})


func _update_pollution(delta: float) -> void:
	for index in range(pollution_clouds.size() - 1, -1, -1):
		var cloud := pollution_clouds[index]
		cloud.age = float(cloud.age) + delta
		cloud.node.position.y += delta * 0.34
		cloud.node.position.x += delta * 0.22
		pollution_clouds[index] = cloud
		if float(cloud.age) > 28.0:
			cloud.node.queue_free()
			pollution_clouds.remove_at(index)


func _update_rooftop_people(delta: float) -> void:
	for index in range(rooftop_people.size() - 1, -1, -1):
		var person := rooftop_people[index]
		if not is_instance_valid(person.node):
			rooftop_people.remove_at(index)
			continue
		if not person.jumped:
			var distance_ahead: float = formation.global_position.z - person.node.global_position.z
			if distance_ahead > 22.0 and distance_ahead < 52.0:
				person.jumped = true
				person.velocity = Vector3(float(person.direction) * 4.8, 3.8, -1.5)
		else:
			person.velocity.y = float(person.velocity.y) - 9.8 * delta
			person.node.position += Vector3(person.velocity) * delta
			person.node.rotation.z += delta * 2.4 * float(person.direction)
			if person.node.global_position.y < -4.0:
				person.node.queue_free()
				rooftop_people.remove_at(index)
				continue
		rooftop_people[index] = person


func _update_missiles(delta: float) -> void:
	missile_clock += delta
	if missile_clock >= 1.35 / 1.3:
		missile_clock = 0.0
		_spawn_missile()
	for index in range(missiles.size() - 1, -1, -1):
		var missile := missiles[index]
		missile.progress = float(missile.progress) + delta / float(missile.duration)
		var t: float = minf(1.0, missile.progress)
		var position := _cubic_bezier(
			Vector3(missile.start),
			Vector3(missile.control_a),
			Vector3(missile.control_b),
			Vector3(missile.end),
			t
		)
		var envelope := sin(t * PI)
		position.x += sin(t * PI * float(missile.wobble)) * envelope * 1.4
		position.y += sin(t * PI * (float(missile.wobble) + 3.0)) * envelope * 0.55
		missile.node.global_position = position
		var look_t := minf(1.0, t + 0.015)
		var look_position := _cubic_bezier(
			Vector3(missile.start),
			Vector3(missile.control_a),
			Vector3(missile.control_b),
			Vector3(missile.end),
			look_t
		)
		if position.distance_squared_to(look_position) > 0.0001:
			missile.node.look_at(look_position, Vector3.UP)
		missiles[index] = missile
		if position.distance_to(formation.global_position) < 2.2 and damage_cooldown <= 0.0:
			_hit_formation(position)
			missile.node.queue_free()
			missiles.remove_at(index)
		elif t >= 1.0:
			if not missile.impact.is_empty():
				_apply_missile_impact(missile.impact)
			elif position.distance_to(formation.global_position) < 8.0:
				state.add_score("near_miss")
			_spawn_explosion(position)
			missile.node.queue_free()
			missiles.remove_at(index)


func _spawn_missile() -> void:
	var available: Array[Dictionary] = []
	for target in targets:
		if target.kind == "air_defense" and not target.destroyed:
			var dz: float = target.node.global_position.z - formation.global_position.z
			if dz < 28.0 and dz > -105.0:
				available.append(target)
	if available.is_empty():
		return
	var station := available[rng.randi_range(0, available.size() - 1)]
	var missile_node := Node3D.new()
	var missile_body := MeshInstance3D.new()
	var missile_mesh := CylinderMesh.new()
	missile_mesh.top_radius = 0.12
	missile_mesh.bottom_radius = 0.20
	missile_mesh.height = 1.7
	missile_body.mesh = missile_mesh
	missile_body.rotation_degrees.x = 90.0
	missile_body.material_override = _material(Color("#d6d1b7"), 0.52)
	missile_node.add_child(missile_body)
	var flare := MeshInstance3D.new()
	var flare_mesh := SphereMesh.new()
	flare_mesh.radius = 0.25
	flare_mesh.height = 0.5
	flare.mesh = flare_mesh
	flare.position.z = 0.95
	flare.material_override = _material(Color("#ffe14f"), 0.2, Color("#ff9f22"))
	missile_node.add_child(flare)
	add_child(missile_node)
	missile_node.global_position = station.node.global_position
	var direct: bool = formation.global_position.y >= station.node.global_position.y - 2.0
	var impact: Dictionary = {}
	var end: Vector3
	if direct:
		var estimated_duration := clampf(
			station.node.global_position.distance_to(formation.global_position) / 20.0,
			2.6,
			5.4
		)
		end = formation.global_position + Vector3(0.0, 0.0, -FORWARD_SPEED * estimated_duration)
	else:
		impact = _choose_environment_impact()
		if impact.is_empty():
			missile_node.queue_free()
			return
		end = Vector3(impact.position)
	var start := missile_node.global_position
	var distance := start.distance_to(end)
	var peak := maxf(start.y, end.y) + rng.randf_range(13.0, 25.0)
	missiles.append({
		"node": missile_node,
		"start": start,
		"end": end,
		"control_a": Vector3(start.x + rng.randf_range(-11.0, 11.0), peak, lerpf(start.z, end.z, 0.27)),
		"control_b": Vector3(end.x + rng.randf_range(-11.0, 11.0), peak * 0.72, lerpf(start.z, end.z, 0.73)),
		"duration": clampf(distance / 20.0, 2.6, 5.4),
		"progress": 0.0,
		"wobble": rng.randf_range(5.0, 7.4),
		"impact": impact,
	})


func _cubic_bezier(start: Vector3, control_a: Vector3, control_b: Vector3, end: Vector3, t: float) -> Vector3:
	var inverse := 1.0 - t
	return (
		start * inverse * inverse * inverse
		+ control_a * 3.0 * inverse * inverse * t
		+ control_b * 3.0 * inverse * t * t
		+ end * t * t * t
	)


func _choose_environment_impact() -> Dictionary:
	var candidates: Array[Dictionary] = []
	for target_index in range(targets.size()):
		var target := targets[target_index]
		if target.kind == "oil_tank" and not target.destroyed:
			candidates.append({
				"kind": "target",
				"index": target_index,
				"position": target.node.global_position + Vector3(0.0, 2.0, 0.0),
			})
	for building_index in range(buildings.size()):
		var building := buildings[building_index]
		if building.damaged or bool(building.get("protected", false)):
			continue
		if absf(float(building.position.z) - formation.global_position.z) < 85.0:
			candidates.append({
				"kind": "building",
				"index": building_index,
				"position": Vector3(building.position) + Vector3(0.0, float(building.size.y) * 0.5, 0.0),
			})
	if candidates.is_empty():
		return {}
	return candidates[rng.randi_range(0, candidates.size() - 1)]


func _apply_missile_impact(impact: Dictionary) -> void:
	if impact.kind == "building":
		_damage_building(int(impact.index))
	else:
		_destroy_target(int(impact.index), false)


func _hit_formation(position: Vector3) -> void:
	damage_cooldown = 2.0
	var candidates: Array[int] = []
	for index in range(drones.size()):
		if drones[index].visible:
			candidates.append(index)
	if candidates.is_empty():
		return
	var slot := candidates[rng.randi_range(0, candidates.size() - 1)]
	_destroy_slot(slot, position)


func _destroy_slot(slot: int, position: Vector3) -> void:
	if slot < 0 or slot >= drones.size() or not drones[slot].visible:
		return
	drones[slot].visible = false
	_spawn_explosion(position)
	state.lose_drone()
	if state.survivors <= 0:
		_finish_run(false)


func _check_formation_collisions() -> void:
	if finished:
		return
	for slot in range(drones.size()):
		if not drones[slot].visible or _slot_refilling(slot):
			continue
		var position := formation.to_global(FORMATION_OFFSETS[slot])
		_check_cloud_blackening(slot, position)
		if damage_cooldown > 0.0:
			continue
		if position.y <= 0.75:
			damage_cooldown = 3.0
			_destroy_slot(slot, position)
			return
		for building_index in range(buildings.size()):
			var building := buildings[building_index]
			if building.damaged:
				continue
			var center: Vector3 = building.position
			var size: Vector3 = building.size
			if (
				absf(position.x - center.x) <= size.x * 0.5 + 1.3
				and absf(position.y - center.y) <= size.y * 0.5 + 0.6
				and absf(position.z - center.z) <= size.z * 0.5 + 1.8
			):
				damage_cooldown = 3.0
				_damage_building(building_index)
				_destroy_slot(slot, position)
				return
		for target_index in range(targets.size()):
			var target := targets[target_index]
			if target.destroyed:
				continue
			var target_position: Vector3 = target.node.global_position
			var horizontal := Vector2(position.x - target_position.x, position.z - target_position.z)
			var radius := 4.8 if target.kind == "oil_tank" else 4.0
			if horizontal.length() <= radius and absf(position.y - target_position.y) <= 4.0:
				damage_cooldown = 3.0
				_destroy_target(target_index, false)
				_destroy_slot(slot, position)
				return


func _check_cloud_blackening(slot: int, position: Vector3) -> void:
	if bool(blackened_slots[slot]):
		return
	for cloud in pollution_clouds:
		var cloud_position: Vector3 = cloud.node.global_position
		var horizontal := Vector2(position.x - cloud_position.x, position.z - cloud_position.z)
		if horizontal.length() < float(cloud.radius) and position.y < cloud_position.y + 2.0:
			blackened_slots[slot] = true
			_set_drone_blackened(drones[slot])
			return


func _set_drone_blackened(drone: Node3D) -> void:
	var soot := _material(Color("#171a18"), 0.96)
	for child in drone.find_children("*", "MeshInstance3D", true, false):
		(child as MeshInstance3D).material_override = soot


func _damage_building(building_index: int) -> void:
	if building_index < 0 or building_index >= buildings.size() or buildings[building_index].damaged:
		return
	buildings[building_index].damaged = true
	var building := buildings[building_index]
	var collision: StaticBody3D = building.collision
	collision.collision_layer = 0
	collision.collision_mask = 0
	var node: MeshInstance3D = building.node
	var target_y: float = node.position.y - float(building.size.y) * 0.62
	var tween := create_tween()
	tween.set_trans(Tween.TRANS_QUAD)
	tween.set_ease(Tween.EASE_IN)
	tween.tween_property(node, "position:y", target_y, 5.5)


func _update_progress() -> void:
	var progress := elapsed / GameState.RUN_DURATION
	while checkpoint_index < CHECKPOINTS.size() and progress >= CHECKPOINTS[checkpoint_index]:
		checkpoint_index += 1
		state.add_score("checkpoint")
	if elapsed >= near_miss_clock:
		periodic_score_index += 1
		near_miss_clock += 11.5
		state.add_score("collateral" if periodic_score_index % 3 == 0 else "near_miss")
	if elapsed >= GameState.RUN_DURATION:
		_finish_run(true)


func _finish_run(won: bool) -> void:
	if finished:
		return
	finished = true
	state.finish(won)
	run_finished.emit(won)


func _emit_hud() -> void:
	var slots: Array[String] = []
	for index in range(drones.size()):
		if _slot_refilling(index):
			slots.append("REFILL")
		elif drones[index].visible:
			slots.append("READY")
		else:
			slots.append("LOST")
	hud_changed.emit({
		"score": state.score,
		"altitude": roundi(80.0 + formation.position.y * 24.0),
		"progress": minf(1.0, elapsed / GameState.RUN_DURATION),
		"survivors": state.survivors,
		"launches": state.launches_remaining,
		"stations_destroyed": stations_destroyed,
		"stations_total": total_stations,
		"slots": slots,
		"attacks": attacks.size() + pending_targets.size(),
		"queued": pending_targets.size(),
	})
