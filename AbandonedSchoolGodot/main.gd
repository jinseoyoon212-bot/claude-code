extends Node3D
## 폐교 탈출 (Godot 4 버전). 레벨, 플레이어, 귀신, UI, 사운드를 모두 코드로 생성한다.

const WALL_H := 3.0
const WALL_T := 0.3
const DOOR_H := 2.2
const DOOR_W := 1.4
const DESK_TOP := 0.75

# --- 상태 ---
var state := "play"  # play / note / keypad / over / won
var inventory := {}
var batteries := 0
var charge := 100.0
var flash_on := false
var stamina := 5.0
var exhausted := false
var running := false
var yaw := PI
var pitch := 0.0
var elapsed := 0.0
var msg_t := 0.0
var step_dist := 0.0
var entry := ""
var active_loot: Dictionary = {}
var end_reason := ""
var interact_pressed := false
var cur_target: Dictionary = {}

# --- 월드 ---
var player: CharacterBody3D
var cam: Camera3D
var flash: SpotLight3D
var ghost: CharacterBody3D
var ghost_visual: Node3D
var ghost_mode := "dormant"
var ghost_wp: Array = []
var ghost_idx := 0
var ghost_lose := 0.0
var ghost_dist := 999.0
var doors: Array = []
var loots: Array = []
var flickers: Array = []
var rng := RandomNumberGenerator.new()

# --- UI / 오디오 ---
var ui: CanvasLayer
var l_prompt: Label
var l_msg: Label
var l_inv: Label
var l_help: Label
var l_bar: Label
var bar_charge: ProgressBar
var bar_stamina: ProgressBar
var cross: ColorRect
var dim: ColorRect
var p_note: PanelContainer
var l_note_title: Label
var l_note_body: Label
var p_keypad: PanelContainer
var l_display: Label
var p_end: ColorRect
var l_end: Label
var hum: AudioStreamPlayer
var heart: AudioStreamPlayer
var steps: AudioStreamPlayer


func _ready() -> void:
	rng.seed = 1993
	build_environment()
	build_shell()
	build_corridor()
	build_classroom()
	build_science_room()
	build_staff_room()
	build_exterior()
	build_debris()
	build_ghost()
	build_player()
	build_ui()
	build_audio()
	set_state("play")
	say("…눈을 떠 보니 폐교의 교실이다. 어떻게든 이곳을 빠져나가야 한다.", 6.0)


# =====================================================================
# 입력
# =====================================================================
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and state == "play":
		yaw -= event.relative.x * 0.0025
		pitch = clamp(pitch - event.relative.y * 0.0025, -1.4, 1.4)
		player.rotation.y = yaw
		cam.rotation.x = pitch
		return

	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var k: int = event.physical_keycode

	if state == "over" or state == "won":
		if k == KEY_R:
			get_tree().reload_current_scene()
		return

	if state == "note":
		if k == KEY_E or k == KEY_ESCAPE:
			close_ui()
		return

	if state == "keypad":
		if k == KEY_ESCAPE:
			close_ui()
		elif k == KEY_BACKSPACE:
			entry = entry.substr(0, max(entry.length() - 1, 0))
		elif k == KEY_ENTER or k == KEY_KP_ENTER:
			submit_code()
		elif k >= KEY_0 and k <= KEY_9:
			press_digit(str(k - KEY_0))
		elif k >= KEY_KP_0 and k <= KEY_KP_9:
			press_digit(str(k - KEY_KP_0))
		return

	# state == "play"
	if k == KEY_E:
		interact_pressed = true
	elif k == KEY_F and inventory.has("flashlight"):
		if charge <= 0.0:
			say("배터리가 없다. B 키로 건전지를 교체하자.")
		else:
			flash_on = not flash_on
	elif k == KEY_B and inventory.has("flashlight"):
		if batteries > 0:
			batteries -= 1
			charge = 100.0
			say("건전지를 교체했다.")
		else:
			say("남은 건전지가 없다.")


func set_state(s: String) -> void:
	state = s
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if s == "play" else Input.MOUSE_MODE_VISIBLE


func close_ui() -> void:
	entry = ""
	active_loot = {}
	set_state("play")


func say(text: String, dur: float = 3.5) -> void:
	l_msg.text = text
	msg_t = dur


