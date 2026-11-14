extends Control
## 화면 UI: 체력바, 스킬 버튼, 가상 조이스틱, 시작/결과 화면.

var main
var f_body: Font
var f_bold: Font
var f_disp: Font
var touch_ui := false

var joy_id := -1
var joy_center := Vector2.ZERO
var joy_pos := Vector2.ZERO
var btn_touch := {}
var buttons := {}
var start_rect := Rect2()

const C_GOLD := Color("e8b84a")
const C_INK := Color("f1ead6")
const C_DIM := Color("b8b0c8")
const C_PANEL := Color(0.06, 0.06, 0.14, 0.72)
const C_FROST := Color("7fd6e8")
const C_HEX := Color("b46cf0")
const C_BLOOD := Color("e2556b")

const SKILLS := [
	["attack", "공격", "Space"],
	["shield", "결계", "Q"],
	["nova", "별빛 폭발", "E"],
	["summon", "기사 소환", "R"],
]


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


func _layout() -> void:
	var s := size
	buttons = {
		"attack": {"c": Vector2(s.x - 130, s.y - 130), "r": 70.0},
		"shield": {"c": Vector2(s.x - 285, s.y - 85), "r": 46.0},
		"nova": {"c": Vector2(s.x - 265, s.y - 225), "r": 46.0},
		"summon": {"c": Vector2(s.x - 130, s.y - 290), "r": 46.0},
	}
	start_rect = Rect2(s.x / 2 - 130, s.y * 0.72, 260, 64)


func _input(ev: InputEvent) -> void:
	if main == null:
		return
	if ev is InputEventScreenTouch:
		if ev.pressed:
			if main.state != "play":
				if start_rect.grow(10).has_point(ev.position) and (main.state == "title" or main.end_t > 1.0):
					main.start_game()
				return
			for b in buttons:
				if ev.position.distance_to(buttons[b].c) < buttons[b].r + 12:
					btn_touch[ev.index] = b
					_press(b, true)
					return
			if touch_ui and ev.position.x < size.x * 0.5:
				joy_id = ev.index
				joy_center = ev.position
				joy_pos = ev.position
				return
			if not touch_ui:
				btn_touch[ev.index] = "attack"
				_press("attack", true)
		else:
			if btn_touch.has(ev.index):
				_press(btn_touch[ev.index], false)
				btn_touch.erase(ev.index)
			if ev.index == joy_id:
				joy_id = -1
				main.move_input = Vector2.ZERO
	elif ev is InputEventScreenDrag and ev.index == joy_id:
		joy_pos = ev.position
		var d: Vector2 = joy_pos - joy_center
		if d.length() > 80.0:
			d = d.normalized() * 80.0
		main.move_input = d / 80.0


func _press(b: String, down: bool) -> void:
	if b == "attack":
		main.touch_attack = down
	elif down:
		main.use_skill(b)


func _process(_d: float) -> void:
	position = Vector2.ZERO
	size = get_viewport_rect().size
	_layout()
	queue_redraw()


func txt(font: Font, pos: Vector2, s: String, fs: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, outline := true) -> void:
	var x := pos.x
	var w := -1.0
	if align == HORIZONTAL_ALIGNMENT_CENTER:
		x -= 600
		w = 1200
	elif align == HORIZONTAL_ALIGNMENT_RIGHT:
		x -= 1200
		w = 1200
	if outline:
		draw_string_outline(font, Vector2(x, pos.y), s, align, w, fs, 5, Color(0, 0, 0, 0.6))
	draw_string(font, Vector2(x, pos.y), s, align, w, fs, col)


func bar(r: Rect2, k: float, col: Color) -> void:
	draw_rect(r.grow(2), Color(0, 0, 0, 0.6))
	draw_rect(r, Color(0.15, 0.13, 0.2))
	draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(k, 0, 1), r.size.y)), col)


func panel(r: Rect2) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = C_PANEL
	sb.set_corner_radius_all(10)
	sb.border_color = Color(1, 1, 1, 0.08)
	sb.set_border_width_all(1)
	draw_style_box(sb, r)


