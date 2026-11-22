extends Control
class_name UIBase
## HUD와 메뉴가 같이 쓰는 그리기 도우미.

var main
var f_body: Font
var f_bold: Font
var f_disp: Font
var icons := {}
var clicks: Array = []
# ---- 연출용 상태 ----
var page_xf := Transform2D.IDENTITY   # 화면 전체 위치 이동 (전환 때 아래에서 올라옴)
var base_xf := Transform2D.IDENTITY   # 지금 그리는 묶음(카드 등)의 변환
var press_ms := {}                    # 동작별로 마지막 눌린 시각
var ripples: Array = []               # 누른 자리에서 퍼지는 파동
var ui_t := 99.0                      # 화면이 열린 뒤 경과 시간 (등장 연출용)
var btn_i := 0                        # 이번 프레임 몇 번째 버튼인지 (순서대로 등장)
var touch_ui: bool:
	get:
		return Save.touch_ui

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
	"dash": Color("ffe9a8"), "judge": Color("8fb4ff"), "potion_hp": Color("ff9a9a"), "potion_mana": Color("b59cff"), "potion_crystal": Color("7fd6e8"),
}

const ICON_NAMES := ["attack", "shield", "nova", "summon", "chain", "frost", "heal", "meteor", "potion_hp", "potion_mana",
	"potion_crystal", "up_power", "up_hp", "up_speed", "up_knight", "up_crystal", "up_mastery", "gold", "dash", "pause",
	"settings", "trophy", "lock", "star", "boss", "dev", "castle", "music", "sound", "check", "portal", "skull", "flame",
	"snow", "speed", "moon", "infinity", "back", "retry", "cancel", "upgrade", "exit", "equip"]


func _hahmlet(base: Font, tag: int, w: int) -> Font:
	var fv := FontVariation.new()
	fv.base_font = base
	fv.variation_opentype = {tag: w}
	return fv


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# 모든 글자는 빛의계승자체(Regular / Bold)를 쓴다. 글꼴 파일이 없으면(저장소에는 올리지 않는다) Hahmlet(OFL)으로 대신한다.
	var base: FontFile = load("res://fonts/Hahmlet-VF.ttf")
	base.fallbacks = [load("res://fonts/NotoSansKR.ttf")]
	var wght := TextServerManager.get_primary_interface().name_to_tag("wght")
	var reg: Font = null
	var bold: Font = null
	if ResourceLoader.exists("res://fonts/HeirofLight-Regular.ttf") and ResourceLoader.exists("res://fonts/HeirofLight-Bold.ttf"):
		reg = load("res://fonts/HeirofLight-Regular.ttf")
		bold = load("res://fonts/HeirofLight-Bold.ttf")
		reg.fallbacks = [base]
		bold.fallbacks = [base]
	if reg != null and bold != null:
		f_body = reg
		f_bold = bold
		f_disp = bold
	else:
		f_body = _hahmlet(base, wght, 420)
		f_bold = _hahmlet(base, wght, 660)
		f_disp = _hahmlet(base, wght, 560)
	for n in ICON_NAMES:
		icons[n] = load("res://icons/%s.svg" % n)
	icons["judge"] = icons["nova"]   # 아스트라 유디키움 버튼은 별빛 아이콘


func fit() -> void:
	position = Vector2.ZERO
	size = get_viewport_rect().size


# ---------------- 연출 도구 ----------------
func ease_out_back(x: float) -> float:
	var c1 := 1.70158
	var c3 := c1 + 1.0
	return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0)


func ease_out(x: float) -> float:
	return 1.0 - pow(1.0 - x, 3.0)


func mark_press(act: String, pos := Vector2(-1, -1)) -> void:
	## 버튼이 눌린 순간을 기록한다: 작아졌다 튕기고, 누른 자리에서 파동이 퍼진다
	press_ms[act] = Time.get_ticks_msec()
	if pos.x >= 0:
		ripples.append({"pos": pos, "t": Time.get_ticks_msec()})


func press_k(act: String) -> float:
	return clampf((Time.get_ticks_msec() - int(press_ms.get(act, -10000))) / 320.0, 0.0, 1.0)


func press_scale(act: String) -> float:
	var k := press_k(act)
	return 1.0 - 0.11 * sin(k * PI) if k < 1.0 else 1.0


func fx_begin(c: Vector2, sc: float, dy := 0.0) -> void:
	## c를 중심으로 sc배 하고 dy만큼 옮겨 그린다
	var xf := Transform2D(0.0, Vector2(sc, sc), 0.0, c + Vector2(0, dy)) * Transform2D(0.0, -c)
	draw_set_transform_matrix(base_xf * xf)


func fx_end() -> void:
	draw_set_transform_matrix(base_xf)


func card_begin(r: Rect2, index: int) -> void:
	## 카드 하나를 순서대로 통통 튀며 등장시킨다 (안의 버튼도 같이 움직임)
	var e := clampf((ui_t - 0.05 - index * 0.045) / 0.36, 0.0, 1.0)
	var sc := lerpf(0.9, 1.0, ease_out_back(e))
	var c := r.get_center()
	base_xf = page_xf * Transform2D(0.0, Vector2(sc, sc), 0.0, c + Vector2(0, (1.0 - e) * 22.0)) * Transform2D(0.0, -c)
	draw_set_transform_matrix(base_xf)