# =====================================================================
# 매 프레임
# =====================================================================
func _process(delta: float) -> void:
	if state == "play":
		elapsed += delta
		if flash_on:
			charge -= 0.9 * delta
			if charge <= 0.0:
				charge = 0.0
				flash_on = false
				say("손전등이 꺼졌다! B 키로 건전지를 교체하자.")
	if msg_t > 0.0:
		msg_t -= delta

	# 손전등
	var li := 3.0
	if charge < 15.0:
		li *= 0.7 if sin(Time.get_ticks_msec() * 0.05) > -0.4 else 0.1
	flash.light_energy = li * 2.5
	flash.visible = flash_on and state != "over"

	# 깜빡이는 조명
	for f in flickers:
		if f.blackout > 0.0:
			f.blackout -= delta
		elif rng.randf() < 0.4 * delta:
			f.blackout = rng.randf_range(0.05, 0.35)
		var n := 0.25 + 0.75 * (0.5 + 0.5 * sin(Time.get_ticks_msec() * 0.006 + f.seed))
		f.light.light_energy = 0.0 if f.blackout > 0.0 else f.base * n

	# 문/서랍 애니메이션
	for d in doors:
		var target: float = deg_to_rad(d.angle) if d.open else 0.0
		d.pivot.rotation.y = move_toward(d.pivot.rotation.y, target, deg_to_rad(140.0) * delta)
	for l in loots:
		if l.opened:
			var tgt := deg_to_rad(l.angle)
			if l.axis_x:
				l.pivot.rotation.x = move_toward(l.pivot.rotation.x, tgt, deg_to_rad(150.0) * delta)
			else:
				l.pivot.rotation.y = move_toward(l.pivot.rotation.y, tgt, deg_to_rad(150.0) * delta)

	# 심장 박동
	var hv := 0.0
	var hp := 1.0
	if state == "play" and ghost_mode != "dormant":
		var t: float = clamp((16.0 - ghost_dist) / 13.0, 0.0, 1.0)
		hv = t * 0.9
		hp = 1.0 + t * 0.8
	heart.volume_db = linear_to_db(hv) if hv > 0.01 else -80.0
	heart.pitch_scale = hp

	update_ui()


func _physics_process(delta: float) -> void:
	if state == "play":
		move_player(delta)
		update_target()
		if interact_pressed and not cur_target.is_empty():
			do_interact(cur_target)
		update_ghost(delta)
		# 탈출 판정
		var p := player.global_position
		if p.x > 31.0 and abs(p.z) < 2.5:
			end_game("won", "")
	interact_pressed = false


func move_player(delta: float) -> void:
	var ix := int(Input.is_physical_key_pressed(KEY_D)) - int(Input.is_physical_key_pressed(KEY_A))
	var iz := int(Input.is_physical_key_pressed(KEY_W)) - int(Input.is_physical_key_pressed(KEY_S))
	var dir := player.global_transform.basis * Vector3(ix, 0, -iz)
	dir.y = 0.0
	if dir.length() > 1.0:
		dir = dir.normalized()
	var moving := dir.length() > 0.01

	var want_run := Input.is_physical_key_pressed(KEY_SHIFT) and iz > 0 and moving
	if exhausted and stamina > 1.5:
		exhausted = false
	running = want_run and not exhausted and stamina > 0.0
	if running:
		stamina -= delta
		if stamina <= 0.0:
			stamina = 0.0
			exhausted = true
			running = false
	else:
		stamina = min(5.0, stamina + 0.8 * delta)

	var speed := 5.6 if running else 3.2
	player.velocity.x = dir.x * speed
	player.velocity.z = dir.z * speed
	if player.is_on_floor():
		player.velocity.y = -2.0
	else:
		player.velocity.y -= 20.0 * delta
	player.move_and_slide()

	if moving and player.is_on_floor():
		step_dist += speed * delta
		if step_dist >= (2.2 if running else 1.8):
			step_dist = 0.0
			steps.pitch_scale = rng.randf_range(0.85, 1.1)
			steps.volume_db = -4.0 if running else -9.0
			steps.play()


