extends Control
## 화면 UI: 체력바, 아이콘 스킬/아이템 버튼, 가상 조이스틱, 시작 화면, 상점, 결과 화면.

var main
var f_body: Font
var f_bold: Font
var f_disp: Font
var touch_ui := false
var icons := {}

var joy_id := -1
var joy_center := Vector2.ZERO
var joy_pos := Vector2.ZERO
var btn_touch := {}
var buttons := {}        # 전투 중 버튼: id -> {c, r, kind}
var clicks: Array = []   # 메뉴 화면 클릭 영역: [{rect, act}]
var shop_tab := "up"
var toast := ""
var toast_t := 0.0

const C_GOLD := Color("e8b84a")
const C_INK := Color("f1ead6")
const C_DIM := Color("b8b0c8")
const C_PANEL := Color(0.06, 0.06, 0.14, 0.78)
const C_CARD := Color(0.1, 0.1, 0.2, 0.92)
const C_FROST := Color("7fd6e8")
const C_HEX := Color("b46cf0")
const C_BLOOD := Color("e2556b")
const C_OK := Color("5fd38a")

const SKILL_COL := {
	"attack": Color("ffb347"), "shield": Color("7fd6e8"), "nova": Color("ffd36b"), "summon": Color("9fc3ff"),
	"chain": Color("b9d4ff"), "frost": Color("a8ecff"), "heal": Color("7fe39a"), "meteor": Color("ff8a4c"),
}
const SLOT_KEYS := ["Q", "E", "R", "F"]
const ITEM_KEYS := ["1", "2", "3"]


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
	for n in ["attack", "shield", "nova", "summon", "chain", "frost", "heal", "meteor", "potion_hp", "potion_mana",
			"potion_crystal", "up_power", "up_hp", "up_speed", "up_knight", "up_crystal", "up_mastery", "gold"]:
		icons[n] = load("res://icons/%s.svg" % n)


func _layout() -> void:
	var s := size
	buttons = {"attack": {"c": Vector2(s.x - 120, s.y - 120), "r": 66.0, "kind": "attack"}}
	var slots := [Vector2(s.x - 262, s.y - 66), Vector2(s.x - 250, s.y - 200), Vector2(s.x - 130, s.y - 270), Vector2(s.x - 384, s.y - 66)]
	for i in Save.equipped.size():
		buttons["slot%d" % i] = {"c": slots[i], "r": 44.0, "kind": "skill", "id": Save.equipped[i], "key": SLOT_KEYS[i]}
	var ix := s.x / 2 - 80.0 if touch_ui else s.x / 2 - 80.0
	for i in Save.ITEMS.size():
		buttons["item%d" % i] = {"c": Vector2(ix + i * 80.0, s.y - 52), "r": 32.0, "kind": "item", "id": Save.ITEMS[i].id, "key": ITEM_KEYS[i]}


func say(msg: String) -> void:
	toast = msg
	toast_t = 2.2


func _input(ev: InputEvent) -> void:
	if main == null:
		return
	if ev is InputEventScreenTouch:
		if ev.pressed:
			if main.state != "play":
				for c in clicks:
					if c.rect.has_point(ev.position):
						_menu_action(c.act)
						return
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
	if b == "attack":
		main.touch_attack = down
	elif down and bt.get("kind") == "skill":
		main.use_skill(bt.id)
	elif down and bt.get("kind") == "item":
		if Save.items[bt.id] <= 0:
			say("물약이 없습니다. 상점에서 구매하세요")
		main.use_item(bt.id)


func _menu_action(act: String) -> void:
	var p := act.split(":")
	var err := ""
	match p[0]:
		"start":
			main.start_game()
		"shop":
			if main.state == "win" or main.state == "lose":
				Save.next_action = "shop"
				get_tree().reload_current_scene()
			else:
				main.state = "shop"
		"back":
			main.state = "title"
		"tab":
			shop_tab = p[1]
		"buy_up":
			err = Save.buy_upgrade(p[1])
			if err == "": say("강화 완료!")
		"buy_skill":
			var first: bool = Save.skills[p[1]] == 0
			err = Save.buy_skill(p[1])
			if err == "": say("스킬 습득!" if first else "스킬 레벨 업!")
		"equip":
			err = Save.toggle_equip(p[1])
		"buy_item":
			err = Save.buy_item(p[1])
			if err == "": say("구매 완료!")
	if err != "":
		say(err)


func _process(d: float) -> void:
	position = Vector2.ZERO
	size = get_viewport_rect().size
	toast_t -= d
	_layout()
	queue_redraw()