func card_end() -> void:
	base_xf = page_xf
	draw_set_transform_matrix(base_xf)


func draw_ripples() -> void:
	var now := Time.get_ticks_msec()
	ripples = ripples.filter(func(rp): return now - int(rp.t) < 480)
	for rp in ripples:
		var k: float = (now - int(rp.t)) / 480.0
		draw_arc(rp.pos, 8.0 + 64.0 * ease_out(k), 0, TAU, 36, Color(1, 1, 1, 0.55 * (1.0 - k)), 3.0, true)
		draw_circle(rp.pos, 6.0 * (1.0 - k), Color(1, 1, 0.9, 0.5 * (1.0 - k)))


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


func auto_icon(act: String, label: String) -> String:
	## 아이콘을 따로 주지 않은 버튼에 동작에 맞는 아이콘을 고른다
	var a := act.split(":")[0]
	match a:
		"back": return "back"
		"retry": return "retry"
		"pw_ok": return "check"
		"resume": return "attack"
		"start": return "attack"
		"buy_up": return "upgrade" if label != "최대" else "check"
		"buy_skill":
			if label == "최대": return "check"
			return "gold" if label.begins_with("구매") else "upgrade"
		"buy_item": return "gold"
		"equip": return "cancel" if label == "해제" else "equip"
		"claim": return "gold"
		"set":
			if label == "켜짐": return "check"
			if label == "꺼짐": return "cancel"
		"to_title": return "exit"
	return ""


func button(r: Rect2, label: String, act: String, enabled := true, primary := true, ic := "") -> void:
	var c := r.get_center()
	# 순서대로 통통 튀며 등장 + 누르면 작아졌다 튕김 + 마우스를 올리면 살짝 커짐
	var i := btn_i
	btn_i += 1
	var e := clampf((ui_t - 0.06 - i * 0.035) / 0.34, 0.0, 1.0)
	var sc := lerpf(0.86, 1.0, ease_out_back(e)) * press_scale(act)
	var hover := enabled and not touch_ui and r.has_point(get_local_mouse_position())
	if hover:
		sc *= 1.035
	fx_begin(c, sc, (1.0 - e) * 14.0)
	var bg := C_GOLD if primary else Color(0.2, 0.2, 0.36)
	if not enabled:
		bg = Color(0.25, 0.25, 0.3)
	panel(r, bg, int(r.size.y / 2), Color(1, 1, 1, 0.16))
	if primary and enabled:
		panel(Rect2(r.position + Vector2(4, 3), Vector2(r.size.x - 8, r.size.y * 0.42)), Color(1, 1, 1, 0.16), int(r.size.y / 3), Color(0, 0, 0, 0), 0)
	if hover:
		panel(r, Color(1, 1, 1, 0.1), int(r.size.y / 2), Color(1, 1, 1, 0.5), 2)
	var fc := C_DARK if primary and enabled else (C_INK if enabled else C_DIM)
	var fs := 15 if r.size.y < 44 else (20 if r.size.y < 58 else 24)
	var cx := c.x
	if label == "+" or label == "-":
		# 아이콘 전용 +/- 버튼
		draw_line(c - Vector2(9, 0), c + Vector2(9, 0), fc, 3.0, true)
		if label == "+":
			draw_line(c - Vector2(0, 9), c + Vector2(0, 9), fc, 3.0, true)
	else:
		if ic == "":
			ic = auto_icon(act, label)
		if ic != "":
			var tw := f_bold.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			icon(ic, Vector2(cx - tw / 2 - 6, c.y), fs * 1.3, fc)
			cx += fs * 0.6
		txt(f_bold if r.size.y < 44 else f_disp, Vector2(cx, c.y + fs * 0.36), label, fs, fc, HORIZONTAL_ALIGNMENT_CENTER, false)
	var pk := press_k(act)
	if pk < 1.0:   # 누른 순간 하얗게 번쩍
		panel(r, Color(1, 1, 1, 0.38 * (1.0 - pk)), int(r.size.y / 2), Color(0, 0, 0, 0), 0)
	fx_end()
	clicks.append({"rect": r, "act": act})


func icon_button(c: Vector2, r: float, ic: String, act: String, col := C_INK, badge := 0) -> void:
	var hover := not touch_ui and (get_local_mouse_position() - c).length() < r
	fx_begin(c, press_scale(act) * (1.08 if hover else 1.0))
	draw_circle(c, r, Color(0.07, 0.07, 0.16, 0.85))
	draw_arc(c, r, 0, TAU, 40, Color(col, 0.7 if not hover else 1.0), 2.0 if not hover else 3.0, true)
	icon(ic, c, r * 1.1, col)
	if badge > 0:
		draw_circle(c + Vector2(r * 0.75, -r * 0.75), 11, C_BLOOD)
		txt(f_bold, c + Vector2(r * 0.75, -r * 0.75 + 5), str(badge), 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)
	var pk := press_k(act)
	if pk < 1.0:
		draw_circle(c, r, Color(1, 1, 1, 0.35 * (1.0 - pk)))
	fx_end()
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
