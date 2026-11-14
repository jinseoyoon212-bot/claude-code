extends Node2D
## 달빛 마법학교 룬 결투 — 룬(방향) 입력으로 적을 물리치는 아케이드 게임.
## 모든 그래픽은 _draw()에서 도형으로 그린다 (외부 이미지 없음).

const W := 480.0
const H := 880.0
const TOP := 96.0            # 게임 영역 시작 y
const GH := 640.0            # 게임 영역 높이
const WARD_Y := GH - 130.0   # 결계선 (게임 좌표)
const WIZ := Vector2(240, 578)
const DIRS := ["U", "D", "L", "R"]
const GLYPH := {"U": "↑", "D": "↓", "L": "←", "R": "→"}
const NOTE := {"U": 660.0, "R": 587.0, "D": 494.0, "L": 440.0}
const SAVE_PATH := "user://save.cfg"

var C_NIGHT := Color("0c0f22")
var C_NIGHT2 := Color("161a38")
var C_LINE := Color("2f356c")
var C_INK := Color("ece4cc")
var C_DIM := Color("a59f8c")
var C_GOLD := Color("e8b84a")
var C_FROST := Color("7fd6e8")
var C_BLOOD := Color("e2556b")

var TYPES := {
	"imp": {"name": "그림자 도깨비", "speed": 40.0, "hp": 1, "r": 16.0, "col": Color("b46cf0")},
	"gargoyle": {"name": "돌 가고일", "speed": 22.0, "hp": 2, "r": 22.0, "col": Color("8f9bb3")},
	"wisp": {"name": "도깨비불", "speed": 30.0, "hp": 1, "r": 13.0, "col": Color("7fd6e8")},
	"boss": {"name": "서리 와이번", "speed": 8.0, "hp": 3, "r": 44.0, "col": Color("9fe3f0")},
}

var f_body: Font
var f_bold: Font
var f_disp: Font

# 상태
var mode := "title"   # title / play / over
var paused := false
var t := 0.0
var enemies: Array = []
var bolts: Array = []
var parts: Array = []
var buffer: Array = []
var score := 0
var combo := 0
var max_combo := 0
var mana := 0.0
var hp := 5
var wave := 0
var to_spawn := 0
var spawn_t := 0.0
var between := 0.0
var banner := {}
var shake := 0.0
var flash := 0.0
var kills := 0
var best := 0
var sound_on := true
var key_flash := {}

var stars: Array = []
var sounds := {}
var players: Array = []
var player_i := 0

# 버튼 영역 (화면 좌표)
var pad_rects := {}
var burst_rect := Rect2()
var start_rect := Rect2(140, TOP + 470, 200, 52)
var pause_rect := Rect2(16, 832, 110, 32)
var sound_rect := Rect2(354, 832, 110, 32)


func _ready() -> void:
	randomize()
	f_body = load("res://fonts/NotoSansKR.ttf")
	var fv := FontVariation.new()
	fv.base_font = f_body
	fv.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): 800}
	f_bold = fv
	f_disp = load("res://fonts/GowunBatang-Bold.ttf")

	for i in 70:
		stars.append({"p": Vector2(randf() * W, randf() * (GH - 160)), "r": randf() * 1.4 + 0.3, "ph": randf() * 6.0})

	var x := 16.0
	var aw := 77.0
	for d in ["L", "U", "D", "R"]:
		pad_rects[d] = Rect2(x, 748, aw, 70)
		x += aw + 8
	burst_rect = Rect2(x, 748, W - 16 - x, 70)

	_build_sounds()
	for i in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		players.append(p)

	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) == OK:
		best = int(cfg.get_value("game", "best", 0))
		sound_on = bool(cfg.get_value("game", "sound", true))