# ---------------- 그리기 도우미 ----------------
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


func panel(r: Rect2, col := C_PANEL, rad := 10, border := Color(1, 1, 1, 0.08)) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(rad)
	sb.border_color = border
	sb.set_border_width_all(1)
	draw_style_box(sb, r)


func icon(id: String, c: Vector2, sz: float, col: Color) -> void:
	if icons.has(id) and icons[id]:
		draw_texture_rect(icons[id], Rect2(c - Vector2(sz, sz) / 2, Vector2(sz, sz)), false, col)


func button(r: Rect2, label: String, act: String, enabled := true, primary := true) -> void:
	var bg := C_GOLD if primary else Color(0.2, 0.2, 0.34)
	if not enabled:
		bg = Color(0.25, 0.25, 0.3)
	panel(r, bg, int(r.size.y / 2), Color(1, 1, 1, 0.12))
	var fc := Color("15132a") if primary and enabled else (C_INK if enabled else C_DIM)
	var fs := 15 if r.size.y < 44 else 22
	txt(f_bold if r.size.y < 44 else f_disp, Vector2(r.get_center().x, r.get_center().y + fs * 0.36), label, fs, fc, HORIZONTAL_ALIGNMENT_CENTER, false)
	clicks.append({"rect": r, "act": act})


func gold_chip(pos: Vector2, right_align := true) -> void:
	var s := "%d" % Save.gold
	var w := 54.0 + s.length() * 13.0
	var r := Rect2(pos.x - (w if right_align else 0.0), pos.y, w, 40)
	panel(r, Color(0.08, 0.07, 0.04, 0.85), 20, Color(C_GOLD, 0.4))
	icon("gold", Vector2(r.position.x + 22, r.get_center().y), 26, C_GOLD)
	txt(f_bold, Vector2(r.position.x + 40, r.position.y + 27), s, 18, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)


# ---------------- 메인 그리기 ----------------
func _draw() -> void:
	if main == null or main.hero == null:
		return
	clicks.clear()
	match main.state:
		"play":
			_draw_battle()
		"title":
			_draw_title()
		"shop":
			_draw_shop()
		_:
			_draw_battle_status()
			_draw_end()
	if toast_t > 0.0:
		var a := clampf(toast_t * 2.0, 0, 1)
		var w := 40.0 + toast.length() * 15.0
		panel(Rect2(size.x / 2 - w / 2, size.y - 120, w, 44), Color(0.05, 0.05, 0.1, 0.9 * a), 22, Color(C_GOLD, 0.4 * a))
		txt(f_bold, Vector2(size.x / 2, size.y - 91), toast, 16, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER, false)


