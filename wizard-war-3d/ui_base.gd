extends Control
class_name UIBase
## HUD와 메뉴가 같이 쓰는 그리기 도우미.

var main
var f_body: Font
var f_bold: Font
var f_disp: Font
var icons := {}
var clicks: Array = []
var touch_ui := false

const C_GOLD := Color("e8b84a")
const C_INK := Color("f1ead6")
const C_DIM := Color("b8b0c8")
const C_PANEL := Color(0.06, 0.06, 0.14, 0.78)
const C_CARD := Color(0.1, 0.1, 0.2, 0.92)
const C_FROST := Color("7fd6e8")
const C_HEX := Color("b46cf0")
const C_BLOOD := Color("e2556b")
const C_OK := Color("5fd38a")
const C_DARK := Color("15132a")

const SKILL_COL := {
	"attack": Color("ffb347"), "shield": Color("7fd6e8"), "nova": Color("ffd36b"), "summon": Color("9fc3ff"),
	"chain": Color("b9d4ff"), "frost": Color("a8ecff"), "heal": Color("7fe39a"), "meteor": Color("ff8a4c"),
	"dash": Color("ffe9a8"), "potion_hp": Color("ff9a9a"), "potion_mana": Color("b59cff"), "potion_crystal": Color("7fd6e8"),
}

const ICON_NAMES := ["attack", "shield", "nova", "summon", "chain", "frost", "heal", "meteor", "potion_hp", "potion_mana",
	"potion_crystal", "up_power", "up_hp", "up_speed", "up_knight", "up_crystal", "up_mastery", "gold", "dash", "pause",
	"settings", "trophy", "lock", "star", "boss", "dev", "castle", "music", "sound", "check", "portal", "skull", "flame",
	"snow", "speed", "moon", "infinity"]


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	f_body = load("res://fonts/NotoSansKR.ttf")
	var fv := FontVariation.new()
	fv.base_font = f_body
	fv.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): 800}
	f_bold = fv
	f_disp = load("res://fonts/GowunBatang-Bold.ttf")
	touch_ui = OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios")
	for n in ICON_NAMES:
		icons[n] = load("res://icons/%s.svg" % n)


func fit() -> void:
	position = Vector2.ZERO
	size = get_viewport_rect().size


func click_at(p: Vector2) -> String:
	for i in range(clicks.size() - 1, -1, -1):
		if clicks[i].rect.has_point(p):
			return clicks[i].act
	return ""


func txt(font: Font, pos: Vector2, s: String, fs: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, outline := true) -> void:
	var x := pos.x
	var w := -1.0
	if align == HORIZONTAL_ALIGNMENT_CENTER:
		x -= 700
		w = 1400
	elif align == HORIZONTAL_ALIGNMENT_RIGHT:
		x -= 1400
		w = 1400
	if outline:
		draw_string_outline(font, Vector2(x, pos.y), s, align, w, fs, maxi(4, fs / 5), Color(0, 0, 0, 0.6 * col.a))
	draw_string(font, Vector2(x, pos.y), s, align, w, fs, col)


func bar(r: Rect2, k: float, col: Color) -> void:
	draw_rect(r.grow(2), Color(0, 0, 0, 0.6))
	draw_rect(r, Color(0.15, 0.13, 0.2))
	draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(k, 0, 1), r.size.y)), col)
	draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(k, 0, 1), r.size.y * 0.4)), Color(1, 1, 1, 0.18))


func panel(r: Rect2, col := C_PANEL, rad := 10, border := Color(1, 1, 1, 0.08), bw := 1) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(rad)
	sb.border_color = border
	sb.set_border_width_all(bw)
	sb.anti_aliasing = true
	draw_style_box(sb, r)


func icon(id: String, c: Vector2, sz: float, col: Color) -> void:
	if icons.has(id) and icons[id]:
		draw_texture_rect(icons[id], Rect2(c - Vector2(sz, sz) / 2, Vector2(sz, sz)), false, col)


func button(r: Rect2, label: String, act: String, enabled := true, primary := true, ic := "") -> void:
	var bg := C_GOLD if primary else Color(0.2, 0.2, 0.36)
	if not enabled:
		bg = Color(0.25, 0.25, 0.3)
	panel(r, bg, int(r.size.y / 2), Color(1, 1, 1, 0.16))
	if primary and enabled:
		panel(Rect2(r.position + Vector2(4, 3), Vector2(r.size.x - 8, r.size.y * 0.42)), Color(1, 1, 1, 0.16), int(r.size.y / 3), Color(0, 0, 0, 0), 0)
	var fc := C_DARK if primary and enabled else (C_INK if enabled else C_DIM)
	var fs := 15 if r.size.y < 44 else (20 if r.size.y < 58 else 24)
	var cx := r.get_center().x
	if ic != "":
		var tw := f_bold.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		icon(ic, Vector2(cx - tw / 2 - 6, r.get_center().y), fs * 1.3, fc)
		cx += fs * 0.6
	txt(f_bold if r.size.y < 44 else f_disp, Vector2(cx, r.get_center().y + fs * 0.36), label, fs, fc, HORIZONTAL_ALIGNMENT_CENTER, false)
	clicks.append({"rect": r, "act": act})


func icon_button(c: Vector2, r: float, ic: String, act: String, col := C_INK, badge := 0) -> void:
	draw_circle(c, r, Color(0.07, 0.07, 0.16, 0.85))
	draw_arc(c, r, 0, TAU, 40, Color(col, 0.7), 2.0, true)
	icon(ic, c, r * 1.1, col)
	if badge > 0:
		draw_circle(c + Vector2(r * 0.75, -r * 0.75), 11, C_BLOOD)
		txt(f_bold, c + Vector2(r * 0.75, -r * 0.75 + 5), str(badge), 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)
	clicks.append({"rect": Rect2(c - Vector2(r, r), Vector2(r, r) * 2), "act": act})


func gold_chip(pos: Vector2, right_align := true) -> void:
	var s := "%d" % Save.gold
	var w := 58.0 + s.length() * 13.0
	var r := Rect2(pos.x - (w if right_align else 0.0), pos.y, w, 40)
	panel(r, Color(0.08, 0.07, 0.04, 0.85), 20, Color(C_GOLD, 0.45))
	icon("gold", Vector2(r.position.x + 22, r.get_center().y), 26, C_GOLD)
	txt(f_bold, Vector2(r.position.x + 40, r.position.y + 27), s, 18, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)


func star_row(c: Vector2, n: int, total := 3, sz := 26.0, gap := 30.0) -> void:
	var x0 := c.x - gap * (total - 1) / 2.0
	for i in total:
		icon("star", Vector2(x0 + i * gap, c.y), sz, C_GOLD if i < n else Color(1, 1, 1, 0.18))


func wrap_text(s: String, pos: Vector2, w: float, fs: int, col: Color, lines := 2) -> void:
	draw_multiline_string(f_body, pos, s, HORIZONTAL_ALIGNMENT_LEFT, w, fs, lines, col)
