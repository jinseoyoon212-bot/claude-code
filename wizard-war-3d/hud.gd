extends UIBase
## 전투 화면 UI: 체력바, 아이콘 스킬/아이템/대시 버튼, 가상 조이스틱.

var joy_id := -1
var joy_center := Vector2.ZERO
var joy_pos := Vector2.ZERO
var btn_touch := {}
var buttons := {}

const SLOT_KEYS := ["Q", "E", "R", "F"]
const ITEM_KEYS := ["1", "2", "3"]


func _layout() -> void:
	var s := size
	if not touch_ui:
		_layout_hotbar()
		return
	buttons = {"attack": {"c": Vector2(s.x - 125, s.y - 125), "r": 66.0, "kind": "attack", "key": "Space"}}
	buttons["dash"] = {"c": Vector2(s.x - 410, s.y - 70), "r": 40.0, "kind": "dash", "key": "Shift"}
	var slots := [Vector2(s.x - 290, s.y - 70), Vector2(s.x - 280, s.y - 200), Vector2(s.x - 175, s.y - 275), Vector2(s.x - 55, s.y - 265)]
	for i in Save.equipped.size():
		buttons["slot%d" % i] = {"c": slots[i], "r": 44.0, "kind": "skill", "id": Save.equipped[i], "key": SLOT_KEYS[i]}
	for i in Save.ITEMS.size():
		buttons["item%d" % i] = {"c": Vector2(s.x / 2 - 80.0 + i * 80.0, s.y - 50), "r": 32.0, "kind": "item", "id": Save.ITEMS[i].id, "key": ITEM_KEYS[i]}


func _layout_hotbar() -> void:
	## PC·웹(마우스/키보드): 화면 아래 가운데 단축키 바 (공격은 Space/클릭이라 버튼 없음)
	var s := size
	buttons = {}
	var row: Array = []
	for i in Save.equipped.size():
		row.append({"kind": "skill", "id": Save.equipped[i], "key": SLOT_KEYS[i], "r": 30.0})
	row.append({"kind": "dash", "key": "Shift", "r": 26.0})
	for i in Save.ITEMS.size():
		row.append({"kind": "item", "id": Save.ITEMS[i].id, "key": ITEM_KEYS[i], "r": 24.0})
	var gap := 72.0
	var x0 := s.x / 2 - gap * (row.size() - 1) / 2.0
	for i in row.size():
		var b: Dictionary = row[i]
		b["c"] = Vector2(x0 + i * gap, s.y - 58)
		buttons["hb%d" % i] = b


func _active() -> bool:
	return main != null and main.state == "play" and not main.paused


func _input(ev: InputEvent) -> void:
	if not _active():
		if btn_touch.size() > 0 or joy_id >= 0:
			btn_touch.clear()
			joy_id = -1
			if main:
				main.move_input = Vector2.ZERO
				main.touch_attack = false
		return
	if ev is InputEventScreenTouch:
		if ev.pressed:
			var act := click_at(ev.position)
			if act == "pause":
				Sfx.play("click")
				main.set_paused(true)
				return
			for b in buttons:
				if ev.position.distance_to(buttons[b].c) < buttons[b].r + 10:
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
	var bt: Dictionary = buttons.get(b, {})
	match bt.get("kind", ""):
		"attack":
			main.touch_attack = down
		"dash":
			if down:
				main.dash()
		"skill":
			if down:
				main.use_skill(bt.id)
		"item":
			if down and not main.use_item(bt.id):
				if Save.items[bt.id] <= 0:
					main.menu.say("물약이 없습니다. 상점에서 구매하세요")
					Sfx.play("error")


func _process(_d: float) -> void:
	fit()
	_layout()
	queue_redraw()


func _draw() -> void:
	clicks.clear()
	if main == null or main.hero == null or main.state in ["gate", "intro", "title"]:
		return
	_draw_world_ui()
	if main.state != "play":
		return
	_draw_panels()
	if not touch_ui and buttons.size() > 0:
		var xs: Array = buttons.values().map(func(b): return b.c.x)
		panel(Rect2(xs.min() - 48, size.y - 104, xs.max() - xs.min() + 96, 92), Color(0.04, 0.04, 0.1, 0.72), 18, Color(1, 1, 1, 0.08))
	for b in buttons:
		_draw_button(b, buttons[b])
	if touch_ui:
		_draw_joystick()
	else:
		txt(f_body, Vector2(24, size.y - 18), "WASD 이동 · Space/클릭 공격 · Shift 대시 · Esc 일시정지", 13, C_DIM)


