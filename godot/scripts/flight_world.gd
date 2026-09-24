class_name FlightWorld
extends Node3D

signal hud_changed(data: Dictionary)
signal run_finished(won: bool)

const FlightMathRules = preload("res://scripts/flight_math.gd")
const WebRandomRules = preload("res://scripts/web_random.gd")
const FORWARD_SPEED := 3.05
const FORMATION_OFFSETS := [
	Vector3(0.0, 0.0, 0.0),
	Vector3(-4.4, -0.35, 2.4),
	Vector3(4.4, -0.35, 2.4),
	Vector3(0.0, -0.55, 5.0),
]
const CHECKPOINTS := [0.20, 0.42, 0.66, 0.86]
const AIRCRAFT_PART_OFFSETS := [
	Vector3(0.0, 0.0, -2.35),
	Vector3(0.0, 0.0, 2.25),
	Vector3(-2.9, 0.0, -0.25),
	Vector3(2.9, 0.0, -0.25),
	Vector3(-1.05, 0.05, 1.45),
	Vector3(1.05, 0.05, 1.45),
	Vector3(0.0, -0.28, -0.65),
]
const CITY_FIRST_ROW_Z := 8.0
const CITY_ROW_SPACING := 15.0
const CITY_COLUMNS := [-72.0, -48.0, -24.0, 0.0, 24.0, 48.0, 72.0]
const BUILDING_COLLAPSE_SECONDS := 6.0
const GROUND_DAMAGE_COOLDOWN := 8.0

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
var tank_lids: Array[RigidBody3D] = []
var cross_roads: Array[Node3D] = []
var storm_rain: MultiMeshInstance3D
var storm_drops: Array[Dictionary] = []
var direct_fire_stations := {}
var blackened_slots := [false, false, false, false]
var ground_texture: Texture2D
var wall_textures: Array[Texture2D] = []
var tank_roof_scene: PackedScene
var tank_roof_template: Node3D
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
var city_rng


func setup(game_state: GameState) -> void:
	state = game_state
	rng.seed = state.run_seed
	city_rng = WebRandomRules.new(state.run_seed)
	ground_texture = load("res://assets/textures/texture-ground.jpg")
	wall_textures = [
		load("res://assets/textures/texture-house-wall-10-storeys-white.jpg"),
		load("res://assets/textures/texture-house-wall-11-storeys-white.jpg"),
		load("res://assets/textures/texture-house-wall-15-storeys-white.jpg"),
	]
	tank_roof_scene = load("res://assets/models/oil_tank_roof_blowoff_flat.glb")
	if tank_roof_scene != null:
		tank_roof_template = tank_roof_scene.instantiate() as Node3D
		_curve_tank_roof(tank_roof_template)
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
	if is_instance_valid(tank_roof_template):
		tank_roof_template.free()
	tank_roof_template = null


func _process(_delta: float) -> void:
	if finished:
		return
	_fill_engine_audio()


func _physics_process(delta: float) -> void:
	if finished:
		return
	_spin_propellers(delta)
	elapsed += delta
	damage_cooldown = maxf(0.0, damage_cooldown - delta)
	_update_formation(delta)
	_update_attacks(delta)
	_update_refills(delta)
	_update_missiles(delta)
	_update_pollution(delta)
	_update_storm(delta)
	_update_building_damage(delta)
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
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("#66787b")
	sky_material.sky_horizon_color = Color("#a9b7b1")
	sky_material.sky_curve = 0.22
	sky_material.ground_bottom_color = Color("#4f5d58")
	sky_material.ground_horizon_color = Color("#909f98")
	sky_material.ground_curve = 0.18
	sky_material.sun_angle_max = 7.0
	sky_material.sun_curve = 0.12
	var sky := Sky.new()
	sky.sky_material = sky_material
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.background_energy_multiplier = 0.9
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
	plane.size = Vector2(340.0, 470.0)
	ground.mesh = plane
	ground.position = Vector3(0.0, -3.0, -190.0)
	var ground_material := _material(Color("#b5bab4"), 1.0)
	ground_material.albedo_texture = ground_texture
	ground_material.uv1_scale = Vector3(18.0, 14.0, 1.0)
	ground.material_override = ground_material
	add_child(ground)
	_add_static_collision(ground.position - Vector3(0.0, 0.25, 0.0), Vector3(340.0, 0.5, 470.0))

	_build_storm_field()


func _build_storm_field() -> void:
	if state.reduced_effects or is_instance_valid(storm_rain):
		return
	storm_drops.clear()
	storm_rain = MultiMeshInstance3D.new()
	storm_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var rain_mesh := BoxMesh.new()
	rain_mesh.size = Vector3(0.045, 1.0, 0.045)
	var rain_material := _material(Color(0.78, 0.83, 0.81, 0.3), 0.2)
	rain_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rain_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rain_mesh.material = rain_material
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = rain_mesh
	multi.instance_count = 150
	storm_rain.multimesh = multi
	add_child(storm_rain)

	var weather_rng := RandomNumberGenerator.new()
	weather_rng.seed = state.run_seed ^ 0x53544f524d
	for drop_index in range(multi.instance_count):
		storm_drops.append({
			"position": Vector3(
				weather_rng.randf_range(-47.0, 47.0),
				weather_rng.randf_range(-1.0, 31.0),
				weather_rng.randf_range(-255.0, 25.0)
			),
			"speed": weather_rng.randf_range(10.0, 18.0),
			"length": weather_rng.randf_range(0.55, 1.7),
		})
	_update_storm(0.0)


func set_reduced_effects(enabled: bool) -> void:
	state.reduced_effects = enabled
	if enabled:
		if is_instance_valid(storm_rain):
			storm_rain.visible = false
			storm_rain.queue_free()
		storm_rain = null
		storm_drops.clear()
		for lid in tank_lids:
			if is_instance_valid(lid):
				lid.queue_free()
		tank_lids.clear()
	else:
		_build_storm_field()
	for cloud in pollution_clouds:
		var blobs: Array = cloud.blobs
		for blob_index in range(blobs.size()):
			if is_instance_valid(blobs[blob_index]):
				blobs[blob_index].visible = not enabled or blob_index < 7
		var rain: MultiMeshInstance3D = cloud.rain
		rain.multimesh.visible_instance_count = 28 if enabled else -1


