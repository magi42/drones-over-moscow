class_name DroneBlueprint
extends Control


func _ready() -> void:
	custom_minimum_size = Vector2(455, 470)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("#102019"))
	var grid_color := Color(0.35, 0.66, 0.49, 0.13)
	for x in range(0, int(size.x) + 1, 30):
		draw_line(Vector2(x, 0), Vector2(x, size.y), grid_color, 1.0)
	for y in range(0, int(size.y) + 1, 30):
		draw_line(Vector2(0, y), Vector2(size.x, y), grid_color, 1.0)

	var center := size * Vector2(0.50, 0.48)
	var ink := Color("#6fc6a0")
	var body := PackedVector2Array([
		center + Vector2(0, -112),
		center + Vector2(19, -75),
		center + Vector2(22, 88),
		center + Vector2(0, 116),
		center + Vector2(-22, 88),
		center + Vector2(-19, -75),
		center + Vector2(0, -112),
	])
	draw_polyline(body, ink, 2.0)
	draw_line(center + Vector2(-174, -16), center + Vector2(174, 20), ink, 3.0)
	draw_line(center + Vector2(-174, 20), center + Vector2(174, -16), ink, 3.0)
	draw_line(center + Vector2(-62, 76), center + Vector2(62, 76), ink, 3.0)
	draw_line(center + Vector2(0, -112), center + Vector2(0, 116), Color(ink, 0.35), 1.0)
	for point in [Vector2(-150, -10), Vector2(150, -10), Vector2(-124, 21), Vector2(124, 21)]:
		draw_arc(center + point, 26.0, 0.0, TAU, 32, ink, 2.0)
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(24, 36), "FP-1 / PLAN VIEW", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ink)
	draw_string(font, Vector2(24, size.y - 28), "4 ACTIVE AIRCRAFT  ·  20 RESERVES", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#668a76"))
