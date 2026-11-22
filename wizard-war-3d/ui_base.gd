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


# ---------------- 아르데코 판타지 버튼: 금빛 이중 테두리, 위아래 가운데의 뾰족한 돌기, 양끝의 보석, 색이 있는 판, 아래로 번지는 빛 ----------------
const GOLD_L := Color("f6dc8a")
const GOLD_D := Color("a8741c")
const PLATE_TEAL := Color(0.1, 0.46, 0.46)
const PLATE_BLUE := Color(0.13, 0.22, 0.58)
const PLATE_RED := Color(0.5, 0.14, 0.17)
const PLATE_GRAY := Color(0.24, 0.24, 0.3)


func deco_pts(c: Vector2, hw: float, hh: float, peak: float, cut: float) -> PackedVector2Array:
	## 모서리를 깎은 판의 윤곽. peak 만큼 위아래 가운데가 뾰족하게 솟는다 (peak=0 이면 평평한 판)
	var bw := hw * 0.2
	var bs := hw * 0.34
	var p := PackedVector2Array()
	p.append(c + Vector2(-hw + cut, -hh))
	if peak > 0.0:
		p.append(c + Vector2(-bs, -hh))
		p.append(c + Vector2(-bw, -hh - peak))
		p.append(c + Vector2(bw, -hh - peak))
		p.append(c + Vector2(bs, -hh))
	p.append(c + Vector2(hw - cut, -hh))
	p.append(c + Vector2(hw, -hh + cut))
	p.append(c + Vector2(hw, hh - cut))
	p.append(c + Vector2(hw - cut, hh))
	if peak > 0.0:
		p.append(c + Vector2(bs, hh))
		p.append(c + Vector2(bw, hh + peak))
		p.append(c + Vector2(-bw, hh + peak))
		p.append(c + Vector2(-bs, hh))
	p.append(c + Vector2(-hw + cut, hh))
	p.append(c + Vector2(-hw, hh - cut))
	p.append(c + Vector2(-hw, -hh + cut))
	return p


func deco_line(p: PackedVector2Array, col: Color, w: float) -> void:
	var q := p.duplicate()
	q.append(q[0])
	draw_polyline(q, col, w, true)


func deco_hit(c: Vector2, hw: float, hh: float, p: Vector2) -> bool:
	return absf(p.x - c.x) <= hw + 6.0 and absf(p.y - c.y) <= hh + 6.0


func deco_diamond(c: Vector2, sz: float, outer: Color, inner: Color) -> void:
	var d := PackedVector2Array([c + Vector2(-sz, 0), c + Vector2(0, -sz), c + Vector2(sz, 0), c + Vector2(0, sz)])
	draw_colored_polygon(d, outer)
	var e := PackedVector2Array([c + Vector2(-sz * 0.55, 0), c + Vector2(0, -sz * 0.55), c + Vector2(sz * 0.55, 0), c + Vector2(0, sz * 0.55)])
	draw_colored_polygon(e, inner)
	draw_colored_polygon(PackedVector2Array([c + Vector2(-sz * 0.3, 0), c + Vector2(0, -sz * 0.3), c + Vector2(sz * 0.3, 0)]), Color(1, 1, 1, 0.55))


func deco_plate(c: Vector2, hw: float, hh: float, plate: Color, hover := false, wings := true) -> void:
	## 색이 있는 판 + 이중 금테 + 양끝 보석 + 아래로 번지는 빛
	# 아래로 번지는 빛(바닥 반사)
	var gl := PackedVector2Array()
	for i in 24:
		var a := TAU * i / 24.0
		gl.append(c + Vector2(cos(a) * hw * 0.95, hh + 20.0 + sin(a) * 6.0))
	draw_colored_polygon(gl, Color(plate.lightened(0.25), 0.2))
	var gl2 := PackedVector2Array()
	for i in 24:
		var a2 := TAU * i / 24.0
		gl2.append(c + Vector2(cos(a2) * hw * 1.25, hh + 20.0 + sin(a2) * 11.0))
	draw_colored_polygon(gl2, Color(plate.lightened(0.25), 0.07))
	# 바깥 금테 두 겹
	var o2 := deco_pts(c, hw + 9.0, hh + 8.0, 9.0, 12.0)
	deco_line(o2, Color(GOLD_D, 0.85), 1.2)
	var o1 := deco_pts(c, hw + 4.5, hh + 4.0, 6.0, 9.0)
	deco_line(o1, GOLD_L if not hover else Color.WHITE, 1.7)
	# 판: 위가 밝고 아래가 어두운 색, 안쪽 금선
	var pl := deco_pts(c, hw, hh, 0.0, 6.0)
	var cols := PackedColorArray()
	for p in pl:
		var ty := clampf((p.y - (c.y - hh)) / (2.0 * hh), 0.0, 1.0)
		cols.append(plate.lightened(0.18 if not hover else 0.3).lerp(plate.darkened(0.45), ty))
	draw_polygon(pl, cols)
	draw_colored_polygon(PackedVector2Array([c + Vector2(-hw + 6, -hh), c + Vector2(hw - 6, -hh), c + Vector2(hw, -hh + 6), c + Vector2(hw, -hh * 0.1), c + Vector2(-hw, -hh * 0.1), c + Vector2(-hw, -hh + 6)]), Color(1, 1, 1, 0.09))   # 윗면 광택
	deco_line(deco_pts(c, hw - 3.5, hh - 3.5, 0.0, 4.0), Color(GOLD_L, 0.55), 1.0)
	deco_line(pl, Color(GOLD_D, 0.9), 1.4)
	if wings:
		# 양끝: 이어지는 선과 박힌 보석
		for sx in [-1.0, 1.0]:
			var tp := c + Vector2(sx * (hw + 9.0), 0)
			draw_line(tp, tp + Vector2(sx * 6.0, 0), GOLD_L, 1.6, true)
			deco_diamond(tp + Vector2(sx * 12.0, 0), 6.5, GOLD_L, Color(plate.darkened(0.5), 1.0))


