extends SceneTree

const FlightMathScript = preload("res://scripts/flight_math.gd")


func _init() -> void:
	var buildings: Array[Dictionary] = [{
		"position": Vector3(0.0, 7.0, 0.0),
		"size": Vector3(12.0, 20.0, 9.0),
	}]
	var start := Vector3(0.0, 10.0, 20.0)
	var target := Vector3(0.0, 3.0, -20.0)
	var arc := FlightMathScript.required_flight_arc(start, target, buildings)
	var midpoint := FlightMathScript.point_on_flight_arc(start, target, 0.5, arc)
	_assert_true(arc > 0.0, "a strike arcs over a building in its corridor")
	_assert_true(midpoint.y >= 24.0, "the strike keeps roof clearance")

	buildings[0].position.x = 40.0
	_assert_close(
		FlightMathScript.required_flight_arc(start, target, buildings),
		0.0,
		"off-path buildings do not change the strike arc"
	)
	_assert_close(
		FlightMathScript.segment_point_distance_squared(
			Vector3(-5.0, 2.0, 0.0),
			Vector3(5.0, 2.0, 0.0),
			Vector3(0.0, 2.4, 0.0)
		),
		0.16,
		"swept missile collision finds a crossed aircraft point"
	)

	var slot_position := 0.0
	var replacement_position := 38.0
	for _frame in range(600):
		slot_position -= 3.05 / 60.0
		var distance := absf(replacement_position - slot_position)
		replacement_position -= FlightMathScript.replacement_travel_distance(distance, 1.0 / 60.0)
		if absf(replacement_position - slot_position) < FlightMathScript.REPLACEMENT_JOIN_DISTANCE:
			break
	_assert_true(
		absf(replacement_position - slot_position) < FlightMathScript.REPLACEMENT_JOIN_DISTANCE,
		"a replacement catches the moving formation"
	)
	_assert_true(FlightMathScript.person_jump_window(8, 4, 4), "jump occurs four rows ahead")
	_assert_true(not FlightMathScript.person_jump_window(8, 3, 4), "jump waits for its row window")
	var edge: Dictionary = FlightMathScript.rooftop_edge_placement("center", 24.0, 13.4, 9.0, 0.0)
	_assert_close(edge.offset.x, -6.4, "a person stands at the center-facing edge")
	_assert_close(edge.direction.x, -2.2, "a person jumps toward the center")
	print("FLIGHT_MATH_TESTS_OK")
	quit(0)


func _assert_close(actual: float, expected: float, message: String) -> void:
	if not is_equal_approx(actual, expected):
		printerr("FAILED: %s — expected %s, got %s" % [message, expected, actual])
		quit(1)


func _assert_true(value: bool, message: String) -> void:
	if not value:
		printerr("FAILED: %s" % message)
		quit(1)
