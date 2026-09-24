extends Control

const ACID := Color("#b7f238")
const GRID := Color("#7ea98d")

var elapsed := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(delta: float) -> void:
	elapsed += delta
	queue_redraw()


func _draw() -> void:
	var center := Vector2(size.x * 0.305, size.y * 0.5)
	for radius_value in [360.0, 285.0, 220.0]:
		var radius: float = float(radius_value)
		var strength: float = (390.0 - radius) / 390.0
		draw_circle(center, radius, Color(ACID, 0.008 + strength * 0.012))

	for x in range(0, ceili(size.x) + 44, 44):
		draw_line(Vector2(x, 0.0), Vector2(x, size.y), Color(GRID, 0.05), 1.0)
	for y in range(0, ceili(size.y) + 44, 44):
		draw_line(Vector2(0.0, y), Vector2(size.x, y), Color(GRID, 0.05), 1.0)

	var pulse := 1.0 + sin(elapsed * TAU / 1.6) * 0.0175
	var outer_radius := 115.0 * pulse
	draw_arc(center, outer_radius, 0.0, TAU, 96, Color(ACID, 0.42), 1.25, true)
	draw_arc(center, 79.0 * pulse, 0.0, TAU, 96, Color(ACID, 0.16), 1.0, true)
	draw_arc(center, 39.0, 0.0, TAU, 64, Color(ACID, 0.22), 1.0, true)
	draw_line(center - Vector2(140.0, 0.0), center + Vector2(140.0, 0.0), ACID, 1.0)
	draw_line(center - Vector2(0.0, 140.0), center + Vector2(0.0, 140.0), ACID, 1.0)
	for angle_index in range(8):
		var direction := Vector2.RIGHT.rotated(float(angle_index) * TAU / 8.0)
		draw_line(center + direction * 105.0, center + direction * 119.0, Color(ACID, 0.72), 2.0)
	draw_circle(center, 3.0, ACID)
