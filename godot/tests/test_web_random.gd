extends SceneTree

const WebRandomScript = preload("res://scripts/web_random.gd")


func _init() -> void:
	var random := WebRandomScript.new(42)
	var expected := [
		0.60110375192016363,
		0.44829055899754167,
		0.85246579349040985,
		0.66973404143936932,
		0.17481389874592423,
	]
	for value in expected:
		var actual: float = random.next()
		if not is_equal_approx(actual, float(value)):
			printerr("FAILED: Mulberry32 sequence differs — expected %s, got %s" % [value, actual])
			quit(1)
			return
	print("WEB_RANDOM_TESTS_OK")
	quit(0)