func deco_fit(font: Font, label: String, fs: int, usable: float) -> int:
	var w := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	if w > usable:
		return maxi(10, int(fs * usable / w))
	return fs


func deco_round(c: Vector2, r: float, tint: Color, ring: Color, rdy := true, hover := false, glow := 0.0) -> void:
	## 둥근 아이콘 버튼: 어두운 유리 원 + 금빛 이중 테두리 + 동서남북의 보석
	if glow > 0.0:
		draw_circle(c, r + 9.0, Color(ring, 0.14 * glow))
		draw_circle(c, r + 5.0, Color(ring, 0.1 * glow))
	draw_circle(c + Vector2(0, 3), r + 2.0, Color(0, 0, 0, 0.35))
	draw_circle(c, r, Color(tint.darkened(0.62), 0.94))
	draw_circle(c + Vector2(0, -r * 0.18), r * 0.78, Color(tint.darkened(0.3), 0.35))   # 안쪽 은은한 빛
	draw_arc(c, r + 0.5, 0, TAU, 48, Color(GOLD_D if rdy else GOLD_D.darkened(0.4), 1.0), 3.2, true)
	draw_arc(c, r, 0, TAU, 48, Color(GOLD_L if (rdy and not hover) else Color.WHITE if hover else GOLD_L.darkened(0.45), 1.0), 1.6, true)
	draw_arc(c, r - 5.0, 0, TAU, 48, Color(ring, 0.55 if rdy else 0.2), 1.1, true)
	draw_arc(c, r + 5.0, 0, TAU, 48, Color(GOLD_D, 0.5), 1.0, true)
	draw_arc(c, r * 0.8, PI * 1.1, PI * 1.55, 14, Color(1, 1, 1, 0.22), 2.0, true)   # 유리 반사
	for i in 4:
		var a := i * PI * 0.5
		deco_diamond(c + Vector2(cos(a), sin(a)) * (r + 5.0), 5.2, GOLD_L if rdy else GOLD_L.darkened(0.45), Color(tint.darkened(0.55), 1.0))


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
	var plate := PLATE_TEAL if primary else PLATE_BLUE
	if act.begins_with("to_title") or act == "set:reset" or act == "cheat:lock":
		plate = PLATE_RED
	if not enabled:
		plate = PLATE_GRAY
	var hw := r.size.x * 0.5 - 30.0   # 양끝의 보석까지 버튼 영역 안에 들어오게
	var hh := r.size.y * 0.5 - 10.0
	deco_plate(c, hw, hh, plate, hover)
	var fc := GOLD_L if enabled else Color(0.62, 0.6, 0.66)
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
		var lf: Font = f_bold if r.size.y < 44 else f_disp
		var iw := fs * 1.3 + 4.0 if ic != "" else 0.0
		fs = deco_fit(lf, label, fs, hw * 2.0 - 18.0 - iw)
		if ic != "":
			var tw := lf.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			icon(ic, Vector2(cx - tw / 2 - 6, c.y), fs * 1.3, fc)
			cx += fs * 0.6
		txt(lf, Vector2(cx + 1, c.y + fs * 0.36 + 1), label, fs, Color(0, 0, 0, 0.55), HORIZONTAL_ALIGNMENT_CENTER, false)
		txt(lf, Vector2(cx, c.y + fs * 0.36), label, fs, fc, HORIZONTAL_ALIGNMENT_CENTER, false)
	var pk := press_k(act)
	if pk < 1.0:   # 누른 순간 하얗게 번쩍
		draw_colored_polygon(deco_pts(c, hw, hh, 0.0, 6.0), Color(1, 1, 1, 0.38 * (1.0 - pk)))
	fx_end()
	clicks.append({"rect": r, "act": act})


func icon_button(c: Vector2, r: float, ic: String, act: String, col := C_INK, badge := 0) -> void:
	var hover := not touch_ui and (get_local_mouse_position() - c).length() < r + 6.0
	fx_begin(c, press_scale(act) * (1.08 if hover else 1.0))
	deco_round(c, r, PLATE_BLUE, col, true, hover, 1.0 if hover else 0.0)
	icon(ic, c, r * 1.1, col)
	if badge > 0:
		var bp := c + Vector2(r * 0.78, -r * 0.78)
		draw_circle(bp, 11, C_BLOOD)
		txt(f_bold, bp + Vector2(0, 5), str(badge), 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)
	var pk := press_k(act)
	if pk < 1.0:
		draw_circle(c, r, Color(1, 1, 1, 0.35 * (1.0 - pk)))
	fx_end()
	clicks.append({"rect": Rect2(c - Vector2(r + 6, r + 6), Vector2(r + 6, r + 6) * 2), "act": act})


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