func update_target() -> void:
	cur_target = {}
	var from := cam.global_position
	var to := from + (-cam.global_transform.basis.z) * 2.6
	var q := PhysicsRayQueryParameters3D.create(from, to)
	q.exclude = [player.get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return
	var c = hit.collider
	if c != null and c.has_meta("it"):
		cur_target = c.get_meta("it")


# =====================================================================
# 상호작용
# =====================================================================
func prompt_for(it: Dictionary) -> String:
	match it.type:
		"pickup":
			return "줍기: " + it.name
		"note":
			return "읽기: " + it.title
		"door":
			if it.locked:
				return "잠긴 문"
			return "문 닫기" if it.open else "문 열기"
		"loot":
			if it.opened:
				return it.name + " (비어 있음)"
			return it.name + (" 비밀번호 입력" if it.code != "" else " 열기")
	return ""


func do_interact(it: Dictionary) -> void:
	match it.type:
		"pickup":
			add_item(it.id, it.name)
			it.node.queue_free()
		"note":
			l_note_title.text = it.title
			l_note_body.text = it.body
			set_state("note")
		"door":
			if it.locked:
				if not inventory.has(it.key):
					say(it.msg)
					return
				it.locked = false
				it.open = true
				say(it.unlock_msg)
			else:
				it.open = not it.open
		"loot":
			if it.opened:
				say("안은 비어 있다.")
			elif it.code != "":
				active_loot = it
				entry = ""
				set_state("keypad")
			else:
				open_loot(it)


func open_loot(it: Dictionary) -> void:
	it.opened = true
	add_item(it.reward_id, it.reward_name)


func add_item(id: String, display: String) -> void:
	if id == "battery":
		batteries += 1
		say("건전지를 주웠다. B 키로 손전등 건전지를 교체할 수 있다.")
	else:
		inventory[id] = display
		say("획득: " + display)
	if id == "staff_key" and ghost_mode == "dormant":
		awaken_ghost()


func press_digit(d: String) -> void:
	if entry.length() < active_loot.code.length():
		entry += d


func submit_code() -> void:
	if active_loot.is_empty():
		return
	if entry == active_loot.code:
		var l := active_loot
		close_ui()
		open_loot(l)
	else:
		say("찰칵... 열리지 않는다. 번호가 틀린 것 같다.")
		entry = ""


func end_game(result: String, reason: String) -> void:
	if state == "over" or state == "won":
		return
	end_reason = reason
	set_state(result)
	flash_on = false


# =====================================================================
# 귀신
# =====================================================================
func awaken_ghost() -> void:
	ghost.global_position = ghost_wp[0]
	ghost.collision_layer = 1
	ghost.collision_mask = 1
	ghost_visual.visible = true
	ghost_idx = 1
	ghost_mode = "patrol"
	say("…복도 어딘가에서 무언가가 깨어났다. 불빛을 끄고 숨을 죽여라.", 5.0)


func update_ghost(delta: float) -> void:
	if ghost_mode == "dormant":
		return
	var to_p := player.global_position - ghost.global_position
	to_p.y = 0.0
	ghost_dist = to_p.length()
	if ghost_dist < 1.1:
		end_game("over", "귀신에게 붙잡혔다…")
		return

	var sees := ghost_can_see()
	if ghost_mode == "patrol":
		if sees:
			ghost_mode = "chase"
			ghost_lose = 4.0
			say("뒤에서 무언가 쫓아온다! 도망쳐!", 3.0)
		else:
			var d: Vector3 = ghost_wp[ghost_idx] - ghost.global_position
			d.y = 0.0
			if d.length() < 0.6:
				ghost_idx = (ghost_idx + 1) % ghost_wp.size()
			ghost_move(ghost_wp[ghost_idx], 1.8)
	if ghost_mode == "chase":
		if sees:
			ghost_lose = 4.0
		else:
			ghost_lose -= delta
			if ghost_lose <= 0.0:
				ghost_mode = "patrol"
				ghost_idx = nearest_wp()
				say("발소리가 멀어진다…")
		if ghost_mode == "chase":
			ghost_move(player.global_position, 3.8)
	ghost_visual.position.y = sin(Time.get_ticks_msec() * 0.002) * 0.1


func ghost_can_see() -> bool:
	var rng_d := 14.0 if flash_on else 5.0
	if running:
		rng_d += 4.0
	if ghost_dist > rng_d:
		return false
	var q := PhysicsRayQueryParameters3D.create(
		ghost.global_position + Vector3.UP * 1.5, player.global_position + Vector3.UP * 1.2)
	q.exclude = [ghost.get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return hit.is_empty() or hit.collider == player


func nearest_wp() -> int:
	var best := 0
	var best_d := INF
	for i in ghost_wp.size():
		var d := (ghost_wp[i] as Vector3).distance_squared_to(ghost.global_position)
		if d < best_d:
			best_d = d
			best = i
	return best


func ghost_move(target: Vector3, speed: float) -> void:
	var d := target - ghost.global_position
	d.y = 0.0
	if d.length() < 0.02:
		return
	d = d.normalized()
	ghost.velocity = d * speed
	ghost.move_and_slide()
	ghost.rotation.y = lerp_angle(ghost.rotation.y, atan2(d.x, d.z), 0.15)


# =====================================================================
# 레벨 생성 헬퍼
# =====================================================================
func box(pos: Vector3, size: Vector3, color: Color, parent: Node = null, glow: Color = Color(0, 0, 0)) -> StaticBody3D:
	var b := StaticBody3D.new()
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.85
	if glow.r + glow.g + glow.b > 0.0:
		mat.emission_enabled = true
		mat.emission = glow
	mi.material_override = mat
	b.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	b.add_child(cs)
	var p: Node = parent if parent != null else self
	p.add_child(b)
	b.position = pos
	return b


func wall(alongx: bool, fixed: float, from: float, to: float, dw: float, at: Array = []) -> void:
	var sorted := at.duplicate()
	sorted.sort()
	var cursor := from
	for d in sorted:
		var a: float = d - dw / 2.0
		var b: float = d + dw / 2.0
		if a > cursor:
			wall_seg(alongx, fixed, cursor, a, WALL_H, 0.0)
		wall_seg(alongx, fixed, a, b, WALL_H - DOOR_H, DOOR_H)
		cursor = b
	if to > cursor:
		wall_seg(alongx, fixed, cursor, to, WALL_H, 0.0)


func wall_seg(alongx: bool, fixed: float, a: float, b: float, h: float, bottom: float) -> void:
	var mid := (a + b) / 2.0
	var y := bottom + h / 2.0
	var center := Vector3(mid, y, fixed) if alongx else Vector3(fixed, y, mid)
	var size := Vector3(b - a, h, WALL_T) if alongx else Vector3(WALL_T, h, b - a)
	box(center, size, Color(0.32, 0.33, 0.30))


func make_door(hinge: Vector3, along_x: bool, width: float, key: String, locked_msg: String, angle_deg: float) -> Dictionary:
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = hinge
	var w := width - 0.02
	var center := Vector3(w / 2.0, DOOR_H / 2.0, 0) if along_x else Vector3(0, DOOR_H / 2.0, w / 2.0)
	var size := Vector3(w, DOOR_H, 0.08) if along_x else Vector3(0.08, DOOR_H, w)
	var color := Color(0.28, 0.2, 0.12) if key == "" else Color(0.2, 0.14, 0.1)
	var panel := box(center, size, color, pivot)
	var it := {
		"type": "door", "pivot": pivot, "key": key, "locked": key != "", "open": false,
		"angle": angle_deg, "msg": locked_msg if locked_msg != "" else "문이 잠겨 있다.",
		"unlock_msg": "열쇠로 문을 열었다.",
	}
	panel.set_meta("it", it)
	doors.append(it)
	return it


func make_loot(panel: Node, pivot: Node3D, cname: String, code: String, reward_id: String, reward_name: String, angle_deg: float, axis_x: bool) -> void:
	var it := {
		"type": "loot", "name": cname, "code": code, "reward_id": reward_id, "reward_name": reward_name,
		"pivot": pivot, "angle": angle_deg, "axis_x": axis_x, "opened": false,
	}
	panel.set_meta("it", it)
	loots.append(it)


func pickup(pos: Vector3, size: Vector3, id: String, display: String, color: Color) -> void:
	var b := box(pos, size, color, null, color * 0.4)
	b.set_meta("it", {"type": "pickup", "id": id, "name": display, "node": b})


func battery(pos: Vector3) -> void:
	pickup(pos, Vector3(0.1, 0.1, 0.2), "battery", "건전지", Color(0.3, 0.9, 0.3))


func note(pos: Vector3, title: String, body: String) -> void:
	var b := box(pos, Vector3(0.28, 0.03, 0.2), Color(0.85, 0.82, 0.7), null, Color(0.15, 0.14, 0.1))
	b.rotation.y = rng.randf_range(0.0, TAU)
	b.set_meta("it", {"type": "note", "title": title, "body": body})


func text3d(text: String, pos: Vector3, rot_y: float, color: Color, px: float, shaded: bool) -> void:
	var l := Label3D.new()
	l.text = text
	l.font_size = 64
	l.pixel_size = px
	l.modulate = color
	l.shaded = shaded
	add_child(l)
	l.position = pos
	l.rotation.y = rot_y


func add_light(pos: Vector3, color: Color, energy: float, range_m: float, shadow: bool, flicker: bool) -> void:
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = energy
	l.omni_range = range_m
	l.shadow_enabled = shadow
	add_child(l)
	l.position = pos
	if flicker:
		flickers.append({"light": l, "base": energy, "seed": rng.randf() * 100.0, "blackout": 0.0})


# =====================================================================
# 레벨
# =====================================================================
func build_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.01, 0.01, 0.02)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.1, 0.11, 0.14)
	env.ambient_light_energy = 0.5
	env.fog_enabled = true
	env.fog_light_color = Color(0.01, 0.012, 0.015)
	env.fog_density = 0.03
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func build_shell() -> void:
	box(Vector3(15, -0.05, 4), Vector3(30.6, 0.1, 12.6), Color(0.18, 0.16, 0.14))
	box(Vector3(15, WALL_H + 0.05, 4), Vector3(30.6, 0.1, 12.6), Color(0.2, 0.2, 0.19))

	wall(true, -2.0, -0.15, 30.15, DOOR_W)
	wall(true, 10.0, -0.15, 30.15, DOOR_W)
	wall(false, 0.0, -2.15, 10.15, DOOR_W)
	wall(false, 30.0, -2.15, 10.15, 2.0, [0.0])  # 정문
	wall(true, 2.0, -0.15, 30.15, DOOR_W, [5.0, 15.0, 25.0])
	wall(false, 10.0, 1.85, 10.0, DOOR_W)
	wall(false, 20.0, 1.85, 10.0, DOOR_W)

	make_door(Vector3(5.0 - DOOR_W / 2.0, 0, 2), true, DOOR_W, "", "", -90.0)
	make_door(Vector3(15.0 - DOOR_W / 2.0, 0, 2), true, DOOR_W, "science_key", "과학실 문이 잠겨 있다. 열쇠가 필요하다.", -90.0)
	make_door(Vector3(25.0 - DOOR_W / 2.0, 0, 2), true, DOOR_W, "staff_key", "교무실 문이 잠겨 있다. 열쇠가 필요하다.", -90.0)
	var gate := make_door(Vector3(30, 0, -1), false, 2.0, "gate_key", "정문이 굳게 잠겨 있다. 정문 열쇠가 필요하다.", 90.0)
	gate.unlock_msg = "정문이 열렸다! 밖으로 나가자!"

	text3d("EXIT", Vector3(29.8, 2.65, 0), -PI / 2.0, Color(0.2, 0.9, 0.3), 0.012, false)