func _update_storm(delta: float) -> void:
	if not is_instance_valid(storm_rain):
		return
	for drop_index in range(storm_drops.size()):
		var drop: Dictionary = storm_drops[drop_index]
		var position: Vector3 = drop.position
		position.y -= float(drop.speed) * delta
		if position.y < -1.0:
			position.y += 32.0
		drop.position = position
		storm_drops[drop_index] = drop
		var basis := Basis.IDENTITY.scaled(Vector3(1.0, float(drop.length), 1.0))
		storm_rain.multimesh.set_instance_transform(drop_index, Transform3D(basis, position))


func _build_city() -> void:
	var cells: Array[Dictionary] = []
	for row in range(28):
		for column in range(CITY_COLUMNS.size()):
			cells.append({
				"x": CITY_COLUMNS[column],
				"z": CITY_FIRST_ROW_Z - float(row) * CITY_ROW_SPACING,
				"row": row,
				"column": column,
				"sort": city_rng.next(),
			})
	cells.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.sort) < float(b.sort))

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
			if floori(float(cell.row) / 10.0) == band:
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
	var upper_colors := [Color("#d94c4c"), Color("#315fbd"), Color("#d7a92f"), Color("#4f8f59")]
	var lower_colors := [Color("#26334d"), Color("#4a382f"), Color("#2f493c"), Color("#4b355b")]
	for building_index in range(building_cells.size()):
		var cell := building_cells[building_index]
		var storey_roll: float = city_rng.next()
		var storeys := 10 if storey_roll < 0.4 else (11 if storey_roll < 0.7 else 15)
		var height := 1.8 + float(storeys) * 1.6
		var size := Vector3(13.4, height, 9.0)
		var person_config := {}
		if building_index % 2 == 0:
			var edge := "player"
			if not is_zero_approx(float(cell.x)):
				edge = "player" if city_rng.next() < 0.5 else "center"
			var jump_options: Array[int] = [2, 3]
			if int(cell.row) >= 4:
				jump_options.append(4)
			var jump_index := mini(floori(city_rng.next() * jump_options.size()), jump_options.size() - 1)
			var jump_delay: float = CITY_ROW_SPACING / FORWARD_SPEED * (0.12 + city_rng.next() * 0.72)
			var upper_index := mini(floori(city_rng.next() * upper_colors.size()), upper_colors.size() - 1)
			var lower_index := mini(floori(city_rng.next() * lower_colors.size()), lower_colors.size() - 1)
			person_config = {
				"edge": edge,
				"jump_ahead": jump_options[jump_index],
				"jump_delay": jump_delay,
				"upper_color": upper_colors[upper_index],
				"lower_color": lower_colors[lower_index],
				"edge_offset": (city_rng.next() - 0.5) * 0.72,
				"has_companions": city_rng.next() < 0.75,
			}
		var building := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = size
		building.mesh = box
		building.position = Vector3(float(cell.x), -3.0 + height * 0.5, float(cell.z))
		building.rotation.y = PI if city_rng.next() > 0.5 else 0.0
		building.material_override = _building_material(Color.WHITE, storeys)
		add_child(building)
		var collision := _add_static_collision(building.position, size)
		collision.rotation.y = building.rotation.y
		collision.set_meta("building_index", building_index)
		var has_station := building_index < station_cells.size()
		var has_person := not person_config.is_empty() and not has_station
		buildings.append({
			"node": building,
			"collision": collision,
			"position": building.position,
			"size": size,
			"row": int(cell.row),
			"damaged": false,
			"damage_elapsed": 0.0,
			"protected": has_station or has_person,
		})
		_add_windows(building, size.x, size.y)
		_add_roof_details(building, size)
		var building_data: Dictionary = buildings[building_index]
		var materials := _collect_building_materials(building)
		var material_bases: Array[Dictionary] = []
		for material in materials:
			material_bases.append({
				"albedo": material.albedo_color,
				"emission": material.emission,
				"emission_energy": material.emission_energy_multiplier,
			})
		building_data.materials = materials
		building_data.material_bases = material_bases
		buildings[building_index] = building_data
		if has_station:
			station_buildings.append(building_index)
		elif has_person:
			_add_rooftop_person(building_index, person_config)

	for cell in tank_cells:
		_create_tank(Vector3(float(cell.x), 1.5, float(cell.z)))
	for building_index in station_buildings:
		_create_station(building_index)
	_build_cross_roads()


func _build_cross_roads() -> void:
	var road_material := _material(Color("#171a19"), 0.9)
	var marker_material := _material(Color("#d9b566"), 0.7)
	marker_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var road_row := 3 + floori(city_rng.next() * 3.0)
	while road_row < 28:
		var road_root := Node3D.new()
		road_root.position.z = CITY_FIRST_ROW_Z - float(road_row) * CITY_ROW_SPACING + 7.5
		add_child(road_root)
		cross_roads.append(road_root)
		var cross_road := MeshInstance3D.new()
		var cross_mesh := PlaneMesh.new()
		cross_mesh.size = Vector2(330.0, 6.0)
		cross_road.mesh = cross_mesh
		cross_road.position.y = -2.94
		cross_road.material_override = road_material
		road_root.add_child(cross_road)
		for marker_index in range(20):
			var marker := MeshInstance3D.new()
			var marker_mesh := PlaneMesh.new()
			marker_mesh.size = Vector2(5.0, 0.14)
			marker.mesh = marker_mesh
			marker.position = Vector3(-152.0 + float(marker_index) * 16.0, -2.88, 0.0)
			marker.material_override = marker_material
			road_root.add_child(marker)
		road_row += 1 + floori(city_rng.next() * 3.0)


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


