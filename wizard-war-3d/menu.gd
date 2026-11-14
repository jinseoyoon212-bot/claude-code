extends UIBase
## 메뉴 화면: 인트로, 타이틀, 스테이지 선택, 상점, 업적, 설정, 개발자 인증/치트, 일시정지, 결과.

var page := ""        # "" = 상태별 기본 화면 / stages / shop / achieve / settings / password / cheat / pause
var prev_page := ""
var shop_tab := "up"
var toast := ""
var toast_t := 0.0
var page_t := 0.0
var leaving := false      # 지금 화면이 사라지는 중
var leave_t := 0.0
var leave_to := ""
var last_key := ""
const LEAVE := 0.13       # 사라지는 시간(초)
var pw_edit: LineEdit
var pw_error := ""
var reset_armed := false
var dev_taps := 0
var dev_tap_t := 0.0

const INTRO_LINES := [
	[0.6, 3.0, "천 년의 봉인이 깨지던 밤"],
	[3.4, 6.6, "어둠의 군주 모르가스가 해골 군단을 이끌고 진격한다"],
	[7.0, 9.6, "빛의 군단 맨 앞에, 마지막 대마법사가 선다"],
]


func _ready() -> void:
	super._ready()


func say(msg: String) -> void:
	toast = msg
	toast_t = 2.4


func open_page(p: String) -> void:
	if p == "title":
		p = ""
	prev_page = page
	page = p
	page_t = 0.0
	ui_t = 0.0   # 새 화면의 버튼·카드가 순서대로 등장
	reset_armed = false
	if p == "password":
		_show_password()
	elif pw_edit:
		pw_edit.queue_free()
		pw_edit = null


func go_page(p: String) -> void:
	## 화면 전환: 지금 화면이 부드럽게 사라진 뒤 다음 화면이 아래에서 올라오며 나타난다
	if leaving:
		return
	leaving = true
	leave_t = 0.0
	leave_to = p


func _active() -> bool:
	return main != null and (main.state != "play" or main.paused)


func _input(ev: InputEvent) -> void:
	if main == null:
		return
	if main.state == "gate":
		if (ev is InputEventScreenTouch and ev.pressed) or (ev is InputEventMouseButton and ev.pressed) or (ev is InputEventKey and ev.pressed):
			main.leave_gate()
			get_viewport().set_input_as_handled()
		return
	if main.state == "intro":
		if (ev is InputEventScreenTouch and ev.pressed) or (ev is InputEventKey and ev.pressed):
			main.end_intro()
			get_viewport().set_input_as_handled()
		return
	if not _active():
		return
	if ev is InputEventScreenTouch and ev.pressed:
		if pw_edit and Rect2(pw_edit.position, pw_edit.size).has_point(ev.position):
			pw_edit.grab_focus()
			return
		get_viewport().set_input_as_handled()
		if leaving:
			return
		var act := click_at(ev.position)
		if act != "":
			mark_press(act, ev.position)
			_action(act)


func _action(act: String) -> void:
	var p := act.split(":")
	var err := ""
	Sfx.play("click")
	match p[0]:
		"page":
			if p[1] == "dev":
				go_page("cheat" if Save.dev_unlocked else "password")
			else:
				go_page(p[1])
		"back":
			if page in ["settings", "cheat"] and main.paused:
				go_page("pause")
			else:
				go_page("")
		"stage":
			if Save.stage_unlocked(p[1]):
				main.start_game(p[1])
			else:
				err = "이전 스테이지를 먼저 클리어하세요"
		"retry":
			main.start_game()
		"next_stage":
			main.start_game(p[1])
		"to_title":
			main.go_title(p[1] if p.size() > 1 else "")
		"resume":
			main.set_paused(false)
		"tab":
			shop_tab = p[1]
			ui_t = 0.0   # 카드가 다시 순서대로 등장
		"buy_up":
			err = Save.buy_upgrade(p[1])
			if err == "":
				say("강화 완료!")
				Sfx.play("levelup")
		"buy_skill":
			var first: bool = Save.skills[p[1]] == 0
			err = Save.buy_skill(p[1])
			if err == "":
				say("스킬 습득!" if first else "스킬 레벨 업!")
				Sfx.play("levelup")
		"equip":
			err = Save.toggle_equip(p[1])
		"buy_item":
			err = Save.buy_item(p[1])
			if err == "":
				say("구매 완료!")
				Sfx.play("buy")
		"claim":
			err = Save.claim(p[1])
			if err == "":
				say("보상 획득!")
				Sfx.play("coin")
		"set":
			_setting(p[1], p[2] if p.size() > 2 else "")
		"pw_ok":
			_check_password()
		"cheat":
			var r := Save.cheat(p[1])
			if p[1] == "lock":
				open_page("pause" if main.paused else "")
				say("개발자 모드를 잠갔습니다")
			else:
				say(r)
				Sfx.play("levelup")
		"bcheat":
			say(main.cheat_battle(p[1]))
		"dev_tap":
			_dev_tap()
	if err != "":
		say(err)
		Sfx.play("error")