# ---------------- 사운드 ----------------
func _make_tone(f0: float, dur: float, wave_t: String, vol: float, f1: float = 0.0) -> AudioStreamWAV:
	var rate := 22050
	var n := int(rate * dur)
	var data := PackedByteArray()
	data.resize(n * 2)
	var ph := 0.0
	for i in n:
		var k := float(i) / n
		var f := f0 if f1 <= 0.0 else f0 * pow(f1 / f0, k)
		ph += f / rate
		var fr := fmod(ph, 1.0)
		var s := 0.0
		match wave_t:
			"sine": s = sin(ph * TAU)
			"square": s = 1.0 if fr < 0.5 else -1.0
			"saw": s = 2.0 * fr - 1.0
			_: s = 1.0 - 4.0 * absf(fr - 0.5)
		var env := pow(0.0001, k) * minf(1.0, i / 60.0)
		data.encode_s16(i * 2, int(clampf(s * vol * env * 4.0, -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.stereo = false
	w.data = data
	return w


func _build_sounds() -> void:
	for d in NOTE:
		sounds["n" + d] = _make_tone(NOTE[d], 0.09, "sine", 0.05)
	sounds["hit"] = _make_tone(880, 0.15, "tri", 0.06, 1760)
	sounds["miss"] = _make_tone(140, 0.18, "square", 0.04)
	sounds["hurt"] = _make_tone(110, 0.4, "square", 0.06, 60)
	sounds["wave"] = _make_tone(392, 0.5, "tri", 0.08, 784)
	sounds["boss"] = _make_tone(220, 0.5, "tri", 0.08, 110)
	sounds["bosskill"] = _make_tone(392, 0.8, "tri", 0.08, 1568)
	sounds["burst"] = _make_tone(196, 0.7, "saw", 0.06, 1568)
	sounds["start"] = _make_tone(523, 0.2, "tri", 0.06, 1046)
	sounds["over"] = _make_tone(330, 0.9, "saw", 0.05, 80)


func sfx(id: String) -> void:
	if not sound_on or not sounds.has(id):
		return
	var p: AudioStreamPlayer = players[player_i]
	player_i = (player_i + 1) % players.size()
	p.stream = sounds[id]
	p.play()


func save_cfg() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("game", "best", best)
	cfg.set_value("game", "sound", sound_on)
	cfg.save(SAVE_PATH)


# ---------------- 게임 로직 ----------------
func start_game() -> void:
	mode = "play"
	paused = false
	t = 0.0
	enemies.clear(); bolts.clear(); parts.clear(); buffer.clear()
	score = 0; combo = 0; max_combo = 0; mana = 0.0; hp = 5; wave = 0
	to_spawn = 0; spawn_t = 0.0; between = 0.0; banner = {}; shake = 0.0; flash = 0.0; kills = 0
	start_wave()
	sfx("start")


func seq_len_max() -> int:
	return mini(6, 2 + wave / 2)


func boss_len() -> int:
	return mini(7, 4 + wave / 5)


func new_seq(n: int) -> Array:
	while true:
		var s: Array = []
		for i in n:
			s.append(DIRS[randi() % 4])
		var dup := false
		for e in enemies:
			if not e.dead and e.seq == s:
				dup = true
				break
		if not dup:
			return s
	return []


func start_wave() -> void:
	wave += 1
	var is_boss := wave % 5 == 0
	to_spawn = (4 + wave) if is_boss else (5 + wave * 2)
	spawn_t = 1.0
	if is_boss:
		banner = {"text": "보스 출현", "sub": TYPES.boss.name + "이(가) 다가옵니다", "t": 2.2}
		spawn("boss")
		sfx("boss")
	else:
		banner = {"text": "웨이브 %d" % wave, "sub": "룬을 입력해 막아내세요", "t": 2.2}
		sfx("wave")


func spawn(kind: String = "") -> void:
	if kind == "":
		var r := randf()
		if wave < 2:
			kind = "imp"
		elif r < 0.5:
			kind = "imp"
		elif r < 0.75 or wave < 3:
			kind = "wisp"
		else:
			kind = "gargoyle"
	var T: Dictionary = TYPES[kind]
	var mx := seq_len_max()
	var n: int = boss_len() if kind == "boss" else maxi(2, mini(mx, 2 + randi() % maxi(1, mx - 1)))
	var x := W / 2 if kind == "boss" else 50.0 + randf() * (W - 100)
	var mhp: int = (T.hp + wave / 5 - 1) if kind == "boss" else T.hp
	enemies.append({
		"kind": kind, "x": x, "bx": x, "y": -50.0 if kind == "boss" else -20.0, "r": T.r,
		"hp": mhp, "maxhp": mhp, "speed": T.speed * (1.0 + wave * 0.06),
		"seq": new_seq(n), "ph": randf() * 6.0, "flash": 0.0, "dead": false,
	})


func starts_with(a: Array, b: Array) -> bool:
	if b.size() > a.size():
		return false
	for i in b.size():
		if a[i] != b[i]:
			return false
	return true


func cands() -> Array:
	var out: Array = []
	for e in enemies:
		if not e.dead and starts_with(e.seq, buffer):
			out.append(e)
	return out


func press(d: String) -> void:
	key_flash[d] = 0.1
	if mode != "play" or paused:
		return
	buffer.append(d)
	var c := cands()
	if c.is_empty() and buffer.size() > 1:
		buffer = [d]
		c = cands()
	if c.is_empty():
		miss()
		return
	sfx("n" + d)
	var done: Array = []
	for e in c:
		if e.seq.size() == buffer.size():
			done.append(e)
	if not done.is_empty():
		done.sort_custom(func(a, b): return a.y > b.y)
		hit(done[0])
		buffer.clear()


func miss() -> void:
	buffer.clear()
	combo = 0
	mana = maxf(0.0, mana - 5.0)
	shake = 6.0
	sfx("miss")


func mult() -> int:
	return mini(5, 1 + combo / 5)


func hit(e: Dictionary) -> void:
	var n: int = e.seq.size()
	combo += 1
	max_combo = maxi(max_combo, combo)
	score += n * 10 * mult()
	mana = minf(100.0, mana + n * 4.0)
	bolts.append({"x": e.x, "y": e.y, "t": 0.22, "col": C_FROST if e.kind == "boss" else C_GOLD})
	e.hp -= 1
	e.flash = 0.18
	sfx("hit")
	if e.hp <= 0:
		kill(e, true)
	else:
		e.seq = new_seq(boss_len() if e.kind == "boss" else n)
		burst_at(Vector2(e.x, e.y), C_GOLD, 10)


func kill(e: Dictionary, by_player: bool) -> void:
	e.dead = true
	burst_at(Vector2(e.x, e.y), TYPES[e.kind].col, 60 if e.kind == "boss" else 22)
	if by_player:
		kills += 1
	if e.kind == "boss" and by_player:
		var bonus := 500 * wave / 5
		score += bonus
		hp = mini(5, hp + 1)
		flash = 0.5
		banner = {"text": "보스 격파", "sub": "생명 1 회복 · +%d점" % bonus, "t": 2.0}
		sfx("bosskill")


func burst_at(p: Vector2, col: Color, n: int) -> void:
	for i in n:
		var a := randf() * TAU
		var s := 40.0 + randf() * 160.0
		parts.append({"p": p, "v": Vector2(cos(a), sin(a)) * s, "life": 0.5 + randf() * 0.5, "col": col})


func do_burst() -> void:
	if mode != "play" or paused or mana < 100.0:
		return
	mana = 0.0
	flash = 0.6
	shake = 10.0
	buffer.clear()
	for e in enemies:
		if e.dead:
			continue
		if e.kind == "boss":
			e.hp -= 1
			e.flash = 0.3
			if e.hp <= 0:
				kill(e, true)
			else:
				e.seq = new_seq(boss_len())
		else:
			score += e.seq.size() * 10
			kill(e, true)
	sfx("burst")


func game_over() -> void:
	mode = "over"
	if score > best:
		best = score
		save_cfg()
	sfx("over")


func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	for k in key_flash.keys():
		key_flash[k] -= dt
		if key_flash[k] <= 0:
			key_flash.erase(k)
	if mode == "play" and not paused:
		update_game(dt)
	elif mode != "play":
		t += dt
	queue_redraw()


func update_game(dt: float) -> void:
	t += dt
	if not banner.is_empty():
		banner.t -= dt
		if banner.t <= 0:
			banner = {}
	shake = maxf(0.0, shake - dt * 30.0)
	flash = maxf(0.0, flash - dt)
	if to_spawn > 0:
		spawn_t -= dt
		if spawn_t <= 0:
			spawn()
			to_spawn -= 1
			spawn_t = maxf(0.55, 2.0 - wave * 0.12) * (0.7 + randf() * 0.6)
	for e in enemies:
		if e.dead:
			continue
		e.y += e.speed * dt
		e.flash = maxf(0.0, e.flash - dt)
		if e.kind == "wisp":
			e.x = clampf(e.bx + sin(t * 2.2 + e.ph) * 45.0, 30.0, W - 30.0)
		elif e.kind == "boss":
			e.x = W / 2 + sin(t * 0.7) * 110.0
		if e.y + e.r * 0.4 >= WARD_Y:
			kill(e, false)
			hp -= 3 if e.kind == "boss" else 1
			combo = 0
			shake = 12.0
			buffer.clear()
			sfx("hurt")
			if hp <= 0:
				hp = 0
				game_over()
				return
	enemies = enemies.filter(func(e): return not e.dead)
	if not buffer.is_empty() and cands().is_empty():
		buffer.clear()
	for b in bolts:
		b.t -= dt
	bolts = bolts.filter(func(b): return b.t > 0)
	for p in parts:
		p.p += p.v * dt
		p.v = p.v + Vector2(0, 120.0 * dt)
		p.life -= dt
	parts = parts.filter(func(p): return p.life > 0)
	if to_spawn == 0 and enemies.is_empty():
		between += dt
		if between > 1.6:
			between = 0.0
			start_wave()


# ---------------- 입력 ----------------
func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo:
		var map := {KEY_UP: "U", KEY_DOWN: "D", KEY_LEFT: "L", KEY_RIGHT: "R", KEY_W: "U", KEY_S: "D", KEY_A: "L", KEY_D: "R"}
		if map.has(ev.keycode):
			press(map[ev.keycode])
		elif ev.keycode == KEY_SPACE or ev.keycode == KEY_ENTER:
			if mode != "play":
				start_game()
			elif ev.keycode == KEY_SPACE:
				do_burst()
		elif ev.keycode == KEY_P and mode == "play":
			paused = not paused
		elif ev.keycode == KEY_ESCAPE and mode == "play":
			paused = true
	elif ev is InputEventScreenTouch and ev.pressed:
		tap(ev.position)


func tap(screen_pos: Vector2) -> void:
	# 화면 좌표 → 캔버스(480x880) 좌표
	var p: Vector2 = get_canvas_transform().affine_inverse() * screen_pos
	for d in pad_rects:
		if pad_rects[d].grow(4).has_point(p):
			press(d)
			return
	if burst_rect.grow(4).has_point(p):
		do_burst()
		return
	if sound_rect.grow(6).has_point(p):
		sound_on = not sound_on
		save_cfg()
		return
	if pause_rect.grow(6).has_point(p) and mode == "play":
		paused = not paused
		return
	if mode != "play" and start_rect.grow(8).has_point(p):
		start_game()
		return
	if mode == "play" and paused and p.y > TOP and p.y < TOP + GH:
		paused = false


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED:
		if mode == "play":
			paused = true


# ---------------- 그리기 ----------------
func text(font: Font, pos: Vector2, s: String, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	if align == HORIZONTAL_ALIGNMENT_CENTER:
		draw_string(font, Vector2(pos.x - 400, pos.y), s, align, 800, size, col)
	elif align == HORIZONTAL_ALIGNMENT_RIGHT:
		draw_string(font, Vector2(pos.x - 800, pos.y), s, align, 800, size, col)
	else:
		draw_string(font, pos, s, align, width, size, col)


func box(r: Rect2, fill: Color, border: Color, radius := 8, bw := 1) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = border
	sb.set_border_width_all(bw)
	sb.set_corner_radius_all(radius)
	sb.anti_aliasing = true
	draw_style_box(sb, r)


func ellipse(c: Vector2, rx: float, ry: float, col: Color) -> void:
	var pts := PackedVector2Array()
	for i in 24:
		var a := TAU * i / 24.0
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	draw_colored_polygon(pts, col)


func tri(a: Vector2, b: Vector2, c: Vector2, col: Color) -> void:
	draw_colored_polygon(PackedVector2Array([a, b, c]), col)


func glow(c: Vector2, r: float, col: Color) -> void:
	for i in range(8, 0, -1):
		var k := i / 8.0
		draw_circle(c, r * k, Color(col, 0.12 * (1.0 - k) + 0.04))
	draw_circle(c, r * 0.18, Color(1, 1, 0.9, 0.95))


func _draw() -> void:
	var off := Vector2.ZERO
	if shake > 0:
		off = Vector2(randf() - 0.5, randf() - 0.5) * shake
	# 게임 영역
	draw_set_transform(Vector2(0, TOP) + off)
	draw_bg()
	draw_ward()
	draw_wizard()
	if mode != "title":
		var ms := cands() if not buffer.is_empty() else []
		for e in enemies:
			draw_enemy(e, ms.has(e))
		for b in bolts:
			var sp := WIZ + Vector2(30, -38)
			var target := Vector2(b.x, b.y)
			var pts := PackedVector2Array([sp])
			for i in range(1, 7):
				var f := i / 6.0
				var j := Vector2((randf() - 0.5) * 14.0, 0) if i < 6 else Vector2.ZERO
				pts.append(sp.lerp(target, f) + j)
			var k: float = 1.0 - b.t / 0.22
			draw_polyline(pts, Color(b.col, 0.35), 10.0 * (1.0 - k) + 3.0, true)
			draw_polyline(pts, b.col, 4.0 * (1.0 - k) + 1.0, true)
		for p in parts:
			draw_rect(Rect2(p.p - Vector2(2, 2), Vector2(4, 4)), Color(p.col, clampf(p.life, 0, 1)))
		if not buffer.is_empty():
			var s := " ".join(buffer.map(func(d): return GLYPH[d]))
			text(f_bold, Vector2(W / 2, WARD_Y + 30), s, 22, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
		if flash > 0:
			draw_rect(Rect2(0, 0, W, GH), Color(0.78, 0.94, 1.0, flash * 0.5))
		if not banner.is_empty():
			var a := minf(1.0, banner.t * 2.0)
			text(f_disp, Vector2(W / 2, GH * 0.36), banner.text, 34, Color(C_GOLD, a), HORIZONTAL_ALIGNMENT_CENTER)
			text(f_body, Vector2(W / 2, GH * 0.36 + 32), banner.sub, 15, Color(C_INK, a), HORIZONTAL_ALIGNMENT_CENTER)
	draw_set_transform(Vector2(0, TOP))
	box(Rect2(0, 0, W, GH), Color(0, 0, 0, 0), Color("2b3063"), 10, 1)
	if mode == "play" and paused:
		draw_rect(Rect2(0, 0, W, GH), Color(C_NIGHT, 0.75))
		text(f_disp, Vector2(W / 2, GH / 2), "일시정지", 32, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
		text(f_body, Vector2(W / 2, GH / 2 + 32), "화면을 누르거나 P로 계속", 15, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	if mode == "title":
		draw_title()
	elif mode == "over":
		draw_over()
	draw_set_transform(Vector2.ZERO)
	draw_hud()
	draw_pad()


func draw_bg() -> void:
	draw_rect(Rect2(0, 0, W, GH), C_NIGHT)
	for i in 16:
		var k := i / 16.0
		draw_rect(Rect2(0, GH * k, W, GH / 16.0 + 1), Color("1a1e4a").lerp(C_NIGHT, k))
	for s in stars:
		var a := 0.4 + 0.6 * absf(sin(t * 0.8 + s.ph))
		draw_circle(s.p, s.r, Color(C_INK, a))
	draw_circle(Vector2(392, 78), 30, Color("f3e9c6"))
	draw_circle(Vector2(380, 70), 27, Color("1b1f4b"))
	var base := GH - 92
	var sil := Color("080a18")
	draw_rect(Rect2(0, base, W, 92), sil)
	for tw in [[20, 60, 40], [90, 40, 28], [150, 90, 34], [300, 100, 38], [370, 55, 30], [430, 75, 36]]:
		var x: float = tw[0]; var h: float = tw[1]; var w: float = tw[2]
		draw_rect(Rect2(x, base - h, w, h), sil)
		tri(Vector2(x - 5, base - h), Vector2(x + w / 2, base - h - 30), Vector2(x + w + 5, base - h), sil)
	for wdw in [[160, base - 60], [176, base - 40], [312, base - 70], [322, base - 30], [440, base - 50]]:
		draw_rect(Rect2(wdw[0], wdw[1], 6, 9), Color(C_GOLD, 0.33))


func draw_ward() -> void:
	var a := 0.35 + 0.2 * sin(t * 3.0)
	var x := -fmod(t * 30.0, 18.0)
	while x < W:
		draw_line(Vector2(x, WARD_Y), Vector2(x + 10, WARD_Y), Color(C_FROST, a), 2.0)
		x += 18.0
	draw_rect(Rect2(0, WARD_Y, W, 8), Color(C_FROST, 0.06))


func draw_wizard() -> void:
	var x := WIZ.x; var y := WIZ.y
	var robe := Color("24306e")
	tri(Vector2(x - 24, y + 30), Vector2(x, y - 22), Vector2(x + 24, y + 30), robe)
	draw_line(Vector2(x - 24, y + 30), Vector2(x + 24, y + 30), C_GOLD, 2.0)
	draw_circle(Vector2(x, y - 24), 9, Color("f1d7b8"))
	tri(Vector2(x - 16, y - 28), Vector2(x + 4, y - 62), Vector2(x + 16, y - 28), robe)
	draw_line(Vector2(x - 15, y - 29), Vector2(x + 15, y - 29), C_GOLD, 2.0)
	draw_line(Vector2(x + 22, y + 26), Vector2(x + 30, y - 34), Color("8a5a2b"), 3.0)
	var g := 8.0 + 2.0 * sin(t * 5.0) + (4.0 if not buffer.is_empty() else 0.0)
	glow(Vector2(x + 30, y - 38), g * 2.4, C_GOLD)


func draw_enemy(e: Dictionary, hl: bool) -> void:
	var T: Dictionary = TYPES[e.kind]
	var x: float = e.x; var y: float = e.y; var r: float = e.r
	var fl: bool = e.flash > 0
	var white := Color.WHITE
	match e.kind:
		"imp":
			var col: Color = white if fl else T.col
			ellipse(Vector2(x, y), r, r * 1.1 + sin(t * 8 + e.ph) * 1.5, col)
			tri(Vector2(x - r * 0.7, y - r * 0.6), Vector2(x - r * 0.9, y - r * 1.5), Vector2(x - r * 0.2, y - r * 0.9), col)
			tri(Vector2(x + r * 0.7, y - r * 0.6), Vector2(x + r * 0.9, y - r * 1.5), Vector2(x + r * 0.2, y - r * 0.9), col)
		"gargoyle":
			var flap := sin(t * 6 + e.ph) * 8.0
			var wc := white if fl else Color("5d6680")
			tri(Vector2(x - r * 0.6, y), Vector2(x - r * 2, y - r * 0.6 + flap), Vector2(x - r * 1.5, y + r * 0.4), wc)
			tri(Vector2(x + r * 0.6, y), Vector2(x + r * 2, y - r * 0.6 + flap), Vector2(x + r * 1.5, y + r * 0.4), wc)
			draw_rect(Rect2(x - r * 0.75, y - r * 0.8, r * 1.5, r * 1.7), white if fl else T.col)
			if e.hp < e.maxhp:
				draw_polyline(PackedVector2Array([Vector2(x - 5, y - r * 0.8), Vector2(x + 2, y), Vector2(x - 3, y + r * 0.7)]), Color("2b2f40"), 2.0)
		"wisp":
			glow(Vector2(x, y), r * 2.4, T.col)
		"boss":
			var flap := sin(t * 2.5) * 14.0
			var wc := white if fl else Color("3d7f96")
			draw_colored_polygon(PackedVector2Array([Vector2(x - 20, y - 6), Vector2(x - r * 2.3, y - r * 0.9 + flap), Vector2(x - r * 1.6, y + r * 0.3), Vector2(x - r, y + 6)]), wc)
			draw_colored_polygon(PackedVector2Array([Vector2(x + 20, y - 6), Vector2(x + r * 2.3, y - r * 0.9 + flap), Vector2(x + r * 1.6, y + r * 0.3), Vector2(x + r, y + 6)]), wc)
			var bc: Color = white if fl else T.col
			ellipse(Vector2(x, y), r * 0.75, r, bc)
			tri(Vector2(x - 12, y + r * 0.7), Vector2(x, y + r * 1.5), Vector2(x + 12, y + r * 0.7), bc)
			for i in e.maxhp:
				draw_rect(Rect2(x - e.maxhp * 7 + i * 14 + 2, y + r + 8, 10, 4), C_BLOOD if i < e.hp else Color("333a5c"))
	if e.kind != "wisp":
		var ec := C_NIGHT if e.kind == "boss" else Color("fff3c4")
		draw_circle(Vector2(x - r * 0.32, y - r * 0.15), r * 0.13 + 1, ec)
		draw_circle(Vector2(x + r * 0.32, y - r * 0.15), r * 0.13 + 1, ec)
	# 룬 판
	var n: int = e.seq.size()
	var is_boss: bool = e.kind == "boss"
	var cw := 24.0 if is_boss else 21.0
	var bw := n * cw + 12.0
	var bh := 30.0 if is_boss else 26.0
	var by := y - r - (44.0 if is_boss else 38.0)
	var bx := x - bw / 2
	box(Rect2(bx, by, bw, bh), Color(C_GOLD, 0.18) if hl else Color(C_NIGHT, 0.85), C_GOLD if hl else Color("3a4080"), 6, 2 if hl else 1)
	var m := buffer.size() if hl else 0
	var fs := 20 if is_boss else 17
	for i in n:
		var col := C_GOLD if i < m else (C_FROST if is_boss else C_INK)
		text(f_bold, Vector2(bx + 6 + cw * i + cw / 2, by + bh / 2 + fs * 0.36), GLYPH[e.seq[i]], fs, col, HORIZONTAL_ALIGNMENT_CENTER)


func draw_title() -> void:
	draw_rect(Rect2(0, 0, W, GH), Color(C_NIGHT, 0.86))
	text(f_disp, Vector2(W / 2, 150), "달빛 마법학교", 42, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_disp, Vector2(W / 2, 190), "룬  결  투", 18, C_FROST, HORIZONTAL_ALIGNMENT_CENTER)
	var lines := [
		"밤의 성벽 너머에서 그림자 생물들이 몰려옵니다.",
		"머리 위에 뜬 룬을 그대로 입력해 주문을 날리세요.",
	]
	for i in lines.size():
		text(f_body, Vector2(W / 2, 250 + i * 24), lines[i], 15, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	var tips := [
		"↑ ↓ ← →  /  W A S D  /  아래 버튼 : 룬 입력",
		"스페이스 / 결계 폭발 : 마력 100%일 때 화면 정리",
		"결계선에 닿으면 생명 -1, 5웨이브마다 보스",
	]
	for i in tips.size():
		text(f_body, Vector2(W / 2, 330 + i * 26), tips[i], 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	draw_start_button("결투 시작")
	if best > 0:
		text(f_body, Vector2(W / 2, 560), "최고 기록 %d" % best, 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func draw_over() -> void:
	draw_rect(Rect2(0, 0, W, GH), Color(C_NIGHT, 0.86))
	text(f_disp, Vector2(W / 2, 200), "결계 붕괴", 42, C_GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_disp, Vector2(W / 2, 236), "GAME  OVER", 16, C_FROST, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_body, Vector2(W / 2, 300), "웨이브 %d까지 버텼습니다" % wave, 16, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_body, Vector2(W / 2, 328), "점수 %d · 처치 %d · 최고 콤보 %d" % [score, kills, max_combo], 15, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	draw_start_button("다시 도전")
	text(f_body, Vector2(W / 2, 560), "최고 기록 %d" % best, 13, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func draw_start_button(label: String) -> void:
	var r := Rect2(start_rect.position - Vector2(0, TOP), start_rect.size)
	box(r, C_GOLD, C_GOLD, 26, 0)
	text(f_disp, Vector2(W / 2, r.position.y + 34), label, 20, C_NIGHT, HORIZONTAL_ALIGNMENT_CENTER)


func draw_hud() -> void:
	text(f_body, Vector2(16, 26), "점수", 11, C_DIM)
	text(f_disp, Vector2(16, 52), str(score), 22, C_INK)
	text(f_body, Vector2(W / 2, 26), "웨이브", 11, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_disp, Vector2(W / 2, 52), str(maxi(wave, 1)), 22, C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_body, Vector2(W - 16, 26), "콤보" + (" ×%d" % mult() if mult() > 1 else ""), 11, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
	text(f_disp, Vector2(W - 16, 52), str(combo), 22, C_INK, HORIZONTAL_ALIGNMENT_RIGHT)
	var hearts := "♥".repeat(hp) + "♡".repeat(maxi(0, 5 - hp))
	text(f_body, Vector2(16, 74), hearts, 15, C_BLOOD)
	text(f_body, Vector2(W - 16, 74), "결계 마력", 11, C_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
	var mr := Rect2(16, 81, W - 32, 8)
	box(mr, C_NIGHT2, Color("2b3063"), 4, 1)
	if mana > 0:
		var fillc := C_FROST.lerp(C_GOLD, mana / 100.0)
		if mana >= 100.0:
			fillc = fillc.lightened(0.25 * (0.5 + 0.5 * sin(t * 8.0)))
		box(Rect2(mr.position, Vector2(mr.size.x * mana / 100.0, mr.size.y)), fillc, fillc, 4, 0)


func draw_pad() -> void:
	for d in pad_rects:
		var on := key_flash.has(d)
		box(pad_rects[d], Color("262b5c") if on else C_NIGHT2, C_GOLD if on else C_LINE, 12, 1)
		var c: Vector2 = pad_rects[d].get_center()
		text(f_bold, Vector2(c.x, c.y + 10), GLYPH[d], 28, C_GOLD if on else C_INK, HORIZONTAL_ALIGNMENT_CENTER)
	var rdy := mode == "play" and mana >= 100.0
	box(burst_rect, C_NIGHT2, C_FROST if rdy else C_LINE, 12, 2 if rdy else 1)
	var bc := burst_rect.get_center()
	var tc := C_FROST if rdy else Color(C_FROST, 0.4)
	text(f_disp, Vector2(bc.x, bc.y - 3), "결계", 16, tc, HORIZONTAL_ALIGNMENT_CENTER)
	text(f_disp, Vector2(bc.x, bc.y + 17), "폭발", 16, tc, HORIZONTAL_ALIGNMENT_CENTER)
	box(pause_rect, Color(0, 0, 0, 0), C_LINE, 16, 1)
	text(f_body, Vector2(pause_rect.get_center().x, pause_rect.position.y + 21), "계속하기" if paused else "일시정지", 12, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	box(sound_rect, Color(0, 0, 0, 0), C_LINE, 16, 1)
	text(f_body, Vector2(sound_rect.get_center().x, sound_rect.position.y + 21), "소리 켜짐" if sound_on else "소리 꺼짐", 12, C_DIM, HORIZONTAL_ALIGNMENT_CENTER)