func _add_rooftop_person(building_index: int, config: Dictionary) -> void:
	var building: Dictionary = buildings[building_index]
	var building_position: Vector3 = building.position
	var building_size: Vector3 = building.size
	var edge: String = config.edge
	var edge_offset: float = config.edge_offset
	var placement: Dictionary = FlightMathRules.rooftop_edge_placement(
		edge, building_position.x, building_size.x, building_size.z, edge_offset
	)
	var offset: Vector2 = placement.offset
	var direction: Vector2 = placement.direction
	var start := building_position + Vector3(offset.x, building_size.y * 0.5 + 1.05, offset.y)
	var person := _make_rooftop_figure(config.upper_color, config.lower_color)
	person.position = start
	person.rotation.y = atan2(direction.x, direction.y)
	add_child(person)
	var helpers: Array[Dictionary] = []
	if bool(config.has_companions):
		var forward := direction.normalized()
		var side := Vector2(-forward.y, forward.x)
		for side_amount in [-0.42, 0.42]:
			var helper_offset: Vector2 = offset - forward * 0.72 + side * side_amount
			var helper_start := building_position + Vector3(helper_offset.x, building_size.y * 0.5 + 1.05, helper_offset.y)
			var helper_target := helper_start
			if edge == "player":
				helper_target.z = building_position.z
			else:
				helper_target.x = building_position.x
			var helper := _make_rooftop_figure(Color("#080908"), Color("#080908"))
			helper.position = helper_start
			helper.rotation.y = person.rotation.y + PI
			add_child(helper)
			helpers.append({"node": helper, "start": helper_start, "target": helper_target})
	rooftop_people.append({
		"node": person,
		"building_index": building_index,
		"phase": "standing",
		"origin": start,
		"direction": direction,
		"velocity": Vector3.ZERO,
		"jump_ahead": int(config.jump_ahead),
		"jump_delay": float(config.jump_delay),
		"window_elapsed": 0.0,
		"phase_elapsed": 0.0,
		"helper_elapsed": 0.0,
		"helpers_active": false,
		"helpers": helpers,
	})


func _make_rooftop_figure(upper: Color, lower: Color) -> Node3D:
	var figure := Node3D.new()
	figure.scale = Vector3.ONE * 0.82
	_add_box(figure, Vector3(0.32, 0.55, 0.2), Vector3(0.0, 0.48, 0.0), upper)
	_add_box(figure, Vector3(0.3, 0.22, 0.2), Vector3(0.0, 0.12, 0.0), lower)
	for side in [-1.0, 1.0]:
		var arm := MeshInstance3D.new()
		var arm_mesh := BoxMesh.new()
		arm_mesh.size = Vector3(0.13, 0.7, 0.13)
		arm.mesh = arm_mesh
		arm.position = Vector3(side * 0.25, 0.48, 0.0)
		arm.rotation.z = side * 0.35
		arm.material_override = _material(upper, 0.8)
		figure.add_child(arm)
		_add_box(figure, Vector3(0.13, 0.7, 0.13), Vector3(side * 0.1, -0.28, 0.0), lower)
	_add_box(figure, Vector3(0.32, 0.32, 0.32), Vector3(0.0, 0.95, 0.0), Color("#d7a078"))
	return figure


func _add_roof_details(building: MeshInstance3D, size: Vector3) -> void:
	_add_box(building, Vector3(size.x + 0.4, 0.36, size.z + 0.4), Vector3(0.0, size.y * 0.5 + 0.18, 0.0), Color("#e1e4df"))
	var roof_blocks := [Vector2(-0.28, -0.24), Vector2(0.3, -0.22), Vector2(-0.3, 0.24), Vector2(0.27, 0.25)]
	for index in range(roof_blocks.size()):
		var offset: Vector2 = roof_blocks[index]
		_add_box(
			building,
			Vector3(1.6, 1.2 + float(index % 2) * 0.35, 1.35),
			Vector3(offset.x * size.x, size.y * 0.5 + 0.78, offset.y * size.z),
			Color("#9ba39e")
		)
	var antenna_positions := [Vector2(-0.23, 0.03), Vector2(0.02, -0.12), Vector2(0.26, 0.1)]
	for index in range(antenna_positions.size()):
		var offset: Vector2 = antenna_positions[index]
		var height := 3.2 + float(index) * 0.75
		var antenna := MeshInstance3D.new()
		var cylinder := CylinderMesh.new()
		cylinder.top_radius = 0.11
		cylinder.bottom_radius = 0.14
		cylinder.height = height
		antenna.mesh = cylinder
		antenna.position = Vector3(offset.x * size.x, size.y * 0.5 + 0.36 + height * 0.5, offset.y * size.z)
		antenna.material_override = _material(Color("#737c77"), 0.58)
		building.add_child(antenna)


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
	body.name = "TankBody"
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 4.3
	cylinder.bottom_radius = 4.3
	cylinder.height = 6.2
	body.mesh = cylinder
	body.position.y = -1.4
	var body_material := _material(Color("#b7b9ae"), 0.48)
	body_material.metallic = 0.58
	body.material_override = body_material
	area.add_child(body)
	var roof := _make_tank_roof()
	roof.name = "TankRoof"
	roof.position.y = 1.93
	area.add_child(roof)
	var shape := CollisionShape3D.new()
	var cylinder_shape := CylinderShape3D.new()
	cylinder_shape.radius = 4.3
	cylinder_shape.height = 6.2
	shape.shape = cylinder_shape
	shape.position.y = -1.4
	area.add_child(shape)
	_add_target_indicator(area, 5.35, 3.03)
	_register_target(area, "oil_tank")
	var target_index := targets.size() - 1
	targets[target_index].body = body
	targets[target_index].destroyable_visuals = [roof]