func _draw_world_ui() -> void:
	var cam: Camera3D = main.cam
	for u in main.units:
		if u.dead or u.is_hero or u.scripted:
			continue
		if u.hp >= u.max_hp and u.kind != "crystal" and not u.elite:
			continue
		var wp: Vector3 = u.position + Vector3(0, u.bar_h, 0)
		if cam.is_position_behind(wp):
			continue
		var p := cam.unproject_position(wp)
		var w := 46.0 if u.kind != "crystal" else 90.0
		if u.elite:
			w = 60.0
			icon("star", p + Vector2(-w / 2 - 10, 3), 16, C_GOLD)
		bar(Rect2(p.x - w / 2, p.y, w, 5), u.hp / u.max_hp, C_BLOOD if u.team == 1 else C_OK)
		if u.slow_t > 0.0:
			draw_rect(Rect2(p.x - w / 2, p.y + 6, w * clampf(u.slow_t / 4.0, 0, 1), 2), C_FROST)
	for f in main.floaters:
		if cam.is_position_behind(f.pos):
			continue
		var p := cam.unproject_position(f.pos)
		var sz: float = f.sz
		var pop := 1.0 + maxf(0.0, f.t - 0.7) * 2.0
		txt(f_bold, p, f.text, int(20 * sz * pop), Color(f.col, clampf(f.t * 2.0, 0, 1)), HORIZONTAL_ALIGNMENT_CENTER)


