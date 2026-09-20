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

var state: GameState
var formation: Node3D
var camera: Camera3D
var drones: Array[Node3D] = []
var targets: Array[Dictionary] = []
var attacks: Array[Dictionary] = []
var missiles: Array[Dictionary] = []
var refills: Array[Dictionary] = []
var elapsed := 0.0
var checkpoint_index := 0
var missile_clock := 0.0
var hud_clock := 0.0
var stations_destroyed := 0
var total_stations := 0
var finished := false
var damage_cooldown := 0.0
var rng := RandomNumberGenerator.new()


func setup(game_state: GameState) -> void:
	state = game_state
	rng.seed = int(Time.get_unix_time_from_system())
	_build_environment()
	_build_city()
	_build_formation()
	_emit_hud()


func _process(delta: float) -> void:
	if finished:
		return
	elapsed += delta
	damage_cooldown = maxf(0.0, damage_cooldown - delta)
	_update_formation(delta)
	_update_attacks(delta)
	_update_refills(delta)
	_update_missiles(delta)
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
	ground.material_override = _material(Color("#5d6657"), 0.95)
	add_child(ground)

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
	var columns := [-58.0, -40.0, -22.0, 22.0, 40.0, 58.0]
	for row in range(25):
		var z := -float(row) * 18.0
		for column in range(columns.size()):
			if rng.randf() < 0.50:
				continue
			var height := rng.randf_range(12.0, 25.0)
			var width := rng.randf_range(9.0, 14.0)
			var building := MeshInstance3D.new()
			var box := BoxMesh.new()
			box.size = Vector3(width, height, rng.randf_range(8.0, 12.0))
			building.mesh = box
			building.position = Vector3(columns[column], -3.0 + height * 0.5, z)
			building.material_override = _material(colors[rng.randi_range(0, colors.size() - 1)], 0.88)
			add_child(building)
			_add_windows(building, width, height)

		if row % 3 == 1:
			_create_tank(Vector3(-14.0 if row % 2 else 14.0, -1.1, z - 4.0))
		if row % 4 == 2:
			_create_station(Vector3(28.0 if row % 8 == 2 else -28.0, 10.5, z))


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
	var shape := CollisionShape3D.new()
	var cylinder_shape := CylinderShape3D.new()
	cylinder_shape.radius = 3.8
	cylinder_shape.height = 4.2
	shape.shape = cylinder_shape
	area.add_child(shape)
	_register_target(area, "oil_tank")


func _create_station(position: Vector3) -> void:
	var area := Area3D.new()
	area.position = position
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
	_register_target(area, "air_defense")
	total_stations += 1


func _register_target(area: Area3D, kind: String) -> void:
	var index := targets.size()
	area.set_meta("target_index", index)
	area.collision_layer = 2
	area.collision_mask = 0
	add_child(area)
	targets.append({"node": area, "kind": kind, "destroyed": false, "targeted": false})


func _build_formation() -> void:
	formation = Node3D.new()
	formation.position = Vector3(0.0, 17.0, 12.0)
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
	camera.position = formation.position + Vector3(0.0, 9.0, 18.0)
	add_child(camera)
	camera.look_at(formation.position + Vector3(0.0, 0.0, -10.0))


func _make_drone(blackened := false) -> Node3D:
	var drone := Node3D.new()
	var dark := Color("#1b211e") if blackened else Color("#d2d0bb")
	var blue := Color("#315fbd") if not blackened else dark
	var yellow := Color("#d7a92f") if not blackened else dark
	_add_box(drone, Vector3(0.72, 0.30, 3.2), Vector3.ZERO, dark)
	_add_box(drone, Vector3(5.8, 0.12, 0.76), Vector3(0.0, 0.0, -0.35), blue)
	_add_box(drone, Vector3(1.9, 0.15, 0.62), Vector3(0.0, 0.12, 1.18), yellow)
	_add_box(drone, Vector3(0.12, 0.95, 0.68), Vector3(0.0, 0.42, 1.12), dark)
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