func _create_station(building_index: int) -> void:
	var building: Dictionary = buildings[building_index]
	var building_node: MeshInstance3D = building.node
	var area := Area3D.new()
	area.position = Vector3(0.0, float(building.size.y) * 0.5 + 0.42, 0.0)
	var pedestal := MeshInstance3D.new()
	var pedestal_mesh := CylinderMesh.new()
	pedestal_mesh.top_radius = 2.35
	pedestal_mesh.bottom_radius = 2.7
	pedestal_mesh.height = 5.4
	pedestal_mesh.radial_segments = 12
	pedestal.mesh = pedestal_mesh
	pedestal.position.y = -2.3
	var pedestal_material := _material(Color("#687361"), 0.72)
	pedestal_material.metallic = 0.28
	pedestal.material_override = pedestal_material
	area.add_child(pedestal)
	var base := MeshInstance3D.new()
	base.name = "StationBase"
	var base_mesh := CylinderMesh.new()
	base_mesh.top_radius = 3.3
	base_mesh.bottom_radius = 3.8
	base_mesh.height = 0.8
	base_mesh.radial_segments = 10
	base.mesh = base_mesh
	base.material_override = _material(Color("#596451"), 0.82)
	area.add_child(base)
	var equipment := MeshInstance3D.new()
	var equipment_mesh := BoxMesh.new()
	equipment_mesh.size = Vector3(3.2, 1.3, 3.8)
	equipment.mesh = equipment_mesh
	equipment.position.y = 1.0
	var equipment_material := _material(Color("#75806c"), 0.64)
	equipment_material.metallic = 0.35
	equipment.material_override = equipment_material
	area.add_child(equipment)
	var launcher := Node3D.new()
	launcher.name = "LauncherTubes"
	launcher.position.y = 2.25
	launcher.rotation.x = 0.52
	area.add_child(launcher)
	for tube_x in [-0.7, 0.7]:
		var tube := MeshInstance3D.new()
		var tube_mesh := CylinderMesh.new()
		tube_mesh.top_radius = 0.22
		tube_mesh.bottom_radius = 0.3
		tube_mesh.height = 3.8
		tube_mesh.radial_segments = 8
		tube.mesh = tube_mesh
		tube.position.x = tube_x
		var tube_material := _material(Color("#d4d0b4"), 0.42)
		tube_material.metallic = 0.52
		tube.material_override = tube_material
		launcher.add_child(tube)
	var flare := MeshInstance3D.new()
	var flare_mesh := BoxMesh.new()
	flare_mesh.size = Vector3(0.8, 0.8, 0.8)
	flare.mesh = flare_mesh
	flare.position = Vector3(0.0, 2.2, -1.6)
	var flare_material := _material(Color("#ffd84a"), 0.35, Color("#ffd84a"))
	flare_material.emission_energy_multiplier = 1.15
	flare.material_override = flare_material
	area.add_child(flare)
	var shape := CollisionShape3D.new()
	var box_shape := BoxShape3D.new()
	box_shape.size = Vector3(7.6, 9.8, 7.6)
	shape.shape = box_shape
	shape.position.y = -0.1
	area.add_child(shape)
	_add_target_indicator(area, 4.2, 4.2)
	building_node.add_child(area)
	_register_target(area, "air_defense", building_index)
	var target_index := targets.size() - 1
	targets[target_index].body = base
	targets[target_index].destroyable_visuals = [pedestal, equipment, launcher, flare]
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
	if is_instance_valid(tank_roof_template):
		var imported := tank_roof_template.duplicate() as Node3D
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


func _curve_tank_roof(root: Node3D) -> void:
	var mesh_instances: Array[MeshInstance3D] = []
	if root is MeshInstance3D:
		mesh_instances.append(root as MeshInstance3D)
	for child in root.find_children("*", "MeshInstance3D", true, false):
		mesh_instances.append(child as MeshInstance3D)
	for mesh_instance in mesh_instances:
		var source_mesh := mesh_instance.mesh
		if source_mesh == null:
			continue
		var curved_mesh := ArrayMesh.new()
		for surface_index in range(source_mesh.get_surface_count()):
			var arrays := source_mesh.surface_get_arrays(surface_index)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			for vertex_index in range(vertices.size()):
				var vertex := vertices[vertex_index]
				var radius_squared := (vertex.x * vertex.x + vertex.y * vertex.y) / 16.0
				if radius_squared < 1.0:
					vertex.z += 0.8 * sqrt(1.0 - radius_squared)
					vertices[vertex_index] = vertex
			arrays[Mesh.ARRAY_VERTEX] = vertices
			arrays[Mesh.ARRAY_NORMAL] = _mesh_vertex_normals(vertices, arrays[Mesh.ARRAY_INDEX])
			curved_mesh.add_surface_from_arrays(source_mesh.surface_get_primitive_type(surface_index), arrays)
			curved_mesh.surface_set_material(surface_index, source_mesh.surface_get_material(surface_index))
		mesh_instance.mesh = curved_mesh


func _mesh_vertex_normals(vertices: PackedVector3Array, indices: PackedInt32Array) -> PackedVector3Array:
	var normals := PackedVector3Array()
	normals.resize(vertices.size())
	for vertex_index in range(normals.size()):
		normals[vertex_index] = Vector3.ZERO
	var triangle_vertex_count := indices.size() if not indices.is_empty() else vertices.size()
	for face_start in range(0, triangle_vertex_count - 2, 3):
		var first := indices[face_start] if not indices.is_empty() else face_start
		var second := indices[face_start + 1] if not indices.is_empty() else face_start + 1
		var third := indices[face_start + 2] if not indices.is_empty() else face_start + 2
		var normal := (vertices[second] - vertices[first]).cross(vertices[third] - vertices[first])
		if normal.length_squared() <= 0.000001:
			continue
		normals[first] += normal
		normals[second] += normal
		normals[third] += normal
	for vertex_index in range(normals.size()):
		normals[vertex_index] = normals[vertex_index].normalized()
	return normals


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
	formation.position = Vector3(0.0, 5.0, CITY_FIRST_ROW_Z)
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


func _building_material(color: Color, storeys: int) -> StandardMaterial3D:
	var material := _material(color.lightened(0.24), 0.9)
	var texture_index := 0 if storeys == 10 else (1 if storeys == 11 else 2)
	if texture_index < wall_textures.size():
		material.albedo_texture = wall_textures[texture_index]
		material.uv1_scale = Vector3(1.0, maxf(1.0, float(storeys) / 9.0), 1.0)
	return material


