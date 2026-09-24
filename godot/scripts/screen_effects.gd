extends Control

@export var draw_vignette := false
@export var draw_scanlines := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	queue_redraw()


func _draw() -> void:
	if draw_vignette:
		_draw_vignette()
	if draw_scanlines:
		for y in range(0, ceili(size.y), 4):
			draw_line(Vector2(0.0, y), Vector2(size.x, y), Color(0.0, 0.0, 0.0, 0.13), 1.0)


func _draw_vignette() -> void:
	var band_count := 14
	var band_size := 11.0
	for band in range(band_count):
		var strength := pow(1.0 - float(band) / float(band_count), 2.0)
		var alpha := 0.055 * strength
		var inset := float(band) * band_size
		draw_rect(Rect2(inset, inset, size.x - inset * 2.0, band_size), Color(0.0, 0.0, 0.0, alpha))
		draw_rect(Rect2(inset, size.y - inset - band_size, size.x - inset * 2.0, band_size), Color(0.0, 0.0, 0.0, alpha))
		draw_rect(Rect2(inset, inset, band_size, size.y - inset * 2.0), Color(0.0, 0.0, 0.0, alpha))
		draw_rect(Rect2(size.x - inset - band_size, inset, band_size, size.y - inset * 2.0), Color(0.0, 0.0, 0.0, alpha))
	draw_rect(Rect2(0.0, 0.0, size.x, size.y * 0.16), Color(0.0, 0.0, 0.0, 0.12))
	draw_rect(Rect2(0.0, size.y * 0.82, size.x, size.y * 0.18), Color(0.0, 0.0, 0.0, 0.16))