func _update_formation(delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var keyboard := Vector2.ZERO
	if Input.is_key_pressed(KEY_A): keyboard.x -= 1.0
	if Input.is_key_pressed(KEY_D): keyboard.x += 1.0
	if Input.is_key_pressed(KEY_W): keyboard.y -= 1.0
	if Input.is_key_pressed(KEY_S): keyboard.y += 1.0
	if keyboard.length_squared() > direction.length_squared():
		direction = keyboard.normalized()
	formation.position.x = clampf(formation.position.x + direction.x * 18.0 * delta, -66.0, 66.0)
	formation.position.y = clampf(formation.position.y - direction.y * 10.0 * delta, 5.5, 34.0)
	formation.position.z -= FORWARD_SPEED * delta
	formation.rotation.z = lerpf(formation.rotation.z, -direction.x * 0.16, delta * 4.0)
	formation.rotation.x = lerpf(formation.rotation.x, direction.y * 0.08, delta * 4.0)


func _update_camera(delta: float) -> void:
	var desired := formation.position + Vector3(0.0, 9.0, 18.0)
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
	var slot := _available_slot()
	if slot < 0:
		return
	var launch := state.launch_drone()
	if not launch.accepted:
		return
	targets[target_index].targeted = true
	drones[slot].visible = false
	var attack_drone := _make_drone()
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
	if launch.replacement_available:
		refills.append({"slot": slot, "time": 3.2})
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
		attacks[index] = attack
		if t >= 1.0:
			_destroy_target(int(attack.target_index))
			attack.node.queue_free()
			attacks.remove_at(index)


func _update_refills(delta: float) -> void:
	for index in range(refills.size() - 1, -1, -1):
		refills[index].time = float(refills[index].time) - delta
		if float(refills[index].time) <= 0.0:
			var slot := int(refills[index].slot)
			drones[slot].visible = true
			refills.remove_at(index)


func _destroy_target(target_index: int) -> void:
	var target := targets[target_index]
	if target.destroyed:
		return
	targets[target_index].destroyed = true
	if target.kind == "air_defense":
		stations_destroyed += 1
		state.add_score("air_defense")
	else:
		state.add_score("oil_tank")
	_spawn_explosion(target.node.global_position)
	target.node.visible = false
	target.node.set_deferred("collision_layer", 0)
	target.node.set_deferred("monitorable", false)
	target.node.set_deferred("monitoring", false)


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
	tween.tween_property(flash, "scale", Vector3.ONE * 7.0, 0.7)
	tween.tween_property(material, "albedo_color:a", 0.0, 0.7)
	tween.chain().tween_callback(flash.queue_free)


func _update_missiles(delta: float) -> void:
	missile_clock += delta
	if missile_clock >= 1.35 / 1.3:
		missile_clock = 0.0
		_spawn_missile()
	for index in range(missiles.size() - 1, -1, -1):
		var missile := missiles[index]
		missile.progress = float(missile.progress) + delta / float(missile.duration)
		var t: float = minf(1.0, missile.progress)
		var position: Vector3 = Vector3(missile.start).lerp(Vector3(missile.end), t)
		position.y += sin(t * PI) * float(missile.arc)
		missile.node.global_position = position
		missiles[index] = missile
		if position.distance_to(formation.global_position) < 2.2 and damage_cooldown <= 0.0:
			_hit_formation(position)
			missile.node.queue_free()
			missiles.remove_at(index)
		elif t >= 1.0:
			if position.distance_to(formation.global_position) < 8.0:
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
	var missile_node := MeshInstance3D.new()
	var missile_mesh := SphereMesh.new()
	missile_mesh.radius = 0.28
	missile_mesh.height = 0.8
	missile_node.mesh = missile_mesh
	missile_node.material_override = _material(Color("#ffdb69"), 0.2, Color("#ff7d21"))
	add_child(missile_node)
	missile_node.global_position = station.node.global_position
	var direct := rng.randf() < 0.23
	var spread := Vector3(rng.randf_range(-10.0, 10.0), rng.randf_range(-6.0, 7.0), rng.randf_range(-4.0, 4.0))
	if direct:
		spread *= 0.18
	var end := formation.global_position + spread + Vector3(0.0, 0.0, -FORWARD_SPEED * 2.4)
	missiles.append({
		"node": missile_node,
		"start": missile_node.global_position,
		"end": end,
		"arc": rng.randf_range(10.0, 20.0),
		"duration": rng.randf_range(2.0, 2.8),
		"progress": 0.0,
	})


func _hit_formation(position: Vector3) -> void:
	damage_cooldown = 2.0
	var candidates: Array[int] = []
	for index in range(drones.size()):
		if drones[index].visible:
			candidates.append(index)
	if candidates.is_empty():
		return
	var slot := candidates[rng.randi_range(0, candidates.size() - 1)]
	drones[slot].visible = false
	_spawn_explosion(formation.to_global(FORMATION_OFFSETS[slot]))
	state.lose_drone()
	if state.survivors <= 0:
		_finish_run(false)


func _update_progress() -> void:
	var progress := elapsed / GameState.RUN_DURATION
	while checkpoint_index < CHECKPOINTS.size() and progress >= CHECKPOINTS[checkpoint_index]:
		checkpoint_index += 1
		state.add_score("checkpoint")
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
		"altitude": roundi(formation.position.y * 10.0),
		"progress": minf(1.0, elapsed / GameState.RUN_DURATION),
		"survivors": state.survivors,
		"launches": state.launches_remaining,
		"stations_destroyed": stations_destroyed,
		"stations_total": total_stations,
		"slots": slots,
		"attacks": attacks.size(),
	})