func _collect_building_materials(building: MeshInstance3D) -> Array[StandardMaterial3D]:
	var materials: Array[StandardMaterial3D] = []
	if building.material_override is StandardMaterial3D:
		materials.append(building.material_override as StandardMaterial3D)
	for child in building.find_children("*", "", true, false):
		if child is MeshInstance3D:
			var mesh_instance := child as MeshInstance3D
			if mesh_instance.material_override is StandardMaterial3D:
				materials.append(mesh_instance.material_override as StandardMaterial3D)
		elif child is MultiMeshInstance3D:
			var multi_instance := child as MultiMeshInstance3D
			if (
				multi_instance.multimesh != null
				and multi_instance.multimesh.mesh != null
				and multi_instance.multimesh.mesh.material is StandardMaterial3D
			):
				materials.append(multi_instance.multimesh.mesh.material as StandardMaterial3D)
	return materials


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
	var start := attack_drone.global_position
	var target_position: Vector3 = target.node.global_position
	var arc_height := FlightMathRules.required_flight_arc(
		start,
		target_position,
		buildings,
		int(target.building_index)
	)
	attacks.append({
		"node": attack_drone,
		"target_index": target_index,
		"start": start,
		"progress": 0.0,
		"age": 0.0,
		"arc_height": arc_height,
		"blackened": bool(blackened_slots[slot]),
	})
	if bool(request.replacement_available):
		blackened_slots[slot] = false
		var replacement := _make_drone()
		add_child(replacement)
		replacement.global_position = formation.to_global(FORMATION_OFFSETS[slot] + Vector3(0.0, -1.5, 38.0 + slot * 3.0))
		refills.append({"slot": slot, "node": replacement, "blackened": false})
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
		attack.age = float(attack.age) + delta
		var target_position: Vector3 = target.node.global_position
		var distance := maxf(1.0, Vector3(attack.start).distance_to(target_position))
		var speed := minf(30.0, FORWARD_SPEED + float(attack.age) * 4.5)
		attack.progress = minf(1.0, float(attack.progress) + speed * delta / distance)
		var t: float = float(attack.progress)
		var position := FlightMathRules.point_on_flight_arc(
			Vector3(attack.start),
			target_position,
			t,
			float(attack.arc_height)
		)
		attack.node.global_position = position
		var look_position := FlightMathRules.point_on_flight_arc(
			Vector3(attack.start),
			target_position,
			minf(1.0, t + 0.015),
			float(attack.arc_height)
		)
		if position.distance_squared_to(look_position) > 0.0001:
			attack.node.look_at(look_position, Vector3.UP)
		var parts := _aircraft_parts(attack.node)
		if not bool(attack.blackened) and _is_under_pollution(parts):
			attack.blackened = true
			_set_drone_blackened(attack.node)
		if t > 0.04:
			var structure_hit := _find_structure_hit(parts, int(attack.target_index))
			if not structure_hit.is_empty():
				var intended_target := int(attack.target_index)
				if structure_hit.kind == "target" and int(structure_hit.index) == intended_target:
					_destroy_target(intended_target)
				else:
					_apply_structure_hit(structure_hit, true)
					targets[intended_target].targeted = false
					_set_target_indicator(intended_target, false)
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
		var refill := refills[index]
		var slot := int(refill.slot)
		var replacement: Node3D = refill.node
		var target_position := formation.to_global(FORMATION_OFFSETS[slot])
		var distance := replacement.global_position.distance_to(target_position)
		if distance > 0.0001:
			var travel := FlightMathRules.replacement_travel_distance(distance, delta)
			replacement.global_position += replacement.global_position.direction_to(target_position) * travel
		replacement.global_basis = formation.global_basis
		var parts := _aircraft_parts(replacement)
		if not bool(refill.blackened) and _is_under_pollution(parts):
			refill.blackened = true
			_set_drone_blackened(replacement)
		var structure_hit := _find_structure_hit(parts)
		if not structure_hit.is_empty():
			_apply_structure_hit(structure_hit, false)
			_spawn_explosion(replacement.global_position)
			replacement.queue_free()
			refills.remove_at(index)
			state.lose_drone()
			if state.survivors <= 0:
				_finish_run(false)
			continue
		refills[index] = refill
		if replacement.global_position.distance_to(target_position) < FlightMathRules.REPLACEMENT_JOIN_DISTANCE:
			replacement.queue_free()
			_replace_formation_drone(slot, bool(refill.blackened))
			refills.remove_at(index)
	_dispatch_pending()


func _aircraft_parts(drone: Node3D) -> Array[Vector3]:
	var parts: Array[Vector3] = []
	var pitch := Basis(Vector3.RIGHT, 0.08)
	for offset in AIRCRAFT_PART_OFFSETS:
		parts.append(drone.to_global(pitch * offset))
	return parts


func _find_structure_hit(parts: Array[Vector3], intended_target_index := -1) -> Dictionary:
	var intended_building := -1
	if intended_target_index >= 0 and intended_target_index < targets.size():
		intended_building = int(targets[intended_target_index].building_index)
	for position in parts:
		var building_index := _find_building_hit(position, intended_building, 0.12)
		if building_index >= 0:
			return {"kind": "building", "index": building_index}
		for target_index in range(targets.size()):
			if targets[target_index].destroyed:
				continue
			var target := targets[target_index]
			var target_position: Vector3 = target.node.global_position
			var horizontal := Vector2(position.x - target_position.x, position.z - target_position.z)
			var radius := 4.5 if target.kind == "oil_tank" else 4.0
			var vertical_hit := (
				(position.y >= -0.3 and position.y <= 4.0)
				if target.kind == "oil_tank"
				else (position.y >= target_position.y - 5.0 and position.y <= target_position.y + 4.8)
			)
			if horizontal.length() <= radius and vertical_hit:
				return {"kind": "target", "index": target_index}
		for lid_index in range(tank_lids.size() - 1, -1, -1):
			if not is_instance_valid(tank_lids[lid_index]):
				tank_lids.remove_at(lid_index)
			elif position.distance_to(tank_lids[lid_index].global_position) < 4.4:
				return {"kind": "lid", "index": lid_index}
	return {}