func _draw() -> void:
	if main == null or main.hero == null:
		return
	var s := size
	var cam: Camera3D = main.cam
	# 유닛 체력바
	for u in main.units:
		if u.dead or u.is_hero:
			continue
		if u.hp >= u.max_hp and u.kind != "crystal":
			continue
		var wp: Vector3 = u.position + Vector3(0, u.bar_h, 0)
		if cam.is_position_behind(wp):
			continue
		var p := cam.unproject_position(wp)
		var w := 46.0 if u.kind != "crystal" else 90.0
		bar(Rect2(p.x - w / 2, p.y, w, 5), u.hp / u.max_hp, C_BLOOD if u.team == 1 else Color("5fd38a"))
	# 데미지 숫자
	for f in main.floaters:
		if cam.is_position_behind(f.pos):
			continue
		var p := cam.unproject_position(f.pos)
		txt(f_bold, p, f.text, 20, Color(f.col, clampf(f.t * 2.0, 0, 1)), HORIZONTAL_ALIGNMENT_CENTER)

	# 상단 좌측: 영웅/수정
	panel(Rect2(16, 16, 330, 92))
	txt(f_bold, Vector2(30, 42), "대마법사", 15, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_body, Vector2(332, 42), "%d / %d" % [main.hero.hp, main.hero.max_hp], 13, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	bar(Rect2(30, 50, 302, 12), main.hero.hp / main.hero.max_hp, Color("5fd38a"))
	txt(f_bold, Vector2(30, 84), "빛의 수정", 13, C_FROST, HORIZONTAL_ALIGNMENT_LEFT, false)
	bar(Rect2(110, 75, 222, 10), main.crystal.hp / main.crystal.max_hp, C_FROST)
	# 상단 우측: 웨이브/처치
	panel(Rect2(s.x - 196, 16, 180, 70))
	txt(f_body, Vector2(s.x - 30, 42), "웨이브", 12, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT, false)
	txt(f_disp, Vector2(s.x - 30, 74), "%d / %d" % [maxi(main.wave, 0), main.MAX_WAVE], 26, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	txt(f_body, Vector2(s.x - 180, 42), "처치", 12, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_disp, Vector2(s.x - 180, 74), str(main.kills), 26, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
	# 보스 체력
	var b: Unit = main.boss
	if b != null and is_instance_valid(b) and not b.dead:
		var bw := minf(560.0, s.x - 760.0) if s.x > 1100 else s.x - 80.0
		var by := 40.0 if s.x > 1100 else 120.0
		txt(f_disp, Vector2(s.x / 2, by), b.display_name, 20, Color("d9a8ff"), HORIZONTAL_ALIGNMENT_CENTER)
		bar(Rect2(s.x / 2 - bw / 2, by + 10, bw, 14), b.hp / b.max_hp, C_HEX)
	# 배너
	if main.banner_t > 0.0 and main.state == "play":
		var a := clampf(main.banner_t * 2.0, 0, 1)
		txt(f_disp, Vector2(s.x / 2, s.y * 0.3), main.banner, 46, Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_CENTER)
		txt(f_body, Vector2(s.x / 2, s.y * 0.3 + 40), main.banner_sub, 18, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)

	if main.state == "play":
		_draw_buttons()
		if touch_ui:
			_draw_joystick()
		else:
			txt(f_body, Vector2(24, s.y - 22), "WASD 이동 · Space/클릭 공격(자동 조준) · Q 결계 · E 별빛 폭발 · R 기사 소환", 14, C_DIM)
	elif main.state == "title":
		_draw_title()
	else:
		_draw_end()


func _draw_buttons() -> void:
	for sk in SKILLS:
		var id: String = sk[0]
		var bt: Dictionary = buttons[id]
		var c: Vector2 = bt.c
		var r: float = bt.r
		var cdk: float = main.cds[id] / main.CD_MAX[id] if id != "attack" else 0.0
		var pressed: bool = btn_touch.values().has(id) or (id == "attack" and main.touch_attack)
		draw_circle(c, r, Color(0.08, 0.08, 0.18, 0.75) if not pressed else Color(0.25, 0.22, 0.1, 0.85))
		var col := C_GOLD if id == "attack" else (C_FROST if id == "shield" else (Color("ffd36b") if id == "nova" else Color("9fc3ff")))
		draw_arc(c, r, 0, TAU, 48, Color(col, 0.35 if cdk > 0 else 0.9), 3.0, true)
		if cdk > 0:
			draw_arc(c, r - 6, -PI / 2, -PI / 2 + TAU * cdk, 48, Color(1, 1, 1, 0.35), 8.0, true)
			txt(f_bold, c + Vector2(0, 8), "%.0f" % ceilf(main.cds[id]), 22, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
		else:
			txt(f_bold, c + Vector2(0, 6 if touch_ui else 0), sk[1], 18 if id == "attack" else 14, col, HORIZONTAL_ALIGNMENT_CENTER)
		if not touch_ui:
			txt(f_body, c + Vector2(0, 20), sk[2], 11, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func _draw_joystick() -> void:
	var c := joy_center if joy_id >= 0 else Vector2(170, size.y - 170)
	draw_circle(c, 90, Color(1, 1, 1, 0.08))
	draw_arc(c, 90, 0, TAU, 48, Color(1, 1, 1, 0.25), 2.0, true)
	var k := joy_pos if joy_id >= 0 else c
	if (k - c).length() > 80:
		k = c + (k - c).normalized() * 80
	draw_circle(k, 38, Color(1, 1, 1, 0.3))
	if joy_id < 0:
		txt(f_body, c + Vector2(0, 6), "이동", 14, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func _start_button(label: String) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = C_GOLD
	sb.set_corner_radius_all(32)
	draw_style_box(sb, start_rect)
	txt(f_disp, start_rect.get_center() + Vector2(0, 9), label, 24, Color("15132a"), HORIZONTAL_ALIGNMENT_CENTER, false)


func _draw_title() -> void:
	var s := size
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.03, 0.03, 0.1, 0.62))
	txt(f_disp, Vector2(s.x / 2, s.y * 0.2), "빛과 어둠의 마법 전쟁", 56, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.2 + 46), "어둠의 군주 모르가스가 해골 군단을 이끌고 성으로 진군합니다.", 18, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.2 + 74), "대마법사가 되어 빛의 기사단과 함께 빛의 수정을 지키세요. 5번째 웨이브에 군주가 직접 나타납니다.", 16, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	var lines: Array
	if touch_ui:
		lines = ["왼쪽 화면 드래그 : 이동", "공격 버튼 꾹 누르기 : 가까운 적 자동 조준", "결계 · 별빛 폭발 · 기사 소환 : 스킬 버튼"]
	else:
		lines = ["WASD / 방향키 : 이동", "Space · 마우스 클릭 유지 : 공격 (가까운 적 자동 조준)", "Q 결계 (3.5초 무적) · E 별빛 폭발 (주변 적 넉백) · R 빛의 기사 2명 소환"]
	panel(Rect2(s.x / 2 - 330, s.y * 0.42, 660, 132))
	for i in lines.size():
		txt(f_body, Vector2(s.x / 2, s.y * 0.42 + 38 + i * 34), lines[i], 17, C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)
	_start_button("전투 시작")
	txt(f_body, Vector2(s.x / 2, s.y - 18), "3D 모델: KayKit by Kay Lousberg (CC0)", 12, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func _draw_end() -> void:
	var s := size
	var a := clampf(main.end_t / 1.2, 0, 1)
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.03, 0.03, 0.1, 0.55 * a))
	var win: bool = main.state == "win"
	txt(f_disp, Vector2(s.x / 2, s.y * 0.32), main.banner, 72, Color(C_GOLD if win else C_BLOOD, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.32 + 50), main.banner_sub, 22, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.32 + 90), "웨이브 %d · 처치 %d" % [main.wave, main.kills], 18, Color(C_DIM, a), HORIZONTAL_ALIGNMENT_CENTER)
	if main.end_t > 1.0:
		_start_button("다시 하기")
