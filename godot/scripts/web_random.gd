class_name WebRandom
extends RefCounted

const UINT32_MASK := 0xffffffff
const UINT32_RANGE := 4294967296.0

var state: int


func _init(seed: int) -> void:
	state = seed & UINT32_MASK


func next() -> float:
	state = (state + 0x6d2b79f5) & UINT32_MASK
	var value := state
	value = ((value ^ (value >> 15)) * (value | 1)) & UINT32_MASK
	var mixed := ((value ^ (value >> 7)) * (value | 61)) & UINT32_MASK
	value = (value ^ ((value + mixed) & UINT32_MASK)) & UINT32_MASK
	return float((value ^ (value >> 14)) & UINT32_MASK) / UINT32_RANGE