func _find_building_hit(position: Vector3, excluded_index := -1, radius := 0.8) -> int:
	for building_index in range(buildings.size()):
		if building_index == excluded_index:
			continue
		var building := buildings[building_index]
		var center: Vector3 = building.collision.position
		var size: Vector3 = building.size
		var shape_node := building.collision.get_child(0) as CollisionShape3D
		if shape_node != null and shape_node.shape is BoxShape3D:
			size = (shape_node.shape as BoxShape3D).size
		if (
			absf(position.x - center.x) <= size.x * 0.5 + radius
			and absf(position.y - center.y) <= size.y * 0.5 + radius
			and absf(position.z - center.z) <= size.z * 0.5 + radius
		):
			return building_index
	return -1


func _apply_structure_hit(hit: Dictionary, award_score := true) -> void:
	if hit.kind == "building":
		_damage_building(int(hit.index))
	elif hit.kind == "target":
		_destroy_target(int(hit.index), award_score)


func _replace_formation_drone(slot: int, blackened: bool) -> void:
	if is_instance_valid(drones[slot]):
		drones[slot].queue_free()
	var replacement := _make_drone(blackened)
	replacement.position = FORMATION_OFFSETS[slot]
	formation.add_child(replacement)
	drones[slot] = replacement
	blackened_slots[slot] = blackened


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
	if is_instance_valid(target.indicator):
		target.indicator.visible = false
	if target.has("body") and is_instance_valid(target.body):
		target.body.material_override = _material(Color("#4c4b45") if target.kind == "oil_tank" else Color("#292723"), 0.95)
	for visual in target.get("destroyable_visuals", []):
		if is_instance_valid(visual):
			visual.visible = false
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
	var explosion := Node3D.new()
	explosion.position = position
	add_child(explosion)
	var materials: Array[StandardMaterial3D] = []
	for layer in range(2):
		var flash := MeshInstance3D.new()
		var shape := SphereMesh.new()
		shape.radius = 1.2
		shape.height = 2.4
		shape.radial_segments = 8
		shape.rings = 4
		flash.mesh = shape
		flash.scale = Vector3.ONE * (1.0 if layer == 0 else 0.62)
		var color := Color("#ffb12b") if layer == 0 else Color("#fff0b3")
		var material := _material(color, 0.25, color)
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		flash.material_override = material
		explosion.add_child(flash)
		materials.append(material)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(explosion, "scale", Vector3.ONE * (4.0 if state.reduced_effects else 6.0), 1.5)
	tween.tween_property(explosion, "rotation:y", 2.7, 1.5)
	for material in materials:
		tween.tween_property(material, "albedo_color:a", 0.0, 1.5)
		tween.tween_property(material, "emission:a", 0.0, 1.5)
	tween.chain().tween_callback(explosion.queue_free)


func _spawn_tank_aftermath(position: Vector3) -> void:
	_spawn_pollution_cloud(position)
	if state.reduced_effects:
		return
	var lid := RigidBody3D.new()
	lid.mass = 2.0
	lid.physics_material_override = PhysicsMaterial.new()
	lid.physics_material_override.bounce = 0.42
	lid.contact_monitor = true
	lid.max_contacts_reported = 12
	lid.position = position + Vector3(0.0, 1.93, 0.0)
	lid.linear_damp = 0.12
	lid.angular_damp = 0.08
	lid.add_child(_make_tank_roof())
	var shape_node := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 4.25
	shape.height = 0.5
	shape_node.shape = shape
	lid.add_child(shape_node)
	add_child(lid)
	tank_lids.append(lid)
	lid.body_entered.connect(_on_lid_body_entered.bind(lid))
	lid.linear_velocity = Vector3(-7.0 if position.x > 0.0 else 7.0, 24.0, 3.0)
	lid.angular_velocity = Vector3(8.0, 4.0, 12.0)
	get_tree().create_timer(14.0).timeout.connect(lid.queue_free)


func _on_lid_body_entered(body: Node, lid: RigidBody3D) -> void:
	if not is_instance_valid(lid):
		return
	if not body.has_meta("building_index"):
		return
	var building_index := int(body.get_meta("building_index"))
	var building_impacts: Dictionary = lid.get_meta("building_impacts", {})
	if building_impacts.has(building_index):
		return
	building_impacts[building_index] = true
	lid.set_meta("building_impacts", building_impacts)
	_damage_building(building_index)
	_spawn_explosion(lid.global_position)


func _spawn_pollution_cloud(position: Vector3) -> void:
	var cloud_root := Node3D.new()
	cloud_root.position = Vector3(position.x, 0.0, position.z)
	add_child(cloud_root)
	var cloud := Node3D.new()
	cloud.position.y = 23.0
	cloud.scale = Vector3.ONE * 0.15
	cloud_root.add_child(cloud)
	var blobs: Array[MeshInstance3D] = []
	for blob_index in range(14):
		var blob := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = 1.0
		sphere.height = 2.0
		blob.mesh = sphere
		blob.position = Vector3(
			rng.randf_range(-8.5, 8.5),
			rng.randf_range(-2.25, 2.25),
			rng.randf_range(-6.5, 6.5)
		)
		blob.scale = Vector3(
			rng.randf_range(3.8, 8.6),
			rng.randf_range(1.7, 4.3),
			rng.randf_range(3.2, 7.6)
		)
		var smoke := _material(Color(0.028, 0.035, 0.028, 0.9), 1.0, Color("#020302"))
		smoke.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		smoke.emission_energy_multiplier = 0.25
		blob.material_override = smoke
		blob.visible = not state.reduced_effects or blob_index < 7
		cloud.add_child(blob)
		blobs.append(blob)
	var rain := MultiMeshInstance3D.new()
	var rain_mesh := CylinderMesh.new()
	rain_mesh.top_radius = 0.025
	rain_mesh.bottom_radius = 0.045
	rain_mesh.height = 1.0
	var rain_material := _material(Color(0.035, 0.043, 0.035, 0.78), 1.0)
	rain_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rain_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rain_mesh.material = rain_material
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = rain_mesh
	var drop_count := 80
	multi.instance_count = drop_count
	multi.visible_instance_count = 28 if state.reduced_effects else -1
	rain.multimesh = multi
	cloud_root.add_child(rain)
	var drops: Array[Dictionary] = []
	for _index in range(drop_count):
		drops.append({
			"x": rng.randf_range(-9.0, 9.0),
			"z": rng.randf_range(-7.0, 7.0),
			"phase": rng.randf_range(0.0, 22.0),
			"speed": rng.randf_range(8.0, 19.0),
			"length": rng.randf_range(0.5, 1.7),
		})
	pollution_clouds.append({
		"root": cloud_root,
		"node": cloud,
		"age": 0.0,
		"radius": 11.0,
		"blobs": blobs,
		"rain": rain,
		"drops": drops,
	})