func _draw_panels() -> void:
	var s := size
	if Save.settings.fps:
		var fps := Engine.get_frames_per_second()
		txt(f_bold, Vector2(360, 36), "FPS %d" % fps, 16, C_OK if fps >= 50 else (C_GOLD if fps >= 30 else C_BLOOD))
	panel(Rect2(16, 16, 330, 92))
	txt(f_bold, Vector2(30, 42), "대마법사", 15, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_body, Vector2(332, 42), "%d / %d" % [main.hero.hp, main.hero.max_hp], 13, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	bar(Rect2(30, 50, 302, 12), main.hero.hp / main.hero.max_hp, C_OK if main.hero.hp > main.hero.max_hp * 0.3 else C_BLOOD)
	txt(f_bold, Vector2(30, 84), "빛의 수정", 13, C_FROST, HORIZONTAL_ALIGNMENT_LEFT, false)
	bar(Rect2(110, 75, 222, 10), main.crystal.hp / main.crystal.max_hp, C_FROST)
	if Save.cheats.god or Save.cheats.one_hit or Save.cheats.no_cd or Save.cheats.speed > 1:
		txt(f_bold, Vector2(30, 128), "치트 사용 중", 12, C_BLOOD)
	panel(Rect2(s.x - 196, 16, 180, 70))
	txt(f_body, Vector2(s.x - 30, 42), "웨이브", 12, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT, false)
	var wtxt := ("%d" % main.wave) if main.endless else ("%d / %d" % [maxi(main.wave, 0), main.max_wave])
	txt(f_disp, Vector2(s.x - 30, 74), wtxt, 26, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	txt(f_body, Vector2(s.x - 180, 42), "처치", 12, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_disp, Vector2(s.x - 180, 74), str(main.kills), 26, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
	gold_chip(Vector2(s.x - 16, 96))
	icon_button(Vector2(s.x - 236, 44), 26, "pause", "pause", C_INK)
	var b: Unit = main.boss
	if b != null and is_instance_valid(b) and not b.dead:
		var bw := minf(520.0, s.x - 820.0) if s.x > 1180 else s.x - 80.0
		var by := 40.0 if s.x > 1180 else 160.0
		icon("boss", Vector2(s.x / 2 - bw / 2 - 20, by + 12), 30, Color("d9a8ff") if not b.enraged else C_BLOOD)
		txt(f_disp, Vector2(s.x / 2, by), b.display_name + ("  (분노)" if b.enraged else ""), 20, Color("d9a8ff") if not b.enraged else C_BLOOD, HORIZONTAL_ALIGNMENT_CENTER)
		bar(Rect2(s.x / 2 - bw / 2, by + 10, bw, 14), b.hp / b.max_hp, C_HEX if not b.enraged else C_BLOOD)
	if main.banner_t > 0.0:
		var a := clampf(main.banner_t * 2.0, 0, 1)
		var pop := 1.0 + maxf(0.0, main.banner_t - 2.2) * 0.6
		txt(f_disp, Vector2(s.x / 2, s.y * 0.3), main.banner, int(46 * pop), Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_CENTER)
		txt(f_body, Vector2(s.x / 2, s.y * 0.3 + 40), main.banner_sub, 18, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	# 체력이 낮으면 붉은 테두리
	var hk: float = main.hero.hp / main.hero.max_hp
	if hk < 0.3:
		var a2 := (0.3 - hk) * 1.6 * (0.6 + 0.4 * sin(main.t * 6.0))
		for i in 6:
			var g := 6.0 * i
			draw_rect(Rect2(g, g, s.x - g * 2, s.y - g * 2), Color(1, 0, 0, a2 * (1.0 - i / 6.0) * 0.4), false, 6.0)


func _draw_button(bname: String, bt: Dictionary) -> void:
	var c: Vector2 = bt.c
	var r: float = bt.r
	var pressed: bool = btn_touch.values().has(bname) or (bname == "attack" and main.touch_attack)
	var id: String = bt.kind if bt.kind in ["attack", "dash"] else bt.id
	var col: Color = SKILL_COL.get(id, C_GOLD)
	var rdy := true
	var cdk := 0.0
	if bt.kind == "skill" or bt.kind == "dash":
		cdk = main.cds[id] / main.cd_max[id] if main.cd_max[id] > 0 else 0.0
		rdy = cdk <= 0.0
	elif bt.kind == "item":
		rdy = Save.items[id] > 0
	if rdy and bt.kind == "skill":
		draw_circle(c, r + 4, Color(col, 0.12 + 0.06 * sin(main.t * 4.0)))
	draw_circle(c, r, Color(0.07, 0.07, 0.16, 0.82) if not pressed else Color(0.3, 0.26, 0.1, 0.92))
	draw_arc(c, r, 0, TAU, 48, Color(col, 0.9 if rdy else 0.3), 3.0, true)
	icon(id, c, r * 1.15, Color(col, 1.0 if rdy else 0.3))
	if cdk > 0.0:
		draw_arc(c, r - 5, -PI / 2, -PI / 2 + TAU * cdk, 48, Color(1, 1, 1, 0.45), 7.0, true)
		txt(f_bold, c + Vector2(0, 9), "%.0f" % ceilf(main.cds[id]) if main.cds[id] >= 1.0 else "%.1f" % main.cds[id], 22, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	if bt.kind == "item":
		draw_circle(c + Vector2(r * 0.72, -r * 0.72), 12, C_GOLD if rdy else Color(0.3, 0.3, 0.35))
		txt(f_bold, c + Vector2(r * 0.72, -r * 0.72 + 6), str(Save.items[id]), 14, C_DARK, HORIZONTAL_ALIGNMENT_CENTER, false)
	if bt.kind == "skill":
		if touch_ui:
			txt(f_bold, c + Vector2(0, r + 14), "Lv%d" % Save.skills[id], 11, Color(col, 0.9), HORIZONTAL_ALIGNMENT_CENTER)
	if not touch_ui and bt.has("key"):
		var kp := c + Vector2(-r * 0.72, r * 0.72)
		var kw := 22.0 if bt.key.length() == 1 else 44.0
		panel(Rect2(kp - Vector2(kw / 2, 10), Vector2(kw, 20)), Color(0, 0, 0, 0.8), 10)
		txt(f_bold, kp + Vector2(0, 5), bt.key, 11, C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)


func _draw_joystick() -> void:
	var c := joy_center if joy_id >= 0 else Vector2(170, size.y - 170)
	draw_circle(c, 90, Color(1, 1, 1, 0.08))
	draw_arc(c, 90, 0, TAU, 48, Color(1, 1, 1, 0.25), 2.0, true)
	var k := joy_pos if joy_id >= 0 else c
	if (k - c).length() > 80:
		k = c + (k - c).normalized() * 80
	draw_circle(k, 38, Color(1, 1, 1, 0.3))