func _setting(k: String, v: String) -> void:
	match k:
		"music", "sfx":
			Save.settings[k] = clampf(Save.settings[k] + (0.1 if v == "+" else -0.1), 0.0, 1.0)
		"shadows":
			Save.settings.shadows = not Save.settings.shadows
			main.sun.shadow_enabled = Save.settings.shadows
		"numbers", "shake", "fps":
			Save.settings[k] = not Save.settings[k]
		"intro":
			Save.intro_seen = false
			Save.next_action = ""
			get_tree().reload_current_scene()
			return
		"reset":
			if not reset_armed:
				reset_armed = true
				say("한 번 더 누르면 모든 진행이 삭제됩니다")
				return
			Save.reset_all()
			Save.intro_seen = false
			Save.next_action = ""
			get_tree().reload_current_scene()
			return
	Save.save_data()


func _dev_tap() -> void:
	# 로고를 빠르게 5번 누르면 개발자 인증 창이 열린다 (설정 화면의 버튼으로도 열 수 있음)
	if main.t - dev_tap_t > 1.2:
		dev_taps = 0
	dev_tap_t = main.t
	dev_taps += 1
	if dev_taps >= 5:
		dev_taps = 0
		open_page("cheat" if Save.dev_unlocked else "password")


func _show_password() -> void:
	pw_error = ""
	if pw_edit == null:
		pw_edit = LineEdit.new()
		pw_edit.secret = true
		pw_edit.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER
		pw_edit.max_length = 12
		pw_edit.placeholder_text = "비밀번호"
		pw_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
		pw_edit.add_theme_font_override("font", f_bold)
		pw_edit.add_theme_font_size_override("font_size", 24)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.05, 0.05, 0.1)
		sb.border_color = C_GOLD
		sb.set_border_width_all(2)
		sb.set_corner_radius_all(10)
		pw_edit.add_theme_stylebox_override("normal", sb)
		pw_edit.add_theme_stylebox_override("focus", sb)
		pw_edit.text_submitted.connect(func(_t): _check_password())
		add_child(pw_edit)
	pw_edit.text = ""
	pw_edit.size = Vector2(360, 56)
	pw_edit.call_deferred("grab_focus")


func _check_password() -> void:
	if pw_edit == null:
		return
	if pw_edit.text.strip_edges() == Save.DEV_PASSWORD:
		Save.dev_unlocked = true
		Save.save_data()
		Sfx.play("levelup")
		say("개발자 모드 활성화")
		open_page("cheat")
	else:
		pw_error = "비밀번호가 틀렸습니다"
		pw_edit.text = ""
		Sfx.play("error")


func _process(d: float) -> void:
	fit()
	toast_t -= d
	page_t += d
	ui_t += d
	# 화면 종류(상태/일시정지)가 바뀌면 부드럽게 나타나게 한다
	var key := "%s|%s" % [main.state, str(main.paused)] if main else ""
	if key != last_key:
		last_key = key
		page_t = 0.0
		ui_t = 0.0
	if leaving:
		leave_t += d
		if leave_t >= LEAVE:
			leaving = false
			open_page(leave_to)
	var alpha := clampf(page_t / 0.26, 0.0, 1.0)
	var slide := (1.0 - ease_out(clampf(page_t / 0.36, 0.0, 1.0))) * 20.0
	if leaving:
		var lk := clampf(leave_t / LEAVE, 0.0, 1.0)
		alpha *= 1.0 - lk
		slide = -10.0 * lk
	modulate.a = alpha
	page_xf = Transform2D(0.0, Vector2(0, slide))
	if pw_edit:
		pw_edit.position = Vector2(size.x / 2 - 180, size.y / 2 - 30)
	queue_redraw()