func _update_pollution(delta: float) -> void:
	for index in range(pollution_clouds.size()):
		var cloud := pollution_clouds[index]
		cloud.age = float(cloud.age) + delta
		var growth := minf(1.0, float(cloud.age) / 4.0)
		cloud.node.scale = Vector3.ONE * (0.15 + growth * 0.85)
		cloud.node.position.x += delta * 0.38
		var multi: MultiMesh = cloud.rain.multimesh
		for drop_index in range(cloud.drops.size()):
			var drop: Dictionary = cloud.drops[drop_index]
			var drop_y := 21.0 - fposmod(float(cloud.age) * float(drop.speed) + float(drop.phase), 25.0)
			var basis := Basis.IDENTITY.scaled(Vector3(1.0, float(drop.length), 1.0))
			multi.set_instance_transform(drop_index, Transform3D(basis, Vector3(float(drop.x), drop_y, float(drop.z))))
		pollution_clouds[index] = cloud


func _update_rooftop_people(delta: float) -> void:
	var fleet_row := maxi(0, floori((CITY_FIRST_ROW_Z - formation.global_position.z) / CITY_ROW_SPACING))
	for index in range(rooftop_people.size()):
		var person := rooftop_people[index]
		if not is_instance_valid(person.node):
			continue
		var building: Dictionary = buildings[int(person.building_index)]
		if person.phase == "standing":
			if building.damaged:
				person.phase = "collapse"
				person.phase_elapsed = 0.0
			elif FlightMathRules.person_jump_window(int(building.row), fleet_row, int(person.jump_ahead)):
				person.window_elapsed = float(person.window_elapsed) + delta
				if float(person.window_elapsed) >= float(person.jump_delay):
					person.phase = "jumping"
					person.phase_elapsed = 0.0
					var direction: Vector2 = person.direction
					person.velocity = Vector3(direction.x, 1.7, direction.y)
					person.helpers_active = true
		if person.phase == "jumping":
			var velocity: Vector3 = person.velocity
			velocity.y -= 8.5 * delta
			person.velocity = velocity
			person.node.position += velocity * delta
			person.node.rotation.x += delta * 1.8
			person.phase_elapsed = float(person.phase_elapsed) + delta
			if person.node.position.y <= -2.78:
				person.node.position.y = -2.78
				person.node.rotation.z = PI * 0.5
				person.phase = "lying"
		elif person.phase == "collapse":
			person.phase_elapsed = float(person.phase_elapsed) + delta
			var progress := clampf(float(person.phase_elapsed) / 6.0, 0.0, 1.0)
			person.node.position.y = lerpf(Vector3(person.origin).y, -2.78, progress)
			person.node.rotation.x = progress * 0.9
			if progress >= 1.0:
				person.node.rotation.z = PI * 0.5
				person.phase = "lying"
		if person.helpers_active:
			_update_rooftop_helpers(person, delta)
		elif building.damaged:
			for helper in person.helpers:
				if is_instance_valid(helper.node):
					helper.node.visible = false
		rooftop_people[index] = person


func _update_rooftop_helpers(person: Dictionary, delta: float) -> void:
	person.helper_elapsed = float(person.helper_elapsed) + delta
	var elapsed_time: float = person.helper_elapsed
	var retreat_progress := clampf(elapsed_time / 3.0, 0.0, 1.0)
	retreat_progress = retreat_progress * retreat_progress * (3.0 - 2.0 * retreat_progress)
	for helper in person.helpers:
		if not is_instance_valid(helper.node) or not helper.node.visible:
			continue
		helper.node.position = Vector3(helper.start).lerp(Vector3(helper.target), retreat_progress)
		if elapsed_time > 3.0:
			var sink_progress := clampf((elapsed_time - 3.0) / 0.65, 0.0, 1.0)
			sink_progress = sink_progress * sink_progress * (3.0 - 2.0 * sink_progress)
			helper.node.position.y -= sink_progress * 2.4
			if sink_progress >= 1.0:
				helper.node.visible = false


func _update_missiles(delta: float) -> void:
	var available_defenses := _available_defenses()
	var direct_defenses: Array[Dictionary] = []
	for defense in available_defenses:
		if formation.global_position.y >= defense.target.node.global_position.y:
			direct_defenses.append(defense)
			var target_index := int(defense.index)
			if not direct_fire_stations.has(target_index):
				direct_fire_stations[target_index] = true
				_launch_defensive_missile(defense.target, true)
	missile_clock += delta
	if missile_clock >= 1.35 / 1.3 and not available_defenses.is_empty():
		missile_clock = 0.0
		var launch_pool := direct_defenses if not direct_defenses.is_empty() else available_defenses
		var defense: Dictionary = launch_pool[rng.randi_range(0, launch_pool.size() - 1)]
		_launch_defensive_missile(defense.target, not direct_defenses.is_empty())
	for index in range(missiles.size() - 1, -1, -1):
		var missile := missiles[index]
		missile.progress = float(missile.progress) + minf(delta, 0.05) / float(missile.duration)
		var t: float = minf(1.0, missile.progress)
		var position := _cubic_bezier(
			Vector3(missile.start),
			Vector3(missile.control_a),
			Vector3(missile.control_b),
			Vector3(missile.end),
			t
		)
		var envelope := sin(t * PI)
		position.x += sin(t * PI * (5.0 + float(missile.wobble))) * envelope * (1.4 + float(missile.wobble) * 0.25)
		position.y += sin(t * PI * (8.0 + float(missile.wobble))) * envelope * 0.55
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
		var hit_slot := _missile_hit_slot(Vector3(missile.previous_position), position)
		missile.previous_position = position
		missiles[index] = missile
		if hit_slot >= 0:
			_destroy_slot(hit_slot, position)
			missile.node.queue_free()
			missiles.remove_at(index)
		elif t >= 1.0:
			if not missile.impact.is_empty():
				_apply_missile_impact(missile.impact)
			_spawn_explosion(position)
			missile.node.queue_free()
			missiles.remove_at(index)