func _draw_battle_status() -> void:
	var s := size
	var cam: Camera3D = main.cam
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
		bar(Rect2(p.x - w / 2, p.y, w, 5), u.hp / u.max_hp, C_BLOOD if u.team == 1 else C_OK)
		if u.slow_t > 0.0:
			draw_rect(Rect2(p.x - w / 2, p.y + 6, w * clampf(u.slow_t / 4.0, 0, 1), 2), C_FROST)
	for f in main.floaters:
		if cam.is_position_behind(f.pos):
			continue
		var p := cam.unproject_position(f.pos)
		txt(f_bold, p, f.text, 20, Color(f.col, clampf(f.t * 2.0, 0, 1)), HORIZONTAL_ALIGNMENT_CENTER)

	panel(Rect2(16, 16, 330, 92))
	txt(f_bold, Vector2(30, 42), "대마법사", 15, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_body, Vector2(332, 42), "%d / %d" % [main.hero.hp, main.hero.max_hp], 13, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	bar(Rect2(30, 50, 302, 12), main.hero.hp / main.hero.max_hp, C_OK)
	txt(f_bold, Vector2(30, 84), "빛의 수정", 13, C_FROST, HORIZONTAL_ALIGNMENT_LEFT, false)
	bar(Rect2(110, 75, 222, 10), main.crystal.hp / main.crystal.max_hp, C_FROST)
	panel(Rect2(s.x - 196, 16, 180, 70))
	txt(f_body, Vector2(s.x - 30, 42), "웨이브", 12, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT, false)
	txt(f_disp, Vector2(s.x - 30, 74), "%d / %d" % [maxi(main.wave, 0), main.MAX_WAVE], 26, C_INK, HORIZONTAL_ALIGNMENT_RIGHT, false)
	txt(f_body, Vector2(s.x - 180, 42), "처치", 12, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	txt(f_disp, Vector2(s.x - 180, 74), str(main.kills), 26, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
	gold_chip(Vector2(s.x - 16, 96))
	var b: Unit = main.boss
	if b != null and is_instance_valid(b) and not b.dead:
		var bw := minf(560.0, s.x - 760.0) if s.x > 1100 else s.x - 80.0
		var by := 40.0 if s.x > 1100 else 150.0
		txt(f_disp, Vector2(s.x / 2, by), b.display_name, 20, Color("d9a8ff"), HORIZONTAL_ALIGNMENT_CENTER)
		bar(Rect2(s.x / 2 - bw / 2, by + 10, bw, 14), b.hp / b.max_hp, C_HEX)
	if main.banner_t > 0.0 and main.state == "play":
		var a := clampf(main.banner_t * 2.0, 0, 1)
		txt(f_disp, Vector2(s.x / 2, s.y * 0.3), main.banner, 46, Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_CENTER)
		txt(f_body, Vector2(s.x / 2, s.y * 0.3 + 40), main.banner_sub, 18, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)


func _draw_battle() -> void:
	_draw_battle_status()
	for b in buttons:
		_draw_button(b, buttons[b])
	if touch_ui:
		_draw_joystick()
	else:
		txt(f_body, Vector2(24, size.y - 22), "WASD 이동 · Space/클릭 공격 · Q E R F 스킬 · 1 2 3 물약", 14, C_DIM)


func _draw_button(bname: String, bt: Dictionary) -> void:
	var c: Vector2 = bt.c
	var r: float = bt.r
	var pressed: bool = btn_touch.values().has(bname) or (bname == "attack" and main.touch_attack)
	var id: String = "attack" if bt.kind == "attack" else bt.id
	var col: Color = SKILL_COL.get(id, C_GOLD)
	var rdy := true
	var cdk := 0.0
	if bt.kind == "skill":
		cdk = main.cds[id] / main.cd_max[id] if main.cd_max[id] > 0 else 0.0
		rdy = cdk <= 0.0
	elif bt.kind == "item":
		rdy = Save.items[id] > 0
	draw_circle(c, r, Color(0.07, 0.07, 0.16, 0.8) if not pressed else Color(0.28, 0.24, 0.1, 0.9))
	draw_arc(c, r, 0, TAU, 48, Color(col, 0.9 if rdy else 0.3), 3.0, true)
	icon(id, c, r * 1.15, Color(col, 1.0 if rdy else 0.3))
	if bt.kind == "skill" and cdk > 0.0:
		draw_arc(c, r - 5, -PI / 2, -PI / 2 + TAU * cdk, 48, Color(1, 1, 1, 0.45), 7.0, true)
		txt(f_bold, c + Vector2(0, 9), "%.0f" % ceilf(main.cds[id]), 24, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	if bt.kind == "item":
		draw_circle(c + Vector2(r * 0.72, -r * 0.72), 12, C_GOLD if rdy else Color(0.3, 0.3, 0.35))
		txt(f_bold, c + Vector2(r * 0.72, -r * 0.72 + 6), str(Save.items[id]), 14, Color("15132a"), HORIZONTAL_ALIGNMENT_CENTER, false)
	if not touch_ui and bt.has("key"):
		var kp := c + Vector2(-r * 0.72, r * 0.72)
		draw_circle(kp, 11, Color(0, 0, 0, 0.75))
		txt(f_bold, kp + Vector2(0, 5), bt.key, 12, C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)


func _draw_joystick() -> void:
	var c := joy_center if joy_id >= 0 else Vector2(170, size.y - 170)
	draw_circle(c, 90, Color(1, 1, 1, 0.08))
	draw_arc(c, 90, 0, TAU, 48, Color(1, 1, 1, 0.25), 2.0, true)
	var k := joy_pos if joy_id >= 0 else c
	if (k - c).length() > 80:
		k = c + (k - c).normalized() * 80
	draw_circle(k, 38, Color(1, 1, 1, 0.3))


# ---------------- 시작 화면 ----------------
func _draw_title() -> void:
	var s := size
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.03, 0.03, 0.1, 0.62))
	gold_chip(Vector2(s.x - 20, 20))
	txt(f_disp, Vector2(s.x / 2, s.y * 0.2), "빛과 어둠의 마법 전쟁", 56, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.2 + 46), "어둠의 군주 모르가스가 해골 군단을 이끌고 성으로 진군합니다.", 18, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.2 + 74), "적을 쓰러뜨려 골드를 모으고, 상점에서 스킬과 물약을 사서 더 강해지세요.", 16, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	# 장착 스킬 미리보기
	var n: int = Save.equipped.size()
	var x0 := s.x / 2 - (n * 84.0) / 2 + 42
	txt(f_body, Vector2(s.x / 2, s.y * 0.44), "장착한 스킬", 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	for i in n:
		var id: String = Save.equipped[i]
		var c := Vector2(x0 + i * 84.0, s.y * 0.44 + 50)
		draw_circle(c, 34, Color(0.07, 0.07, 0.16, 0.9))
		draw_arc(c, 34, 0, TAU, 40, SKILL_COL[id], 2.0, true)
		icon(id, c, 40, SKILL_COL[id])
		txt(f_bold, c + Vector2(0, 52), "%s Lv%d" % [Save.SKILLS[id].name, Save.skills[id]], 12, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	button(Rect2(s.x / 2 - 270, s.y * 0.74, 260, 62), "전투 시작", "start")
	button(Rect2(s.x / 2 + 10, s.y * 0.74, 260, 62), "상점", "shop", true, false)
	var rec := "최고 기록: 웨이브 %d · 승리 %d회" % [Save.best_wave, Save.wins]
	txt(f_body, Vector2(s.x / 2, s.y * 0.74 + 92), rec, 14, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y - 14), "3D 모델: KayKit by Kay Lousberg (CC0) · 아이콘: game-icons.net (CC BY 3.0)", 12, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


# ---------------- 상점 ----------------
func _draw_shop() -> void:
	var s := size
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.03, 0.03, 0.09, 0.88))
	txt(f_disp, Vector2(40, 62), "마법 상점", 38, C_GOLD)
	gold_chip(Vector2(s.x - 30, 30))
	var tabs := [["up", "강화"], ["skill", "스킬"], ["item", "물약"]]
	for i in tabs.size():
		var r := Rect2(260 + i * 130, 30, 120, 44)
		var on: bool = shop_tab == tabs[i][0]
		panel(r, Color(C_GOLD, 0.95) if on else Color(0.14, 0.14, 0.26), 22, Color(1, 1, 1, 0.1))
		txt(f_bold, Vector2(r.get_center().x, r.position.y + 29), tabs[i][1], 17, Color("15132a") if on else C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)
		clicks.append({"rect": r, "act": "tab:" + tabs[i][0]})
	var cards: Array = []
	match shop_tab:
		"up":
			for u in Save.UPGRADES:
				cards.append(_up_card(u))
		"skill":
			for id in Save.SKILL_ORDER:
				cards.append(_skill_card(id))
		"item":
			for it in Save.ITEMS:
				cards.append(_item_card(it))
	var cols := 4 if shop_tab == "skill" else 3
	var gap := 16.0
	var cw := minf(300.0, (s.x - 80 - gap * (cols - 1)) / cols)
	var ch := 214.0
	var total_w := cw * cols + gap * (cols - 1)
	var x0 := s.x / 2 - total_w / 2
	var y0 := 104.0
	for i in cards.size():
		var r := Rect2(x0 + (i % cols) * (cw + gap), y0 + (i / cols) * (ch + gap), cw, ch)
		_draw_card(r, cards[i])
	if shop_tab == "skill":
		txt(f_body, Vector2(s.x / 2, y0 + 2 * (ch + gap) + 6), "장착 슬롯 %d / %d · 전투에서는 장착한 스킬만 쓸 수 있습니다" % [Save.equipped.size(), Save.MAX_EQUIP], 14, C_DIM, HORIZONTAL_ALIGNMENT_CENTER, false)
	button(Rect2(40, s.y - 84, 200, 56), "돌아가기", "back", true, false)
	button(Rect2(s.x - 260, s.y - 84, 220, 56), "전투 시작", "start")


func _up_card(u: Dictionary) -> Dictionary:
	var lv: int = Save.up[u.id]
	var maxed := lv >= Save.MAX_UP
	return {"icon": u.icon, "col": C_GOLD, "title": u.name, "lv": lv, "mx": Save.MAX_UP,
		"line1": "현재: " + (Save.up_desc(u.id, lv) if lv > 0 else "없음"),
		"line2": "" if maxed else "다음: " + Save.up_desc(u.id, lv + 1),
		"btn": "최대" if maxed else "강화  %dG" % Save.up_cost(u.id), "act": "buy_up:" + u.id,
		"enabled": not maxed and Save.gold >= Save.up_cost(u.id)}


func _skill_card(id: String) -> Dictionary:
	var lv: int = Save.skills[id]
	var maxed := lv >= Save.MAX_SKILL
	var cost := Save.skill_cost(id)
	var c := {"icon": id, "col": SKILL_COL[id], "title": Save.SKILLS[id].name, "lv": lv, "mx": Save.MAX_SKILL,
		"line1": Save.skill_desc(id, maxi(lv, 1)) + " · 대기 %.0f초" % Save.skill_cd(id),
		"line2": "" if maxed or lv == 0 else "다음: " + Save.skill_desc(id, lv + 1),
		"btn": "최대" if maxed else ("구매  %dG" % cost if lv == 0 else "레벨업  %dG" % cost),
		"act": "buy_skill:" + id, "enabled": not maxed and Save.gold >= cost}
	if lv > 0:
		var eq: bool = Save.equipped.has(id)
		c["btn2"] = "장착 해제" if eq else "장착"
		c["act2"] = "equip:" + id
		c["equipped"] = eq
	return c


func _item_card(it: Dictionary) -> Dictionary:
	var n: int = Save.items[it.id]
	return {"icon": it.icon, "col": Color("ff9a9a") if it.id == "potion_hp" else (Color("b59cff") if it.id == "potion_mana" else C_FROST),
		"title": it.name, "lv": -1, "line1": it.desc, "line2": "보유 %d / %d개 · 전투 중 사용" % [n, Save.MAX_ITEM],
		"btn": "구매  %dG" % it.price, "act": "buy_item:" + it.id, "enabled": n < Save.MAX_ITEM and Save.gold >= it.price}


func _draw_card(r: Rect2, c: Dictionary) -> void:
	panel(r, C_CARD, 14, Color(c.col, 0.55) if c.get("equipped", false) else Color(1, 1, 1, 0.1))
	var ic := r.position + Vector2(44, 48)
	draw_circle(ic, 30, Color(0, 0, 0, 0.35))
	icon(c.icon, ic, 44, c.col)
	txt(f_bold, r.position + Vector2(86, 40), c.title, 18, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
	if c.lv >= 0:
		for i in c.mx:
			var pr := Rect2(r.position.x + 86 + i * 18, r.position.y + 52, 13, 8)
			draw_rect(pr, c.col if i < c.lv else Color(1, 1, 1, 0.15))
		if c.lv == 0:
			txt(f_body, r.position + Vector2(86 + c.mx * 18 + 6, 61), "미보유", 11, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	if c.get("equipped", false):
		txt(f_bold, Vector2(r.end.x - 14, r.position.y + 26), "장착 중", 12, c.col, HORIZONTAL_ALIGNMENT_RIGHT, false)
	_wrap(c.line1, r.position + Vector2(18, 106), r.size.x - 36, 14, C_INK)
	if c.line2 != "":
		_wrap(c.line2, r.position + Vector2(18, 130), r.size.x - 36, 13, C_DIM)
	var by := r.end.y - 50
	if c.has("btn2"):
		var half := (r.size.x - 44) / 2
		button(Rect2(r.position.x + 16, by, half, 38), c.btn, c.act, c.enabled)
		button(Rect2(r.position.x + 28 + half, by, half, 38), c.btn2, c.act2, true, false)
	else:
		button(Rect2(r.position.x + 16, by, r.size.x - 32, 38), c.btn, c.act, c.enabled)


func _wrap(s: String, pos: Vector2, w: float, fs: int, col: Color) -> void:
	draw_multiline_string(f_body, pos, s, HORIZONTAL_ALIGNMENT_LEFT, w, fs, 2, col)


# ---------------- 결과 화면 ----------------
func _draw_end() -> void:
	var s := size
	var a := clampf(main.end_t / 1.2, 0, 1)
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.03, 0.03, 0.1, 0.55 * a))
	var win: bool = main.state == "win"
	txt(f_disp, Vector2(s.x / 2, s.y * 0.3), main.banner, 72, Color(C_GOLD if win else C_BLOOD, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.3 + 50), main.banner_sub, 22, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.3 + 90), "웨이브 %d · 처치 %d" % [main.wave, main.kills], 18, Color(C_DIM, a), HORIZONTAL_ALIGNMENT_CENTER)
	icon("gold", Vector2(s.x / 2 - 70, s.y * 0.3 + 128), 30, Color(C_GOLD, a))
	txt(f_bold, Vector2(s.x / 2 - 48, s.y * 0.3 + 138), "+%d 골드 획득" % main.earned, 22, Color(C_GOLD, a))
	if main.end_t > 1.0:
		button(Rect2(s.x / 2 - 270, s.y * 0.72, 260, 62), "다시 하기", "start")
		button(Rect2(s.x / 2 + 10, s.y * 0.72, 260, 62), "상점", "shop", true, false)