func build_corridor() -> void:
	for x in [3.0, 7.0, 9.0, 17.0, 21.0, 26.0]:
		box(Vector3(x, 0.95, -1.7), Vector3(0.8, 1.9, 0.5), Color(0.22, 0.28, 0.3))
	box(Vector3(12, 0.225, -1.65), Vector3(1.2, 0.45, 0.4), Color(0.25, 0.17, 0.1))
	battery(Vector3(12, 0.5, -1.65))
	for x in [6.0, 15.0, 24.0]:
		add_light(Vector3(x, 2.7, 0), Color(0.75, 0.9, 0.7), 1.6, 8.0, true, true)


func build_classroom() -> void:
	var desk_c := Color(0.3, 0.22, 0.14)
	box(Vector3(5, 1.7, 9.82), Vector3(6, 1.3, 0.05), Color(0.05, 0.14, 0.1))
	text3d("GRADUATION\n1993.02.17", Vector3(5, 1.7, 9.78), PI, Color(0.75, 0.75, 0.7), 0.012, true)

	for x in [2.0, 4.0, 6.0, 8.0]:
		for z in [4.8, 6.8]:
			var d := box(Vector3(x, DESK_TOP / 2.0, z), Vector3(0.9, DESK_TOP, 0.55), desk_c)
			d.rotation.y = deg_to_rad(rng.randf_range(-8.0, 8.0))
			var c := box(Vector3(x + rng.randf_range(-0.1, 0.1), 0.225, z - 0.65), Vector3(0.4, 0.45, 0.4), Color(0.18, 0.15, 0.12))
			c.rotation.y = deg_to_rad(rng.randf_range(-25.0, 25.0))

	box(Vector3(5, 0.4, 8.7), Vector3(1.6, 0.8, 0.7), desk_c)
	pickup(Vector3(5, 0.86, 8.7), Vector3(0.08, 0.08, 0.26), "flashlight", "손전등", Color(0.9, 0.8, 0.3))

	note(Vector3(2, DESK_TOP + 0.02, 4.8), "구겨진 쪽지",
		"마지막 졸업식 날, 칠판에 날짜를 적어 두었다.\n\n사물함은 그 【해(年)의 숫자 네 자리】로 열린다.\n\n…그 아이는 아직도 그 사물함 앞에 서 있을지도 모른다.")

	box(Vector3(0.5, 1, 6), Vector3(0.6, 2, 1.2), Color(0.2, 0.3, 0.32))
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(0.82, 1, 5.4)
	var panel := box(Vector3(0.02, 0, 0.55), Vector3(0.04, 1.9, 1.1), Color(0.26, 0.38, 0.4), pivot)
	box(Vector3(0.03, 0.1, 0.9), Vector3(0.03, 0.1, 0.1), Color(0.6, 0.05, 0.05), pivot, Color(0.8, 0.05, 0.05))
	make_loot(panel, pivot, "사물함", "1993", "science_key", "과학실 열쇠", 110.0, false)

	add_light(Vector3(5, 2.6, 6), Color(0.5, 0.6, 0.8), 0.5, 7.0, false, false)