func _available_defenses() -> Array[Dictionary]:
	var available: Array[Dictionary] = []
	for target_index in range(targets.size()):
		var target := targets[target_index]
		if target.kind == "air_defense" and not target.destroyed:
			var dz: float = target.node.global_position.z - formation.global_position.z
			if absf(dz) < 75.0:
				available.append({"index": target_index, "target": target})
	return available


func _launch_defensive_missile(station: Dictionary, direct: bool) -> void:
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
	missile_node.global_position = station.node.global_position + Vector3(0.0, 3.6, 0.0)
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
		"wobble": rng.randf_range(0.0, 2.4),
		"impact": impact,
		"previous_position": start,
	})


func _missile_hit_slot(start: Vector3, end: Vector3) -> int:
	for slot in range(drones.size()):
		if not drones[slot].visible or _slot_refilling(slot):
			continue
		for part in _aircraft_parts(drones[slot]):
			if FlightMathRules.segment_point_distance_squared(start, end, part) <= 0.85 * 0.85:
				return slot
	return -1


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
				"position": target.node.global_position + Vector3(0.0, 2.2, 0.0),
			})
	for building_index in range(buildings.size()):
		var building := buildings[building_index]
		if bool(building.get("protected", false)):
			continue
		var shape_node := building.collision.get_child(0) as CollisionShape3D
		var exposed_height: float = float(building.size.y)
		if shape_node != null and shape_node.shape is BoxShape3D:
			exposed_height = (shape_node.shape as BoxShape3D).size.y
		candidates.append({
			"kind": "building",
			"index": building_index,
			"position": Vector3(building.collision.position) + Vector3(0.0, exposed_height * 0.5, 0.0),
		})
	if candidates.is_empty():
		return {}
	var visible_candidates: Array[Dictionary] = []
	for candidate in candidates:
		if absf(float(candidate.position.z) - formation.global_position.z) < 75.0:
			visible_candidates.append(candidate)
	var impact_pool := visible_candidates if not visible_candidates.is_empty() else candidates
	return impact_pool[rng.randi_range(0, impact_pool.size() - 1)]


func _apply_missile_impact(impact: Dictionary) -> void:
	if impact.kind == "building":
		_damage_building(int(impact.index))
	else:
		_destroy_target(int(impact.index), false)


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
		var parts := _aircraft_parts(drones[slot])
		if not bool(blackened_slots[slot]) and _is_under_pollution(parts):
			blackened_slots[slot] = true
			_set_drone_blackened(drones[slot])
		if damage_cooldown > 0.0:
			continue
		if position.y <= 0.75:
			damage_cooldown = GROUND_DAMAGE_COOLDOWN
			_destroy_slot(slot, position)
			return
		var structure_hit := _find_structure_hit(parts)
		if not structure_hit.is_empty():
			damage_cooldown = 3.0
			_apply_structure_hit(structure_hit, false)
			_destroy_slot(slot, position)
			return


func _is_under_pollution(parts: Array[Vector3]) -> bool:
	for cloud in pollution_clouds:
		if not is_instance_valid(cloud.node):
			continue
		var cloud_position: Vector3 = cloud.node.global_position
		for position in parts:
			var horizontal := Vector2(position.x - cloud_position.x, position.z - cloud_position.z)
			if horizontal.length() < float(cloud.radius) and position.y < cloud_position.y:
				return true
	return false


func _set_drone_blackened(drone: Node3D) -> void:
	var soot := _material(Color("#171a18"), 0.96)
	for child in drone.find_children("*", "MeshInstance3D", true, false):
		(child as MeshInstance3D).material_override = soot


func _damage_building(building_index: int) -> void:
	if building_index < 0 or building_index >= buildings.size() or buildings[building_index].damaged:
		return
	var building := buildings[building_index]
	building.damaged = true
	building.damage_elapsed = 0.0
	buildings[building_index] = building


func _update_building_damage(delta: float) -> void:
	for building_index in range(buildings.size()):
		var building: Dictionary = buildings[building_index]
		if not bool(building.damaged):
			continue
		building.damage_elapsed = minf(
			BUILDING_COLLAPSE_SECONDS,
			float(building.damage_elapsed) + delta
		)
		var progress: float = float(building.damage_elapsed) / BUILDING_COLLAPSE_SECONDS
		var original_position: Vector3 = building.position
		var original_size: Vector3 = building.size
		var node := building.node as MeshInstance3D
		node.position = original_position - Vector3(0.0, original_size.y * (2.0 / 3.0) * progress, 0.0)

		var collision := building.collision as StaticBody3D
		var remaining_height := lerpf(original_size.y, original_size.y / 3.0, progress)
		collision.position = Vector3(
			original_position.x,
			-3.0 + remaining_height * 0.5,
			original_position.z
		)
		var shape_node := collision.get_child(0) as CollisionShape3D
		if shape_node != null and shape_node.shape is BoxShape3D:
			var shape := shape_node.shape as BoxShape3D
			shape.size = Vector3(original_size.x, remaining_height, original_size.z)

		var materials: Array = building.materials
		var material_bases: Array = building.material_bases
		for material_index in range(materials.size()):
			var material := materials[material_index] as StandardMaterial3D
			var base: Dictionary = material_bases[material_index]
			material.albedo_color = Color(base.albedo).lerp(Color("#080908"), progress * 0.88)
			if material.emission_enabled:
				material.emission = Color(base.emission).lerp(Color("#010201"), progress)
				material.emission_energy_multiplier = lerpf(float(base.emission_energy), 0.04, progress)
		buildings[building_index] = building


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
