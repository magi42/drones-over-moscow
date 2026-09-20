extends SceneTree

const GameStateScript = preload("res://scripts/game_state.gd")


func _init() -> void:
	var state = GameStateScript.new()
	_assert_equal(state.survivors, 4, "starts with four drones")
	_assert_equal(state.launches_remaining, 24, "starts with full inventory")
	_assert_equal(state.add_score("checkpoint"), 650, "route multiplier applies")
	_assert_equal(state.score, 650, "score is accumulated")

	for index in range(20):
		var launch: Dictionary = state.launch_drone()
		_assert_true(launch.accepted, "reserve launch is accepted")
		_assert_true(launch.replacement_available, "reserve replacement is available")
	_assert_equal(state.launches_remaining, 4, "formation inventory remains")
	_assert_equal(state.survivors, 4, "formation refills while reserves remain")

	var final_launch: Dictionary = state.launch_drone()
	_assert_true(final_launch.accepted, "formation launch is accepted")
	_assert_true(not final_launch.replacement_available, "no replacement remains")
	_assert_equal(state.survivors, 3, "unreplaced launch reduces survivors")

	state.finish(true)
	_assert_equal(state.score, 5330, "survivor bonus is applied")
	_assert_equal(state.best_score, 5330, "best score is recorded")

	state.reset_run()
	_assert_true(state.run_seed > 1, "a run receives a fresh procedural seed")
	state.lose_drone()
	_assert_equal(state.survivors, 3, "combat damage reduces survivors")
	_assert_equal(state.launches_remaining, 24, "combat damage does not consume a queued launch")
	print("GAME_STATE_TESTS_OK")
	quit(0)


func _assert_equal(actual: Variant, expected: Variant, message: String) -> void:
	if actual != expected:
		printerr("FAILED: %s — expected %s, got %s" % [message, expected, actual])
		quit(1)


func _assert_true(value: bool, message: String) -> void:
	if not value:
		printerr("FAILED: %s" % message)
		quit(1)
