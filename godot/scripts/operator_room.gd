class_name OperatorRoom
extends Control

var sweep_angle := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(delta: float) -> void:
	sweep_angle = fposmod(sweep_angle + delta * 0.85, TAU)
	queue_redraw()


func _draw() -> void:
	var width := size.x
	var height := size.y
	var center := Vector2(width * 0.5, height * 0.49)
	draw_rect(Rect2(Vector2.ZERO, size), Color("#0b0f0c"))
	draw_rect(Rect2(0.0, 0.0, width, height * 0.075), Color("#171c17"))
	draw_rect(Rect2(width * 0.32, 0.0, width * 0.36, 11.0), Color("#4c6047"))
	draw_line(Vector2(width * 0.35, 11.0), Vector2(width * 0.65, 11.0), Color(0.73, 0.89, 0.72, 0.23), 20.0)
	_draw_monitor(Rect2(width * 0.015, height * 0.30, width * 0.22, height * 0.40), Color("#0a1b13"))
	_draw_monitor(Rect2(width * 0.765, height * 0.30, width * 0.22, height * 0.40), Color("#111c15"))
	_draw_monitor(Rect2(width * 0.225, height * 0.18, width * 0.55, height * 0.56), Color("#0a1510"))
	var font := ThemeDB.fallback_font
	var left_center := Vector2(width * 0.125, height * 0.49)
	for radius in [33.0, 61.0, 91.0]:
		draw_arc(left_center, radius, 0.0, TAU, 48, Color("#315d40"), 1.0)
	draw_line(left_center + Vector2(-100.0, 0.0), left_center + Vector2(100.0, 0.0), Color("#274a34"), 1.0)
	draw_line(left_center + Vector2(0.0, -100.0), left_center + Vector2(0.0, 100.0), Color("#274a34"), 1.0)
	draw_line(left_center, left_center + Vector2(cos(sweep_angle), sin(sweep_angle)) * 91.0, Color("#95d69b"), 2.0)
	draw_circle(left_center + Vector2(-22.0, 32.0), 2.5, Color("#b7f238"))
	draw_string(font, Vector2(width * 0.04, height * 0.345), "UPLINK / STABLE", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#77a586"))
	draw_string(font, Vector2(width * 0.79, height * 0.345), "WEATHER / NOMINAL", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#77a586"))
	for index in range(5):
		draw_rect(Rect2(width * 0.815 + index * 24.0, height * 0.49 - index * 9.0, 14.0, 25.0 + index * 9.0), Color("#71a776"))
	draw_string(font, center + Vector2(-width * 0.24, -height * 0.23), "OPERATOR STATION 04", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#77a586"))
	draw_string(font, center + Vector2(width * 0.16, -height * 0.23), "03:17:42 Z", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#77a586"))
	var desk := PackedVector2Array([
		Vector2(0.0, height * 0.82),
		Vector2(width, height * 0.82),
		Vector2(width, height),
		Vector2(0.0, height),
	])
	draw_colored_polygon(desk, Color("#202620"))
	draw_line(Vector2(0.0, height * 0.82), Vector2(width, height * 0.82), Color("#596451"), 4.0)
	var keyboard := Rect2(width * 0.32, height * 0.88, width * 0.36, height * 0.075)
	draw_rect(keyboard, Color("#101411"))
	draw_rect(keyboard, Color("#465046"), false, 2.0)
	for column in range(18):
		var key_x := keyboard.position.x + 8.0 + float(column) * (keyboard.size.x - 16.0) / 18.0
		draw_line(Vector2(key_x, keyboard.position.y + 6.0), Vector2(key_x, keyboard.end.y - 6.0), Color("#394038"), 2.0)
	draw_circle(Vector2(width * 0.83, height * 0.93), 31.0, Color("#111712"))
	draw_arc(Vector2(width * 0.83, height * 0.93), 31.0, 0.0, TAU, 32, Color("#596451"), 2.0)
	draw_line(Vector2(width * 0.83, height * 0.92), Vector2(width * 0.82, height * 0.85), Color("#647366"), 8.0)


func _draw_monitor(rect: Rect2, screen_color: Color) -> void:
	draw_rect(rect.grow(9.0), Color("#171b18"))
	draw_rect(rect.grow(11.0), Color("#343d35"), false, 2.0)
	draw_rect(rect, screen_color)
	draw_line(rect.position + Vector2(8.0, 26.0), Vector2(rect.end.x - 8.0, rect.position.y + 26.0), Color("#31473a"), 1.0)