func build_science_room() -> void:
	for p in [Vector2(13, 4.5), Vector2(17, 4.5), Vector2(13, 7.5), Vector2(17, 7.5)]:
		box(Vector3(p.x, 0.45, p.y), Vector3(2.4, 0.9, 0.9), Color(0.12, 0.14, 0.14))
	battery(Vector3(13, 0.96, 4.5))
	battery(Vector3(17, 0.96, 7.5))
	note(Vector3(13, 0.92, 7.5), "실험 일지",
		"약품장 안쪽에 【교무실 열쇠】를 숨겨 두었다.\n\n그런데 밤마다 복도에서 발소리가 들린다.\n불빛에 반응하는 것 같다. 손전등을 끄고 숨을 죽이면 그것은 그냥 지나간다.\n\n…뛰면 안 된다. 소리를 듣는다.")

	box(Vector3(19.4, 1, 6.2), Vector3(0.8, 2, 1.6), Color(0.3, 0.26, 0.2))
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(18.98, 1, 5.4)
	var panel := box(Vector3(-0.02, 0, 0.75), Vector3(0.04, 1.9, 1.5), Color(0.36, 0.3, 0.22), pivot)
	make_loot(panel, pivot, "약품장", "", "staff_key", "교무실 열쇠", -110.0, false)

	add_light(Vector3(15, 2.6, 6), Color(0.4, 0.8, 0.6), 0.5, 7.0, false, false)


