class_name FlightMath
extends RefCounted

const REPLACEMENT_JOIN_DISTANCE := 0.45


static func required_flight_arc(
	start: Vector3,
	target: Vector3,
	buildings: Array[Dictionary],
	excluded_building_index := -1,
	clearance := 7.0
) -> float:
	var direction := Vector2(target.x - start.x, target.z - start.z)
	var length_squared := direction.length_squared()
	if length_squared <= 0.000001:
		return 0.0
	var arc_height := 0.0
	for index in range(buildings.size()):
		if index == excluded_building_index:
			continue
		var building: Dictionary = buildings[index]
		var position: Vector3 = building.position
		var size: Vector3 = building.size
		var offset := Vector2(position.x - start.x, position.z - start.z)
		var progress := clampf(offset.dot(direction) / length_squared, 0.0, 1.0)
		if progress <= 0.04 or progress >= 0.96:
			continue
		var path_position := Vector2(start.x, start.z) + direction * progress
		if (
			absf(path_position.x - position.x) > size.x * 0.5 + 3.5
			or absf(path_position.y - position.z) > size.z * 0.5 + 3.5
		):
			continue
		var roof := position.y + size.y * 0.5
		var straight_height := lerpf(start.y, target.y, progress)
		var parabola := 4.0 * progress * (1.0 - progress)
		arc_height = maxf(arc_height, (roof + clearance - straight_height) / parabola)
	return maxf(0.0, arc_height)


static func point_on_flight_arc(start: Vector3, target: Vector3, progress: float, arc_height: float) -> Vector3:
	var amount := clampf(progress, 0.0, 1.0)
	var position := start.lerp(target, amount)
	position.y += 4.0 * arc_height * amount * (1.0 - amount)
	return position


static func segment_point_distance_squared(start: Vector3, end: Vector3, point: Vector3) -> float:
	var segment := end - start
	var length_squared := segment.length_squared()
	if length_squared <= 0.000001:
		return point.distance_squared_to(start)
	var projection := clampf((point - start).dot(segment) / length_squared, 0.0, 1.0)
	return point.distance_squared_to(start + segment * projection)


static func replacement_travel_distance(distance: float, delta: float) -> float:
	var catch_up_speed := 14.0 + minf(distance * 0.45, 12.0)
	return minf(distance, catch_up_speed * delta)


static func person_jump_window(building_row: int, fleet_row: int, jump_ahead_rows: int) -> bool:
	var rows_ahead := building_row - fleet_row
	return rows_ahead >= 2 and rows_ahead <= 4 and rows_ahead == jump_ahead_rows


static func rooftop_edge_placement(edge: String, building_x: float, width: float, depth: float, edge_offset: float) -> Dictionary:
	if edge == "player":
		return {
			"offset": Vector2(edge_offset * width, depth * 0.5 - 0.3),
			"direction": Vector2(0.0, 2.2),
		}
	var center_direction := -1.0 if building_x > 0.0 else 1.0
	return {
		"offset": Vector2(center_direction * (width * 0.5 - 0.3), edge_offset * depth),
		"direction": Vector2(center_direction * 2.2, 0.0),
	}
