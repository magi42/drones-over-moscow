class_name RouteMap
extends Control

signal ukraine_selected

const ROUTES := [
	{"name": "FINLAND", "call_sign": "NORTH WIND", "position": Vector2(0.27, 0.24), "color": Color("#70d9e7")},
	{"name": "ESTONIA", "call_sign": "PINE NEEDLE", "position": Vector2(0.20, 0.43), "color": Color("#6fa8ff")},
	{"name": "LATVIA", "call_sign": "AMBER ROAD", "position": Vector2(0.18, 0.55), "color": Color("#e58c70")},
	{"name": "UKRAINE", "call_sign": "SUNFLOWER", "position": Vector2(0.28, 0.81), "color": Color("#f0c84d")},
]
const MOSCOW := Vector2(0.67, 0.51)
const MONO_FONT = preload("res://assets/fonts/ibm_plex_mono/IBMPlexMono-Regular.ttf")


func _ready() -> void:
	mouse_default_cursor_shape = Control.CURSOR_CROSS
	custom_minimum_size = Vector2(580, 470)
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("#0d1512"))
	var grid_color := Color(0.49, 0.66, 0.55, 0.08)
	for x in range(0, int(size.x) + 1, 38):
		draw_line(Vector2(x, 0), Vector2(x, size.y), grid_color, 1.0)
	for y in range(0, int(size.y) + 1, 38):
		draw_line(Vector2(0, y), Vector2(size.x, y), grid_color, 1.0)

	var federation := PackedVector2Array([
		Vector2(0.47, 0.20) * size,
		Vector2(0.60, 0.11) * size,
		Vector2(0.94, 0.16) * size,
		Vector2(0.98, 0.68) * size,
		Vector2(0.79, 0.78) * size,
		Vector2(0.61, 0.69) * size,
		Vector2(0.45, 0.86) * size,
		Vector2(0.41, 0.51) * size,
	])
	draw_colored_polygon(federation, Color("#1b2923"))
	draw_polyline(federation, Color("#4f685a"), 1.0)

	var font := MONO_FONT
	draw_string(font, Vector2(0.58, 0.44) * size, "RUSSIAN FEDERATION", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("#52645a"))
	var moscow_position := MOSCOW * size
	draw_circle(moscow_position, 10.0, Color.TRANSPARENT, false, 2.0, true)
	draw_arc(moscow_position, 10.0, 0.0, TAU, 32, Color("#b7f238"), 2.0)
	draw_circle(moscow_position, 2.5, Color("#b7f238"))
	draw_string(font, moscow_position + Vector2(-27, 29), "MOSCOW", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#e1e9e3"))

	for index in range(ROUTES.size()):
		var route: Dictionary = ROUTES[index]
		var position: Vector2 = route.position * size
		var color: Color = route.color
		var enabled := index == ROUTES.size() - 1
		draw_dashed_line(position, moscow_position, Color(color, 0.58 if enabled else 0.20), 1.2, 8.0)
		var diamond := PackedVector2Array([
			position + Vector2(0, -7),
			position + Vector2(7, 0),
			position + Vector2(0, 7),
			position + Vector2(-7, 0),
		])
		draw_colored_polygon(diamond, Color("#0d1512"))
		draw_polyline(diamond, color if enabled else Color(color, 0.30), 2.0)
		draw_string(font, position + Vector2(12, 5), route.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, color if enabled else Color(color, 0.35))


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		var ukraine_position: Vector2 = ROUTES[3].position * size
		if event.position.distance_to(ukraine_position) <= 28.0:
			ukraine_selected.emit()
			accept_event()