func build_staff_room() -> void:
	var desk_c := Color(0.22, 0.16, 0.1)
	for p in [Vector2(22.5, 5), Vector2(22.5, 7.5), Vector2(27.5, 5)]:
		box(Vector3(p.x, 0.4, p.y), Vector3(1.4, 0.8, 0.8), desk_c)
	battery(Vector3(22.5, 0.86, 5))

	box(Vector3(26, 0.4, 8.5), Vector3(2, 0.8, 0.9), desk_c)
	note(Vector3(26.8, 0.82, 8.5), "교장의 메모",
		"정문 열쇠는 내 책상 【서랍】에 있다.\n\n학교는 문을 닫았지만 아이들은 아직 돌아가지 못했다.\n\n열쇠를 챙기면 곧장 정문으로 가라. 뒤돌아보지 마라.")
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(26, 0.45, 8.04)
	var panel := box(Vector3(0, 0.1, -0.02), Vector3(0.8, 0.2, 0.04), Color(0.3, 0.22, 0.13), pivot)
	make_loot(panel, pivot, "서랍", "", "gate_key", "정문 열쇠", -70.0, true)

	for z in [4.0, 6.0, 8.0]:
		box(Vector3(29.45, 0.75, z), Vector3(0.7, 1.5, 0.6), Color(0.25, 0.27, 0.28))
	add_light(Vector3(25, 2.6, 6), Color(0.8, 0.7, 0.5), 0.5, 7.0, false, false)


func build_exterior() -> void:
	box(Vector3(15, -0.15, 4), Vector3(140, 0.1, 100), Color(0.05, 0.08, 0.05))
	box(Vector3(33, -0.05, 0), Vector3(6, 0.1, 4), Color(0.2, 0.2, 0.2))
	add_light(Vector3(34, 3.5, 0), Color(0.6, 0.75, 1.0), 3.0, 14.0, false, false)


func build_debris() -> void:
	for i in 60:
		var in_corridor := rng.randf() < 0.4
		var x := rng.randf_range(0.5, 29.5)
		var z := rng.randf_range(-1.8, 1.8) if in_corridor else rng.randf_range(2.5, 9.5)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(rng.randf_range(0.15, 0.4), 0.01, rng.randf_range(0.1, 0.3))
		mi.mesh = bm
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.5, 0.48, 0.42)
		mi.material_override = mat
		add_child(mi)
		mi.position = Vector3(x, 0.01, z)
		mi.rotation.y = rng.randf_range(0.0, TAU)


func build_ghost() -> void:
	ghost = CharacterBody3D.new()
	ghost.motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	ghost.collision_layer = 0
	ghost.collision_mask = 0
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.4
	cap.height = 2.0
	cs.shape = cap
	cs.position = Vector3(0, 1, 0)
	ghost.add_child(cs)
	add_child(ghost)
	ghost.position = Vector3(2, 0, 0)

	ghost_visual = Node3D.new()
	ghost_visual.visible = false
	ghost.add_child(ghost_visual)

	var body := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	cm.radius = 0.4
	cm.height = 2.0
	body.mesh = cm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.75, 0.8, 0.85)
	mat.emission_enabled = true
	mat.emission = Color(0.3, 0.34, 0.38)
	body.material_override = mat
	body.position = Vector3(0, 1, 0)
	ghost_visual.add_child(body)

	var eye_mat := StandardMaterial3D.new()
	eye_mat.albedo_color = Color(0.1, 0, 0)
	eye_mat.emission_enabled = true
	eye_mat.emission = Color(1, 0.05, 0.05)
	for x in [-0.15, 0.15]:
		var e := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.06
		sm.height = 0.12
		e.mesh = sm
		e.material_override = eye_mat
		e.position = Vector3(x, 1.6, 0.35)
		ghost_visual.add_child(e)

	var glow := OmniLight3D.new()
	glow.light_color = Color(0.5, 0.7, 1.0)
	glow.light_energy = 1.2
	glow.omni_range = 4.0
	glow.position = Vector3(0, 1.2, 0)
	ghost_visual.add_child(glow)

	for x in [2.0, 14.0, 28.0, 14.0]:
		ghost_wp.append(Vector3(x, 0, 0))


func build_player() -> void:
	player = CharacterBody3D.new()
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.8
	cs.shape = cap
	cs.position = Vector3(0, 0.9, 0)
	player.add_child(cs)
	add_child(player)
	player.position = Vector3(5, 0.05, 3.3)
	player.rotation.y = yaw

	cam = Camera3D.new()
	cam.fov = 75.0
	cam.near = 0.05
	player.add_child(cam)
	cam.position = Vector3(0, 1.6, 0)
	cam.current = true

	flash = SpotLight3D.new()
	flash.spot_range = 18.0
	flash.spot_angle = 32.0
	flash.spot_attenuation = 0.6
	flash.light_color = Color(1, 0.96, 0.82)
	flash.shadow_enabled = true
	flash.visible = false
	cam.add_child(flash)
	flash.position = Vector3(0.15, -0.1, -0.1)