# ---------------- 그리기 ----------------
func _draw() -> void:
	clicks.clear()
	btn_i = 0
	base_xf = page_xf
	draw_set_transform_matrix(base_xf)
	if main == null or main.hero == null:
		return
	match main.state:
		"gate":
			_draw_gate()
		"intro":
			_draw_intro()
		"title":
			match page:
				"stages": _draw_stages()
				"shop": _draw_shop()
				"achieve": _draw_achieve()
				"settings": _draw_settings()
				"password": _draw_password()
				"cheat": _draw_cheat()
				_: _draw_title()
		"play":
			if main.paused:
				match page:
					"settings": _draw_settings()
					"password": _draw_password()
					"cheat": _draw_cheat()
					_: _draw_pause()
		"win", "lose":
			_draw_end()
	draw_set_transform_matrix(Transform2D.IDENTITY)
	if touch_ui and size.y > size.x * 1.05:
		_draw_rotate_hint()
	if main.white_flash > 0.0:
		draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, clampf(main.white_flash, 0, 1)))
	draw_ripples()
	if toast_t > 0.0:
		var a := clampf(toast_t * 2.0, 0, 1)
		var w := 60.0 + toast.length() * 15.0
		var age := 2.4 - toast_t   # 알림은 아래에서 통통 튀며 올라온다
		var pop := ease_out_back(clampf(age / 0.28, 0.0, 1.0))
		draw_set_transform_matrix(Transform2D(0.0, Vector2(1, 1), 0.0, Vector2(0, (1.0 - pop) * 26.0)))
		panel(Rect2(size.x / 2 - w / 2, size.y - 130, w, 46), Color(0.05, 0.05, 0.1, 0.92 * a), 23, Color(C_GOLD, 0.5 * a))
		txt(f_bold, Vector2(size.x / 2, size.y - 100), toast, 16, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER, false)
		draw_set_transform_matrix(Transform2D.IDENTITY)


func _draw_rotate_hint() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.02, 0.02, 0.08, 0.97))
	var k := size.x / 420.0   # 세로 화면은 기준 해상도가 커지므로 글자를 키운다
	var c := size / 2
	var phone := Rect2(c.x - 26 * k, c.y - 120 * k, 52 * k, 92 * k)
	panel(phone, Color(0, 0, 0, 0), int(8 * k), C_GOLD, int(3 * k))
	draw_arc(c + Vector2(0, -74 * k), 70 * k, -0.5, 0.8, 24, C_GOLD, 3.0 * k, true)
	txt(f_disp, c + Vector2(0, 30 * k), "화면을 가로로 돌려주세요", int(24 * k), C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, c + Vector2(0, 62 * k), "이 게임은 가로 화면에서 플레이합니다", int(13 * k), C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	if main.state == "play" and not main.paused:
		main.set_paused(true)


func _dim(a := 0.6) -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.02, 0.02, 0.08, a))


func _header(title: String) -> void:
	_dim(0.82)
	txt(f_disp, Vector2(40, 62), title, 36, C_GOLD)
	gold_chip(Vector2(size.x - 30, 28))
	button(Rect2(40, size.y - 82, 190, 54), "돌아가기", "back", true, false)


func _logo(c: Vector2, scale_k: float, a: float) -> void:
	var fs := int(64 * scale_k)
	for i in 3:
		txt(f_disp, c + Vector2(0, 2), "빛과 어둠의 마법 전쟁", fs, Color(1.0, 0.75, 0.3, a * 0.12), HORIZONTAL_ALIGNMENT_CENTER, false)
	txt(f_disp, c, "빛과 어둠의 마법 전쟁", fs, Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_bold, c + Vector2(0, 36 * scale_k), "W I Z A R D   W A R   ·   L I G H T  &  D A R K", int(14 * scale_k), Color(C_FROST, a * 0.9), HORIZONTAL_ALIGNMENT_CENTER)


# ---------------- 시작 대기 (웹: 소리를 켜기 위한 첫 터치) ----------------
func _draw_gate() -> void:
	var s := size
	draw_rect(Rect2(Vector2.ZERO, s), Color(0.02, 0.02, 0.08, 0.55))
	_logo(Vector2(s.x / 2, s.y * 0.34), 1.0, 1.0)
	var pulse := 0.65 + 0.35 * sin(main.t * 3.0)
	icon("sound", Vector2(s.x / 2, s.y * 0.62), 44, Color(C_GOLD, pulse))
	var msg := "화면을 눌러 시작" if touch_ui else "클릭하거나 아무 키나 누르세요"
	txt(f_disp, Vector2(s.x / 2, s.y * 0.62 + 64), msg, 30, Color(C_INK, pulse), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.62 + 96), "소리가 나오니 볼륨을 확인하세요", 15, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


