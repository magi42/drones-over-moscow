class_name GameState
extends RefCounted

const RUN_DURATION := 72.0
const TOTAL_DRONES := 24
const STARTING_FORMATION := 4
const SCORE_MULTIPLIER := 1.3
const SCORE_VALUES := {
	"checkpoint": 500,
	"survivor": 1200,
	"collateral": 150,
	"oil_tank": 750,
	"warehouse": 900,
	"air_defense": 1100,
	"near_miss": 100,
}

var score := 0
var best_score := 0
var survivors := STARTING_FORMATION
var launches_remaining := TOTAL_DRONES
var run_won := false
var run_seed := 1
var master_volume := 0.65
var reduced_effects := false
var bindings := {
	"left": KEY_A,
	"right": KEY_D,
	"up": KEY_W,
	"down": KEY_S,
	"pause": KEY_ESCAPE,
}


func reset_run() -> void:
	score = 0
	survivors = STARTING_FORMATION
	launches_remaining = TOTAL_DRONES
	run_won = false
	run_seed = maxi(int(Time.get_unix_time_from_system() * 1000.0), run_seed + 1)


func add_score(event: String) -> int:
	if not SCORE_VALUES.has(event):
		return 0
	var points := roundi(float(SCORE_VALUES[event]) * SCORE_MULTIPLIER)
	score += points
	return points


func launch_drone() -> Dictionary:
	if launches_remaining <= 0:
		return {"accepted": false, "replacement_available": false}
	var replacement_available := launches_remaining > STARTING_FORMATION
	launches_remaining -= 1
	if not replacement_available:
		survivors = maxi(0, survivors - 1)
	return {
		"accepted": true,
		"replacement_available": replacement_available,
	}


func lose_drone() -> int:
	survivors = maxi(0, survivors - 1)
	return survivors


func finish(won: bool) -> void:
	run_won = won
	score += roundi(float(survivors * SCORE_VALUES.survivor) * SCORE_MULTIPLIER)
	best_score = maxi(best_score, score)