# =====================================================================
# UI
# =====================================================================
func mk_label(font_size: int, color: Color = Color.WHITE) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("shadow_offset_x", 2)
	l.add_theme_constant_override("shadow_offset_y", 2)
	return l


func anchor_box(c: Control, al: float, at: float, ar: float, ab: float, ol: float, ot: float, orr: float, ob: float) -> void:
	c.anchor_left = al
	c.anchor_top = at
	c.anchor_right = ar
	c.anchor_bottom = ab
	c.offset_left = ol
	c.offset_top = ot
	c.offset_right = orr
	c.offset_bottom = ob


func panel_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.13, 0.11, 0.09, 0.98)
	sb.set_content_margin_all(24)
	return sb


func center_panel(p: PanelContainer, size: Vector2) -> void:
	p.custom_minimum_size = size
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.grow_horizontal = Control.GROW_DIRECTION_BOTH
	p.grow_vertical = Control.GROW_DIRECTION_BOTH
	p.add_theme_stylebox_override("panel", panel_style())


func build_ui() -> void:
	ui = CanvasLayer.new()
	add_child(ui)

	cross = ColorRect.new()
	cross.color = Color(1, 1, 1, 0.6)
	anchor_box(cross, 0.5, 0.5, 0.5, 0.5, -2, -2, 2, 2)
	ui.add_child(cross)

	l_prompt = mk_label(26, Color(1, 0.95, 0.6))
	l_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	anchor_box(l_prompt, 0, 0.58, 1, 0.58, 0, 0, 0, 44)
	ui.add_child(l_prompt)

	l_msg = mk_label(26)
	l_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	anchor_box(l_msg, 0.05, 0.84, 0.95, 0.84, 0, 0, 0, 50)
	ui.add_child(l_msg)

	l_inv = mk_label(22)
	anchor_box(l_inv, 0, 0, 0, 0, 20, 16, 340, 260)
	ui.add_child(l_inv)

	l_help = mk_label(20, Color(1, 1, 1, 0.75))
	l_help.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	l_help.text = "목표  정문 열쇠를 찾아 탈출하라\n\nWASD 이동 · Shift 달리기\nE 상호작용 · F 손전등 · B 건전지"
	anchor_box(l_help, 1, 0, 1, 0, -420, 16, -16, 180)
	ui.add_child(l_help)

	bar_stamina = ProgressBar.new()
	bar_stamina.show_percentage = false
	bar_stamina.max_value = 5.0
	anchor_box(bar_stamina, 0, 1, 0, 1, 20, -76, 240, -68)
	ui.add_child(bar_stamina)

	bar_charge = ProgressBar.new()
	bar_charge.show_percentage = false
	bar_charge.max_value = 100.0
	anchor_box(bar_charge, 0, 1, 0, 1, 20, -54, 240, -36)
	ui.add_child(bar_charge)

	l_bar = mk_label(20)
	l_bar.text = "손전등 [F] / 교체 [B]"
	anchor_box(l_bar, 0, 1, 0, 1, 250, -60, 640, -30)
	ui.add_child(l_bar)

	dim = ColorRect.new()
	dim.color = Color(0, 0, 0, 0.65)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(dim)

	# 쪽지 패널
	p_note = PanelContainer.new()
	center_panel(p_note, Vector2(700, 420))
	var nv := VBoxContainer.new()
	nv.add_theme_constant_override("separation", 16)
	l_note_title = mk_label(38, Color(0.95, 0.85, 0.6))
	l_note_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l_note_body = mk_label(22)
	l_note_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l_note_body.custom_minimum_size = Vector2(650, 240)
	var nb := Button.new()
	nb.text = "닫기 (E)"
	nb.focus_mode = Control.FOCUS_NONE
	nb.add_theme_font_size_override("font_size", 24)
	nb.pressed.connect(close_ui)
	nv.add_child(l_note_title)
	nv.add_child(l_note_body)
	nv.add_child(nb)
	p_note.add_child(nv)
	ui.add_child(p_note)

	# 숫자 자물쇠 패널
	p_keypad = PanelContainer.new()
	center_panel(p_keypad, Vector2(400, 560))
	var kv := VBoxContainer.new()
	kv.add_theme_constant_override("separation", 12)
	var kt := mk_label(28, Color(0.9, 0.85, 0.7))
	kt.text = "사물함 자물쇠"
	kt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l_display = mk_label(48, Color(0.4, 1, 0.4))
	l_display.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	kv.add_child(kt)
	kv.add_child(l_display)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for t in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "확인"]:
		var b := Button.new()
		b.text = t
		b.custom_minimum_size = Vector2(110, 66)
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 28)
		b.pressed.connect(on_key_button.bind(t))
		grid.add_child(b)
	kv.add_child(grid)
	var kc := Button.new()
	kc.text = "닫기 (Esc)"
	kc.focus_mode = Control.FOCUS_NONE
	kc.add_theme_font_size_override("font_size", 24)
	kc.pressed.connect(close_ui)
	kv.add_child(kc)
	p_keypad.add_child(kv)
	ui.add_child(p_keypad)

	# 엔딩
	p_end = ColorRect.new()
	p_end.color = Color(0, 0, 0, 0.88)
	p_end.set_anchors_preset(Control.PRESET_FULL_RECT)
	l_end = mk_label(34)
	l_end.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l_end.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l_end.set_anchors_preset(Control.PRESET_FULL_RECT)
	p_end.add_child(l_end)
	ui.add_child(p_end)