# ---------------- 인트로 ----------------
func _draw_intro() -> void:
	var s := size
	var it: float = main.intro_t
	var bar_h := s.y * 0.12 * clampf(it / 1.0, 0, 1) * (1.0 - clampf((it - 14.4) / 1.2, 0, 1))
	draw_rect(Rect2(0, 0, s.x, bar_h), Color.BLACK)
	draw_rect(Rect2(0, s.y - bar_h, s.x, bar_h), Color.BLACK)
	if it < 0.8:
		draw_rect(Rect2(Vector2.ZERO, s), Color(0, 0, 0, 1.0 - it / 0.8))
	for ln in INTRO_LINES:
		if it >= ln[0] and it <= ln[1]:
			var k: float = (it - ln[0]) / (ln[1] - ln[0])
			var a := minf(1.0, k * 5.0) * minf(1.0, (1.0 - k) * 5.0)
			var full: String = ln[2]
			var n := mini(full.length(), int((it - ln[0]) * 22.0))
			txt(f_disp, Vector2(s.x / 2, s.y - bar_h - 40), full.substr(0, n), 30, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	if it >= 12.6:
		var k := clampf((it - 12.6) / 0.5, 0, 1)
		var sc := lerpf(1.8, 1.0, 1.0 - pow(1.0 - k, 3))
		_logo(Vector2(s.x / 2, s.y * 0.24), sc, k)
	txt(f_bold, Vector2(s.x - 30, s.y - 20), "화면을 누르면 건너뛰기  ▶", 14, Color(C_DIM, 0.8), HORIZONTAL_ALIGNMENT_RIGHT)


# ---------------- 타이틀 ----------------
func _draw_title() -> void:
	var s := size
	draw_rect(Rect2(0, 0, s.x, s.y), Color(0.02, 0.02, 0.08, 0.35))
	var bob := sin(main.t * 1.5) * 3.0
	_logo(Vector2(s.x / 2, s.y * 0.24 + bob), 1.0, 1.0)
	clicks.append({"rect": Rect2(s.x / 2 - 300, s.y * 0.24 - 60, 600, 90), "act": "dev_tap"})
	gold_chip(Vector2(s.x - 24, 22))
	panel(Rect2(24, 22, 150, 40), Color(0.08, 0.07, 0.04, 0.85), 20, Color(C_GOLD, 0.45))
	icon("star", Vector2(46, 42), 24, C_GOLD)
	txt(f_bold, Vector2(66, 49), "%d / 15" % Save.total_stars(), 17, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)

	var bw := 300.0
	var x := s.x / 2 - bw / 2
	var y := s.y * 0.44
	button(Rect2(x, y, bw, 66), "전투 시작", "page:stages", true, true, "attack")
	button(Rect2(x, y + 80, bw / 2 - 6, 54), "상점", "page:shop", true, false, "gold")
	var ach := Save.unclaimed_count()
	button(Rect2(x + bw / 2 + 6, y + 80, bw / 2 - 6, 54), "업적", "page:achieve", true, false, "trophy")
	if ach > 0:
		draw_circle(Vector2(x + bw - 6, y + 84), 12, C_BLOOD)
		txt(f_bold, Vector2(x + bw - 6, y + 89), str(ach), 13, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)
	button(Rect2(x, y + 148, bw / 2 - 6, 50), "설정", "page:settings", true, false, "settings")
	button(Rect2(x + bw / 2 + 6, y + 148, bw / 2 - 6, 50), "개발자", "page:dev", true, false, "dev")

	# 장착 스킬
	var n: int = Save.equipped.size()
	panel(Rect2(24, s.y - 128, 90 + n * 70, 100))
	txt(f_bold, Vector2(40, s.y - 104), "장착 스킬", 13, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	for i in n:
		var id: String = Save.equipped[i]
		var c := Vector2(64 + i * 70, s.y - 62)
		draw_circle(c, 26, Color(0.07, 0.07, 0.16, 0.9))
		draw_arc(c, 26, 0, TAU, 40, SKILL_COL[id], 2.0, true)
		icon(id, c, 32, SKILL_COL[id])
		txt(f_bold, c + Vector2(0, 40), "Lv%d" % Save.skills[id], 11, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x - 24, s.y - 14), "3D 모델 KayKit·OpenGameArt (CC0) · 아이콘 game-icons.net (CC BY 3.0) · 음악·효과음 자체 제작", 11, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT)


# ---------------- 스테이지 선택 ----------------
func _draw_stages() -> void:
	_header("스테이지 선택")
	var s := size
	var cols := 3
	var gap := 18.0
	var cw := minf(360.0, (s.x - 100 - gap * 2) / cols)
	var ch := 220.0
	var x0 := s.x / 2 - (cw * cols + gap * (cols - 1)) / 2
	for i in Save.STAGES.size():
		var st: Dictionary = Save.STAGES[i]
		var r := Rect2(x0 + (i % cols) * (cw + gap), 100 + (i / cols) * (ch + gap), cw, ch)
		var unlocked := Save.stage_unlocked(st.id)
		card_begin(r, i)
		var env_col: Color = main.ENVS[st.env].hor
		panel(r, C_CARD if unlocked else Color(0.08, 0.08, 0.12, 0.92), 16, Color(env_col, 0.6) if unlocked else Color(1, 1, 1, 0.06), 2)
		panel(Rect2(r.position + Vector2(2, 2), Vector2(r.size.x - 4, 70)), Color(env_col, 0.18 if unlocked else 0.05), 14, Color(0, 0, 0, 0), 0)
		var ic := r.position + Vector2(48, 50)
		draw_circle(ic, 32, Color(0, 0, 0, 0.4))
		icon(st.icon if unlocked else "lock", ic, 40, env_col.lightened(0.3) if unlocked else C_DIM)
		var num := "무한" if st.id == "endless" else "STAGE %d" % (i + 1)
		txt(f_bold, r.position + Vector2(96, 36), num, 12, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
		txt(f_disp, r.position + Vector2(96, 66), st.name, 24, C_INK if unlocked else C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
		wrap_text(st.sub, r.position + Vector2(20, 112), r.size.x - 40, 13, C_DIM)
		if st.id == "endless":
			txt(f_bold, r.position + Vector2(20, 168), "최고 기록: 웨이브 %d" % Save.endless_best, 15, C_FROST, HORIZONTAL_ALIGNMENT_LEFT, false)
		else:
			star_row(Vector2(r.position.x + 58, r.position.y + 162), int(Save.stars.get(st.id, 0)), 3, 24, 28)
			txt(f_body, r.position + Vector2(r.size.x - 20, 168), "웨이브 %d · 난이도 x%.1f" % [st.waves, st.mult], 12, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT, false)
			if int(Save.stars.get(st.id, 0)) == 0:
				txt(f_bold, r.position + Vector2(20, 200), "첫 클리어 보상 +%dG" % st.reward, 12, C_GOLD, HORIZONTAL_ALIGNMENT_LEFT, false)
		if unlocked:
			clicks.append({"rect": r, "act": "stage:" + st.id})
		else:
			txt(f_bold, r.position + Vector2(r.size.x - 20, 36), "잠김", 13, C_BLOOD, HORIZONTAL_ALIGNMENT_RIGHT, false)
		card_end()
	txt(f_body, Vector2(s.x / 2, s.y - 48), "별: 클리어 1개 · 수정 체력 50% 이상 2개 · 90% 이상 3개", 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER, false)


# ---------------- 상점 ----------------
func _draw_shop() -> void:
	_header("마법 상점")
	var s := size
	var tabs := [["up", "강화", "up_power"], ["skill", "스킬", "nova"], ["item", "물약", "potion_hp"]]
	for i in tabs.size():
		var r := Rect2(280 + i * 140, 30, 130, 44)
		var on: bool = shop_tab == tabs[i][0]
		fx_begin(r.get_center(), press_scale("tab:" + tabs[i][0]) * (1.04 if (not touch_ui and r.has_point(get_local_mouse_position())) else 1.0))
		panel(r, Color(C_GOLD, 0.95) if on else Color(0.14, 0.14, 0.26), 22, Color(1, 1, 1, 0.1))
		icon(tabs[i][2], r.position + Vector2(30, 22), 22, C_DARK if on else C_INK)
		txt(f_bold, Vector2(r.get_center().x + 12, r.position.y + 29), tabs[i][1], 17, C_DARK if on else C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)
		fx_end()
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
	var ch := 210.0
	var x0 := s.x / 2 - (cw * cols + gap * (cols - 1)) / 2
	for i in cards.size():
		var cr := Rect2(x0 + (i % cols) * (cw + gap), 96 + (i / cols) * (ch + gap), cw, ch)
		card_begin(cr, i)
		_draw_card(cr, cards[i])
		card_end()
	if shop_tab == "skill":
		txt(f_body, Vector2(s.x / 2, 96 + 2 * (ch + gap) + 4), "장착 슬롯 %d / %d · 전투에서는 장착한 스킬만 쓸 수 있습니다" % [Save.equipped.size(), Save.MAX_EQUIP], 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER, false)
	button(Rect2(s.x - 250, s.y - 82, 210, 54), "전투 시작", "page:stages", true, true, "attack")


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
		c["btn2"] = "해제" if eq else "장착"
		c["act2"] = "equip:" + id
		c["equipped"] = eq
	return c


func _item_card(it: Dictionary) -> Dictionary:
	var n: int = Save.items[it.id]
	return {"icon": it.icon, "col": SKILL_COL[it.id], "title": it.name, "lv": -1, "line1": it.desc,
		"line2": "보유 %d / %d개 · 전투 중 사용" % [n, Save.MAX_ITEM],
		"btn": "구매  %dG" % it.price, "act": "buy_item:" + it.id, "enabled": n < Save.MAX_ITEM and Save.gold >= it.price}


func _draw_card(r: Rect2, c: Dictionary) -> void:
	panel(r, C_CARD, 14, Color(c.col, 0.6) if c.get("equipped", false) else Color(1, 1, 1, 0.1), 2 if c.get("equipped", false) else 1)
	var ic := r.position + Vector2(44, 46)
	draw_circle(ic, 30, Color(0, 0, 0, 0.35))
	icon(c.icon, ic, 44, c.col)
	txt(f_bold, r.position + Vector2(86, 40), c.title, 18, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
	if c.lv >= 0:
		for i in c.mx:
			draw_rect(Rect2(r.position.x + 86 + i * 18, r.position.y + 52, 13, 8), c.col if i < c.lv else Color(1, 1, 1, 0.15))
		if c.lv == 0:
			txt(f_body, r.position + Vector2(86 + c.mx * 18 + 6, 61), "미보유", 11, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
	if c.get("equipped", false):
		txt(f_bold, Vector2(r.end.x - 14, r.position.y + 26), "장착 중", 12, c.col, HORIZONTAL_ALIGNMENT_RIGHT, false)
	wrap_text(c.line1, r.position + Vector2(18, 104), r.size.x - 36, 14, C_INK)
	if c.line2 != "":
		wrap_text(c.line2, r.position + Vector2(18, 128), r.size.x - 36, 13, C_DIM)
	var by := r.end.y - 50
	if c.has("btn2"):
		var w2 := 80.0
		button(Rect2(r.position.x + 16, by, r.size.x - 44 - w2, 38), c.btn, c.act, c.enabled)
		button(Rect2(r.end.x - 16 - w2, by, w2, 38), c.btn2, c.act2, true, false)
	else:
		button(Rect2(r.position.x + 16, by, r.size.x - 32, 38), c.btn, c.act, c.enabled)


# ---------------- 업적 ----------------
func _draw_achieve() -> void:
	_header("업적")
	var s := size
	var cols := 3
	var gap := 14.0
	var cw := minf(380.0, (s.x - 80 - gap * 2) / cols)
	var ch := 112.0
	var x0 := s.x / 2 - (cw * cols + gap * (cols - 1)) / 2
	for i in Save.ACHIEVEMENTS.size():
		var a: Dictionary = Save.ACHIEVEMENTS[i]
		var r := Rect2(x0 + (i % cols) * (cw + gap), 92 + (i / cols) * (ch + gap), cw, ch)
		card_begin(r, i)
		var done: bool = Save.claimed.has(a.id)
		var rdy := Save.achievement_ready(a)
		panel(r, C_CARD, 12, Color(C_GOLD, 0.7) if rdy else Color(1, 1, 1, 0.08), 2 if rdy else 1)
		icon("trophy", r.position + Vector2(34, 36), 34, C_GOLD if done or rdy else Color(1, 1, 1, 0.25))
		txt(f_bold, r.position + Vector2(64, 32), a.name, 16, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
		txt(f_body, r.position + Vector2(64, 54), a.desc, 12, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
		var v := mini(Save.stat_value(a.stat), a.goal)
		bar(Rect2(r.position.x + 18, r.position.y + 72, r.size.x - 150, 8), float(v) / a.goal, C_GOLD if not done else C_OK)
		txt(f_body, r.position + Vector2(18, 100), "%d / %d" % [v, a.goal], 11, C_DIM, HORIZONTAL_ALIGNMENT_LEFT, false)
		var br := Rect2(r.end.x - 118, r.position.y + 62, 104, 36)
		if done:
			icon("check", br.get_center(), 26, C_OK)
		else:
			button(br, "+%dG" % a.reward, "claim:" + a.id, rdy, true)
		card_end()


# ---------------- 설정 ----------------
func _draw_settings() -> void:
	_header("설정")
	var s := size
	var x := s.x / 2 - 300
	var y := 110.0
	var rows := [["music", "배경음악", "music"], ["sfx", "효과음", "sound"]]
	for rw in rows:
		panel(Rect2(x, y, 600, 64), C_CARD, 12)
		icon(rw[2], Vector2(x + 34, y + 32), 28, C_GOLD)
		txt(f_bold, Vector2(x + 64, y + 39), rw[1], 18, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
		button(Rect2(x + 260, y + 12, 48, 40), "-", "set:%s:-" % rw[0], true, false)
		bar(Rect2(x + 320, y + 26, 180, 12), Save.settings[rw[0]], C_GOLD)
		button(Rect2(x + 512, y + 12, 48, 40), "+", "set:%s:+" % rw[0], true, false)
		y += 76
	for rw in [["shadows", "그림자 (끄면 더 부드럽게 동작)"], ["numbers", "피해 숫자 표시"], ["shake", "화면 흔들림"], ["fps", "FPS 표시 (성능 확인용)"]]:
		panel(Rect2(x, y, 600, 58), C_CARD, 12)
		txt(f_bold, Vector2(x + 24, y + 36), rw[1], 17, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
		var on: bool = Save.settings[rw[0]]
		button(Rect2(x + 470, y + 10, 110, 38), "켜짐" if on else "꺼짐", "set:" + rw[0], true, on)
		y += 68
	if main.state == "title":
		button(Rect2(x, y + 10, 290, 50), "인트로 다시 보기", "set:intro", true, false, "portal")
		button(Rect2(x + 310, y + 10, 290, 50), "한 번 더 누르면 삭제" if reset_armed else "데이터 초기화", "set:reset", true, false, "skull")


# ---------------- 개발자 ----------------
func _draw_password() -> void:
	_dim(0.85)
	var s := size
	var r := Rect2(s.x / 2 - 240, s.y / 2 - 150, 480, 300)
	panel(r, C_CARD, 18, Color(C_GOLD, 0.5), 2)
	icon("dev", Vector2(s.x / 2, r.position.y + 46), 44, C_GOLD)
	txt(f_disp, Vector2(s.x / 2, r.position.y + 100), "개발자 인증", 26, C_INK, HORIZONTAL_ALIGNMENT_CENTER, false)
	if pw_error != "":
		txt(f_bold, Vector2(s.x / 2, s.y / 2 + 52), pw_error, 14, C_BLOOD, HORIZONTAL_ALIGNMENT_CENTER, false)
	button(Rect2(s.x / 2 - 200, r.end.y - 66, 190, 48), "취소", "back", true, false, "cancel")
	button(Rect2(s.x / 2 + 10, r.end.y - 66, 190, 48), "확인", "pw_ok", true, true)


func _draw_cheat() -> void:
	_header("개발자 치트 메뉴")
	var s := size
	var on_col := Color(0.35, 0.85, 0.5)
	var items := [
		["cheat:gold", "골드 +10,000", "gold", false],
		["cheat:max_up", "모든 강화 최대", "up_power", false],
		["cheat:max_skill", "모든 스킬 최대", "meteor", false],
		["cheat:items", "물약 가득 채우기", "potion_hp", false],
		["cheat:stages", "모든 스테이지 해금", "castle", false],
		["cheat:god", "무적 모드", "shield", Save.cheats.god],
		["cheat:one_hit", "한 방 처치", "attack", Save.cheats.one_hit],
		["cheat:no_cd", "대기시간 없음", "up_speed", Save.cheats.no_cd],
		["cheat:speed", "게임 속도 x%d" % Save.cheats.speed, "speed", Save.cheats.speed > 1],
	]
	if main.state == "play":
		items += [
			["bcheat:kill_all", "적 전멸", "skull", false],
			["bcheat:next_wave", "다음 웨이브로", "portal", false],
			["bcheat:boss", "보스 즉시 소환", "boss", false],
			["bcheat:heal", "체력·수정 완전 회복", "heal", false],
		]
	items.append(["cheat:lock", "개발자 모드 잠금", "lock", false])
	var cols := 4
	var gap := 14.0
	var cw := minf(280.0, (s.x - 80 - gap * 3) / cols)
	var ch := 70.0
	var x0 := s.x / 2 - (cw * cols + gap * (cols - 1)) / 2
	for i in items.size():
		var it: Array = items[i]
		var r := Rect2(x0 + (i % cols) * (cw + gap), 100 + (i / cols) * (ch + gap), cw, ch)
		var on: bool = it[3]
		panel(r, Color(0.12, 0.2, 0.15, 0.95) if on else C_CARD, 12, Color(on_col, 0.8) if on else Color(1, 1, 1, 0.1), 2 if on else 1)
		icon(it[2], r.position + Vector2(36, ch / 2), 30, on_col if on else C_GOLD)
		txt(f_bold, r.position + Vector2(66, ch / 2 + 6), it[1], 15, C_INK, HORIZONTAL_ALIGNMENT_LEFT, false)
		if it[0].begins_with("cheat:god") or it[0].begins_with("cheat:one_hit") or it[0].begins_with("cheat:no_cd"):
			txt(f_bold, Vector2(r.end.x - 14, r.position.y + 22), "ON" if on else "OFF", 11, on_col if on else C_DIM, HORIZONTAL_ALIGNMENT_RIGHT, false)
		clicks.append({"rect": r, "act": it[0]})
	txt(f_body, Vector2(s.x / 2, s.y - 44), "치트는 개발·테스트용입니다. 무적·한 방·속도 설정은 게임을 끄면 초기화됩니다.", 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER, false)


# ---------------- 일시정지 ----------------
func _draw_pause() -> void:
	_dim(0.7)
	var s := size
	txt(f_disp, Vector2(s.x / 2, s.y * 0.26), "일시정지", 48, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.26 + 36), "%s · 웨이브 %d · 처치 %d · 획득 %dG" % [main.stage.name, main.wave, main.kills, main.earned], 16, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	var x := s.x / 2 - 160
	var y := s.y * 0.38
	button(Rect2(x, y, 320, 60), "계속하기", "resume", true, true, "attack")
	button(Rect2(x, y + 74, 320, 52), "설정", "page:settings", true, false, "settings")
	var yy := y + 138
	if Save.dev_unlocked:
		button(Rect2(x, yy, 320, 52), "치트 메뉴", "page:cheat", true, false, "dev")
		yy += 64
	button(Rect2(x, yy, 320, 52), "포기하고 나가기", "to_title:stages", true, false, "exit")


# ---------------- 결과 ----------------
func _draw_end() -> void:
	var s := size
	var a := clampf(main.end_t / 1.2, 0, 1)
	_dim(0.62 * a)
	var win: bool = main.state == "win"
	var pop := 1.0 + maxf(0.0, 0.4 - main.end_t) * 1.2
	txt(f_disp, Vector2(s.x / 2, s.y * 0.24), main.banner, int(72 * pop), Color(C_GOLD if win else C_BLOOD, a), HORIZONTAL_ALIGNMENT_CENTER)
	txt(f_body, Vector2(s.x / 2, s.y * 0.24 + 46), main.banner_sub, 20, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	if win:
		for i in 3:
			var appear := clampf((main.end_t - 0.6 - i * 0.35) / 0.25, 0, 1)
			var got: bool = i < main.stars_got
			var c := Vector2(s.x / 2 - 70 + i * 70, s.y * 0.24 + 110)
			var sz := 54.0 * (1.0 + (1.0 - appear) * 0.8) if got else 54.0
			if appear > 0.0 or not got:
				icon("star", c, sz, Color(C_GOLD, appear) if got else Color(1, 1, 1, 0.15 * a))
	var y := s.y * 0.24 + (160 if win else 90)
	panel(Rect2(s.x / 2 - 220, y, 440, 96 if not main.first_clear else 124), Color(0, 0, 0, 0.45 * a), 14)
	txt(f_body, Vector2(s.x / 2, y + 32), "웨이브 %d · 처치 %d" % [main.wave, main.kills], 17, Color(C_DIM, a), HORIZONTAL_ALIGNMENT_CENTER, false)
	icon("gold", Vector2(s.x / 2 - 92, y + 66), 30, Color(C_GOLD, a))
	txt(f_bold, Vector2(s.x / 2 - 70, y + 75), "+%d 골드 획득" % main.earned, 24, Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_LEFT, false)
	if main.first_clear:
		txt(f_bold, Vector2(s.x / 2, y + 108), "첫 클리어 보상 포함!", 14, Color(C_FROST, a), HORIZONTAL_ALIGNMENT_CENTER, false)
	if main.end_t > 1.4:
		var by := s.y * 0.78
		var nxt := ""
		if win:
			for i in Save.STAGES.size() - 1:
				if Save.STAGES[i].id == main.stage.id and Save.STAGES[i + 1].id != "endless":
					nxt = Save.STAGES[i + 1].id
		if nxt != "":
			button(Rect2(s.x / 2 - 390, by, 250, 60), "다음 스테이지", "next_stage:" + nxt, true, true, "portal")
			button(Rect2(s.x / 2 - 125, by, 250, 60), "다시 하기", "retry", true, false)
			button(Rect2(s.x / 2 + 140, by, 250, 60), "상점", "to_title:shop", true, false, "gold")
		else:
			button(Rect2(s.x / 2 - 390, by, 250, 60), "다시 하기", "retry", true, true)
			button(Rect2(s.x / 2 - 125, by, 250, 60), "스테이지 선택", "to_title:stages", true, false, "castle")
			button(Rect2(s.x / 2 + 140, by, 250, 60), "상점", "to_title:shop", true, false, "gold")