func on_key_button(t: String) -> void:
	if t == "지움":
		entry = ""
	elif t == "확인":
		submit_code()
	else:
		press_digit(t)


func update_ui() -> void:
	var playing := state == "play"
	cross.visible = playing
	l_prompt.text = ("[E] " + prompt_for(cur_target)) if (playing and not cur_target.is_empty()) else ""
	l_msg.modulate.a = clamp(msg_t, 0.0, 1.0)

	var lines := "소지품\n"
	for id in inventory:
		lines += "· " + inventory[id] + "\n"
	lines += "· 건전지 x" + str(batteries)
	l_inv.text = lines

	var has_flash := inventory.has("flashlight")
	bar_charge.visible = has_flash
	l_bar.visible = has_flash
	bar_charge.value = charge
	bar_charge.modulate = Color(1, 0.9, 0.4) if charge > 20.0 else Color(1, 0.3, 0.2)
	l_bar.text = "손전등 [F] / 교체 [B]" + ("  ON" if flash_on else "")
	bar_stamina.value = stamina
	bar_stamina.modulate = Color(0.5, 0.8, 1.0)

	dim.visible = state == "note" or state == "keypad"
	p_note.visible = state == "note"
	p_keypad.visible = state == "keypad"
	if state == "keypad" and not active_loot.is_empty():
		var s := ""
		for i in active_loot.code.length():
			s += (entry[i] if i < entry.length() else "_") + " "
		l_display.text = s

	p_end.visible = state == "over" or state == "won"
	if state == "over":
		l_end.text = "GAME OVER\n\n%s\n\nR 키를 눌러 다시 시작" % end_reason
	elif state == "won":
		var t := int(elapsed)
		l_end.text = "탈출 성공!\n\n새벽 공기 속으로 빠져나왔다.\n폐교는 등 뒤에서 조용히 멀어진다.\n\n탈출 시간  %02d:%02d\n\nR 키를 눌러 다시 시작" % [t / 60, t % 60]


# =====================================================================
# 사운드 (코드로 합성)
# =====================================================================
func make_wav(data: PackedFloat32Array, rate: int, loop: bool) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(data.size() * 2)
	for i in data.size():
		bytes.encode_s16(i * 2, int(clamp(data[i], -1.0, 1.0) * 32767.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.stereo = false
	s.data = bytes
	if loop:
		s.loop_mode = AudioStreamWAV.LOOP_FORWARD
		s.loop_begin = 0
		s.loop_end = data.size()
	return s


func build_audio() -> void:
	var rate := 22050

	var hum_data := PackedFloat32Array()
	hum_data.resize(rate * 4)
	var wind := 0.0
	for i in hum_data.size():
		var t := float(i) / rate
		var tone := 0.12 * sin(TAU * 55.0 * t) + 0.07 * sin(TAU * 82.5 * t) + 0.03 * sin(TAU * 110.25 * t)
		wind += (rng.randf_range(-1.0, 1.0) - wind) * 0.02
		hum_data[i] = tone + wind * 0.35
	hum = AudioStreamPlayer.new()
	hum.stream = make_wav(hum_data, rate, true)
	hum.volume_db = -6.0
	add_child(hum)
	hum.play()

	var hb := PackedFloat32Array()
	hb.resize(rate)
	for i in hb.size():
		var t := float(i) / rate
		var v := 0.9 * exp(-t * 18.0) * sin(TAU * 55.0 * t)
		if t >= 0.28:
			v += 0.6 * exp(-(t - 0.28) * 18.0) * sin(TAU * 55.0 * (t - 0.28))
		hb[i] = v
	heart = AudioStreamPlayer.new()
	heart.stream = make_wav(hb, rate, true)
	heart.volume_db = -80.0
	add_child(heart)
	heart.play()

	var sd := PackedFloat32Array()
	sd.resize(int(rate * 0.16))
	var lp := 0.0
	for i in sd.size():
		lp += (rng.randf_range(-1.0, 1.0) - lp) * 0.15
		sd[i] = lp * 2.5 * exp(-float(i) / sd.size() * 7.0)
	steps = AudioStreamPlayer.new()
	steps.stream = make_wav(sd, rate, false)
	add_child(steps)
