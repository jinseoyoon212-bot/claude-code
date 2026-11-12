extends Node3D
## 폐교 탈출 (Godot 4 버전). 레벨, 플레이어, 귀신, UI, 사운드를 모두 코드로 생성한다.

const WALL_H := 3.0
const WALL_T := 0.3
const DOOR_H := 2.2
const DOOR_W := 1.4
const DESK_TOP := 0.75

# --- 상태 ---
var state := "title"  # title / play / note / keypad / over / won
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
var model_cache := {}
var tex_cache := {}
var amb_timer := 18.0
var vig_mat: ShaderMaterial
var p_title: ColorRect
var amb3d: AudioStreamPlayer3D
var amb_sounds: Array = []
var t_ghost_mat: ShaderMaterial

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
	set_state("title")


func start_game() -> void:
	set_state("play")
	say("…눈을 떠 보니 폐교의 교실이다. 어떻게든 이곳을 빠져나가야 한다.", 6.0)


# =====================================================================
# 입력
# =====================================================================
func _unhandled_input(event: InputEvent) -> void:
	if state == "title":
		if (event is InputEventKey and event.pressed and not event.echo) or (event is InputEventMouseButton and event.pressed):
			start_game()
		return
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

	# 공포 연출(비네트/그레인) + 환경음
	var fear := 0.0
	if state == "play" and ghost_mode != "dormant":
		fear = clamp((12.0 - ghost_dist) / 9.0, 0.0, 1.0)
	vig_mat.set_shader_parameter("fear", fear)
	vig_mat.set_shader_parameter("t", fmod(Time.get_ticks_msec() * 0.001, 100.0))
	if state == "play":
		amb_timer -= delta
		if amb_timer <= 0.0:
			amb_timer = rng.randf_range(14.0, 32.0)
			var ang := rng.randf() * TAU
			amb3d.global_position = player.global_position + Vector3(cos(ang), 0.5, sin(ang)) * rng.randf_range(5.0, 11.0)
			amb3d.stream = amb_sounds[rng.randi() % amb_sounds.size()]
			amb3d.play()

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
func pbr(tex: String, scale: float = 0.5, tint: Color = Color.WHITE, rough_mul: float = 1.0) -> StandardMaterial3D:
	var key := "%s|%s|%s|%s" % [tex, scale, tint, rough_mul]
	if tex_cache.has(key):
		return tex_cache[key]
	var base := "res://assets/textures/%s/" % tex
	var m := StandardMaterial3D.new()
	m.albedo_texture = load(base + "diff.jpg")
	m.albedo_color = tint
	m.normal_enabled = true
	m.normal_texture = load(base + "nor.jpg")
	m.roughness_texture = load(base + "rough.jpg")
	m.roughness = rough_mul
	if ResourceLoader.exists(base + "ao.jpg"):
		m.ao_enabled = true
		m.ao_texture = load(base + "ao.jpg")
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3(scale, scale, scale)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	tex_cache[key] = m
	return m


func color_mat(color: Color, glow: Color = Color(0, 0, 0), rough: float = 0.85, metal: float = 0.0) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = rough
	mat.metallic = metal
	if glow.r + glow.g + glow.b > 0.0:
		mat.emission_enabled = true
		mat.emission = glow
	return mat


func bx(pos: Vector3, size: Vector3, mat: Material, parent: Node = null) -> StaticBody3D:
	var b := StaticBody3D.new()
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
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


func box(pos: Vector3, size: Vector3, color: Color, parent: Node = null, glow: Color = Color(0, 0, 0)) -> StaticBody3D:
	return bx(pos, size, color_mat(color, glow), parent)


func collect_aabbs(n: Node, xf: Transform3D, out: Array) -> void:
	var t := xf
	if n is Node3D:
		t = xf * (n as Node3D).transform
	if n is MeshInstance3D:
		out.append(t * (n as MeshInstance3D).get_aabb())
	for c in n.get_children():
		collect_aabbs(c, t, out)


## Poly Haven(CC0) 모델 배치. 앞면은 +Z. rot_deg는 Y축 회전(도).
func place(id: String, pos: Vector3, rot_deg: float = 0.0, scl: float = 1.0, collide: bool = true) -> StaticBody3D:
	var ps: PackedScene = model_cache.get(id)
	if ps == null:
		ps = load("res://assets/models/%s/%s_1k.gltf" % [id, id])
		model_cache[id] = ps
	var body := StaticBody3D.new()
	add_child(body)
	body.position = pos
	body.rotation.y = deg_to_rad(rot_deg)
	var inst: Node3D = ps.instantiate()
	inst.scale = Vector3.ONE * scl
	body.add_child(inst)
	if collide:
		var boxes: Array = []
		collect_aabbs(inst, Transform3D.IDENTITY, boxes)
		if boxes.size() > 0:
			var m: AABB = boxes[0]
			for b in boxes:
				m = m.merge(b)
			var cs := CollisionShape3D.new()
			var sh := BoxShape3D.new()
			sh.size = m.size
			cs.shape = sh
			cs.position = m.get_center()
			body.add_child(cs)
	else:
		body.collision_layer = 0
		body.collision_mask = 0
	return body


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
	bx(center, size, pbr("peeling_painted_wall", 0.35, Color(0.62, 0.68, 0.62)))


func make_door(hinge: Vector3, along_x: bool, width: float, key: String, locked_msg: String, angle_deg: float, metal: bool = false) -> Dictionary:
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = hinge
	var w := width - 0.02
	var center := Vector3(w / 2.0, DOOR_H / 2.0, 0) if along_x else Vector3(0, DOOR_H / 2.0, w / 2.0)
	var size := Vector3(w, DOOR_H, 0.08) if along_x else Vector3(0.08, DOOR_H, w)
	var mat: Material
	if metal:
		mat = pbr("rusty_metal_02", 0.6, Color(0.55, 0.6, 0.55))
	else:
		mat = pbr("worn_planks", 0.6, Color(0.45, 0.4, 0.34) if key == "" else Color(0.32, 0.28, 0.24))
	var panel := bx(center, size, mat, pivot)
	# 손잡이
	var hp := Vector3(w - 0.14, 1.0, 0) if along_x else Vector3(0, 1.0, w - 0.14)
	var hs := Vector3(0.05, 0.05, 0.22) if along_x else Vector3(0.22, 0.05, 0.05)
	var handle := bx(hp, hs, color_mat(Color(0.55, 0.5, 0.35), Color(0, 0, 0), 0.4, 0.9), panel)
	handle.collision_layer = 0
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


func pickup_body(body: StaticBody3D, id: String, display: String) -> void:
	body.set_meta("it", {"type": "pickup", "id": id, "name": display, "node": body})


## 건전지: 금속 원통 + 초록 띠 (손에 잡히는 아이템이라 약하게 빛난다)
func battery(pos: Vector3, rot_deg: float = 0.0) -> void:
	var b := StaticBody3D.new()
	add_child(b)
	b.position = pos
	b.rotation.y = deg_to_rad(rot_deg)
	var body_mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.03
	cm.bottom_radius = 0.03
	cm.height = 0.13
	body_mi.mesh = cm
	body_mi.material_override = color_mat(Color(0.12, 0.45, 0.15), Color(0.05, 0.3, 0.08), 0.35, 0.6)
	body_mi.rotation.z = PI / 2.0
	b.add_child(body_mi)
	var cap := MeshInstance3D.new()
	var capm := CylinderMesh.new()
	capm.top_radius = 0.012
	capm.bottom_radius = 0.012
	capm.height = 0.02
	cap.mesh = capm
	cap.material_override = color_mat(Color(0.8, 0.8, 0.75), Color(0, 0, 0), 0.3, 1.0)
	cap.rotation.z = PI / 2.0
	cap.position = Vector3(0.075, 0, 0)
	b.add_child(cap)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.18, 0.07, 0.07)
	cs.shape = sh
	b.add_child(cs)
	b.position.y += 0.03
	pickup_body(b, "battery", "건전지")


func note(pos: Vector3, title: String, body: String) -> void:
	var b := box(pos, Vector3(0.28, 0.02, 0.2), Color(0.85, 0.82, 0.7), null, Color(0.18, 0.17, 0.12))
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
	env.background_color = Color(0.01, 0.012, 0.025)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.12, 0.14, 0.2)
	env.ambient_light_energy = 0.45
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.015, 0.02, 0.03)
	env.fog_density = 0.025
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.05
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.12
	env.adjustment_saturation = 0.85
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func build_shell() -> void:
	# 바닥: 구역별로 다른 재질
	bx(Vector3(15, -0.05, -0.15), Vector3(30.6, 0.1, 4.3), pbr("worn_tile_floor", 0.5, Color(0.55, 0.58, 0.55)))
	bx(Vector3(4.85, -0.05, 6.15), Vector3(10.3, 0.1, 8.3), pbr("old_wood_floor", 0.5, Color(0.6, 0.55, 0.5)))
	bx(Vector3(15, -0.05, 6.15), Vector3(10.0, 0.1, 8.3), pbr("dirty_tiles", 0.5, Color(0.5, 0.55, 0.52)))
	bx(Vector3(25.15, -0.05, 6.15), Vector3(10.3, 0.1, 8.3), pbr("old_wood_floor", 0.5, Color(0.5, 0.46, 0.42)))
	bx(Vector3(15, WALL_H + 0.05, 4), Vector3(30.6, 0.1, 12.6), pbr("ceiling_interior", 0.4, Color(0.55, 0.55, 0.52)))

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
	var gate := make_door(Vector3(30, 0, -1), false, 2.0, "gate_key", "정문이 굳게 잠겨 있다. 정문 열쇠가 필요하다.", 90.0, true)
	gate.unlock_msg = "정문이 열렸다! 밖으로 나가자!"

	text3d("EXIT", Vector3(29.8, 2.65, 0), -PI / 2.0, Color(0.2, 0.9, 0.3), 0.012, false)
	add_light(Vector3(29.4, 2.55, 0), Color(0.3, 1.0, 0.4), 0.5, 3.5, false, false)


func build_corridor() -> void:
	# 남쪽 벽(z=-1.85)을 따라 가구와 소품
	place("drawer_cabinet", Vector3(3.0, 0, -1.6), 0.0)
	place("painted_wooden_cabinet", Vector3(8.0, 0, -1.55), 0.0)
	place("painted_wooden_bench", Vector3(12.0, 0, -1.6), 0.0)
	battery(Vector3(12.0, 0.47, -1.6), 20.0)
	place("metal_trash_can", Vector3(16.0, 0, -1.57), 0.0)
	place("korean_public_payphone_01", Vector3(19.0, 1.0, -1.74), 0.0, 1.0, false)
	place("wheelchair_01", Vector3(22.5, 0, -1.1), 160.0)
	place("korean_fire_extinguisher_01", Vector3(27.0, 0, -1.65), 0.0)
	place("fire_alarm", Vector3(24.5, 1.5, -1.85), 0.0, 1.0, false)
	add_light(Vector3(24.5, 1.5, -1.6), Color(1.0, 0.1, 0.05), 0.35, 2.0, false, false)
	place("cardboard_box_01", Vector3(1.0, 0, -1.4), 25.0)
	place("trashbag", Vector3(1.0, 0, -0.5), 0.0)
	place("plastic_crate_01", Vector3(5.5, 0, -1.65), 8.0)
	place("plastic_broom", Vector3(10.2, 0, -1.4), 35.0, 1.0, false)
	place("dustpan", Vector3(10.9, 0, -1.2), 70.0, 1.0, false)
	place("wooden_crate_01", Vector3(28.0, 0, 1.5), 90.0)

	# 천장 램프(깜빡임) + 벽 조명
	for x in [6.0, 15.0, 24.0]:
		place("hanging_industrial_lamp", Vector3(x, WALL_H, 0), 0.0, 0.55, false)
		add_light(Vector3(x, 2.1, 0), Color(0.8, 0.92, 0.75), 1.6, 8.5, true, true)
	for x in [10.5, 20.0]:
		place("industrial_caged_sconce", Vector3(x, 2.2, -1.85), 0.0, 0.5, false)
		add_light(Vector3(x, 2.1, -1.5), Color(1.0, 0.75, 0.45), 0.5, 4.0, false, false)


func build_classroom() -> void:
	var desk_c := Color(0.3, 0.22, 0.14)
	bx(Vector3(5, 1.7, 9.82), Vector3(6, 1.3, 0.05), color_mat(Color(0.04, 0.12, 0.09), Color(0, 0, 0), 0.95))
	bx(Vector3(5, 1.04, 9.78), Vector3(6.1, 0.05, 0.12), color_mat(Color(0.3, 0.22, 0.14)))
	text3d("GRADUATION\n1993.02.17", Vector3(5, 1.7, 9.78), PI, Color(0.85, 0.85, 0.8), 0.0065, true)
	place("wall_clock", Vector3(8.6, 2.5, 9.85), 180.0, 1.2, false)

	# 학생 책상과 의자(모델 앞면 +Z = 칠판 방향)
	for x in [2.0, 4.0, 6.0, 8.0]:
		for z in [4.8, 6.8]:
			place("SchoolDesk_01", Vector3(x, 0, z), rng.randf_range(-8.0, 8.0))
			place("SchoolChair_01", Vector3(x + rng.randf_range(-0.12, 0.12), 0, z - 0.75), rng.randf_range(-25.0, 25.0))

	# 교탁 + 손전등
	place("metal_office_desk", Vector3(5, 0, 8.7), 180.0)
	place("vintage_stapler", Vector3(5.6, 0.79, 8.6), 20.0, 1.0, false)
	var fl := place("vintage_flashlight", Vector3(4.5, 0.795, 8.65), 70.0)
	pickup_body(fl, "flashlight", "손전등")

	note(Vector3(2, 0.9, 4.8), "구겨진 쪽지",
		"마지막 졸업식 날, 칠판에 날짜를 적어 두었다.\n\n사물함은 그 【해(年)의 숫자 네 자리】로 열린다.\n\n…그 아이는 아직도 그 사물함 앞에 서 있을지도 모른다.")

	# 소품
	place("standing_chalkboard_01", Vector3(8.8, 0, 8.6), 200.0)
	place("wooden_bookshelf_worn", Vector3(9.56, 0, 4.0), -90.0)
	place("metal_trash_can", Vector3(2.3, 0, 9.57), 180.0)
	place("wooden_broom", Vector3(0.35, 0.1, 3.0), 90.0, 1.0, false)
	place("cardboard_box_01", Vector3(9.3, 0, 9.2), 15.0)
	place("binder_notebook", Vector3(6.0, 0.88, 4.8), 40.0, 1.0, false)

	# 사물함 (비밀번호 1993) -> 과학실 열쇠
	var locker_mat := pbr("rusty_metal_02", 0.8, Color(0.35, 0.5, 0.52))
	bx(Vector3(0.5, 1, 6), Vector3(0.6, 2, 1.2), locker_mat)
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(0.82, 1, 5.4)
	var panel := bx(Vector3(0.02, 0, 0.55), Vector3(0.04, 1.9, 1.1), pbr("rusty_metal_02", 0.8, Color(0.42, 0.58, 0.6)), pivot)
	var lamp := box(Vector3(0.03, 0.1, 0.9), Vector3(0.03, 0.1, 0.1), Color(0.6, 0.05, 0.05), pivot, Color(1.0, 0.05, 0.05))
	lamp.collision_layer = 0
	make_loot(panel, pivot, "사물함", "1993", "science_key", "과학실 열쇠", 110.0, false)

	add_light(Vector3(5, 2.6, 6), Color(0.5, 0.6, 0.85), 0.55, 7.0, false, false)


func build_science_room() -> void:
	var table_mat := pbr("rusty_metal_02", 0.7, Color(0.3, 0.33, 0.32))
	for p in [Vector2(13, 4.5), Vector2(17, 4.5), Vector2(13, 7.5), Vector2(17, 7.5)]:
		bx(Vector3(p.x, 0.45, p.y), Vector3(2.4, 0.9, 0.9), table_mat)

	place("chemistry_set", Vector3(12.5, 0.9, 4.5), 0.0, 1.0, false)
	battery(Vector3(13.9, 0.93, 4.4), 15.0)
	place("bunsen_burner", Vector3(17.2, 0.9, 4.5), 0.0, 1.0, false)
	place("vintage_microscope", Vector3(16.3, 0.9, 4.6), 160.0, 1.0, false)
	place("industrial_microscope", Vector3(12.2, 0.9, 7.5), 180.0, 1.0, false)
	battery(Vector3(17.0, 0.93, 7.5), -30.0)
	place("metal_stool_01", Vector3(13.0, 0, 6.3), 0.0)
	place("metal_stool_01", Vector3(17.4, 0, 6.5), 30.0)
	place("metal_stool_01", Vector3(15.3, 0, 8.9), 80.0)

	note(Vector3(13.3, 0.92, 7.6), "실험 일지",
		"약품장 안쪽에 【교무실 열쇠】를 숨겨 두었다.\n\n그런데 밤마다 복도에서 발소리가 들린다.\n불빛에 반응하는 것 같다. 손전등을 끄고 숨을 죽이면 그것은 그냥 지나간다.\n\n…뛰면 안 된다. 소리를 듣는다.")

	place("industrial_storage_cart", Vector3(11.2, 0, 3.4), 90.0)
	place("tool_cart", Vector3(11.0, 0, 9.0), 90.0)
	place("wooden_crate_01", Vector3(19.2, 0, 9.4), 10.0)
	place("plastic_crate_01", Vector3(18.4, 0, 9.5), 40.0)
	place("wall_clock", Vector3(15, 2.55, 9.85), 180.0, 1.2, false)

	# 약품장 -> 교무실 열쇠
	bx(Vector3(19.4, 1, 6.2), Vector3(0.8, 2, 1.6), pbr("worn_planks", 0.7, Color(0.4, 0.34, 0.28)))
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(18.98, 1, 5.4)
	var panel := bx(Vector3(-0.02, 0, 0.75), Vector3(0.04, 1.9, 1.5), pbr("worn_planks", 0.7, Color(0.5, 0.42, 0.34)), pivot)
	make_loot(panel, pivot, "약품장", "", "staff_key", "교무실 열쇠", -110.0, false)

	add_light(Vector3(15, 2.6, 6), Color(0.45, 0.85, 0.65), 0.55, 7.0, false, false)


func build_staff_room() -> void:
	# 직원 책상 + 의자
	place("metal_office_desk", Vector3(22.7, 0, 5.0), 0.0)
	place("modern_arm_chair_01", Vector3(22.7, 0, 4.0), 20.0)
	battery(Vector3(23.4, 0.82, 5.1), 40.0)
	place("binder_notebook", Vector3(22.0, 0.79, 5.0), 10.0, 1.0, false)
	place("metal_office_desk", Vector3(22.7, 0, 7.7), 0.0)
	place("modern_arm_chair_01", Vector3(22.2, 0, 6.8), -35.0)
	place("clipboard", Vector3(22.7, 0.79, 7.7), 60.0, 1.0, false)
	place("metal_office_desk", Vector3(27.6, 0, 5.0), 0.0)
	place("classic_laptop", Vector3(27.2, 0.79, 5.0), 10.0, 1.0, false)
	place("desk_lamp_arm_01", Vector3(28.3, 0.79, 5.15), 200.0, 1.0, false)

	# 교장 책상 + 서랍 -> 정문 열쇠
	place("metal_office_desk", Vector3(26.0, 0, 8.55), 180.0)
	place("office_notepads", Vector3(25.3, 0.79, 8.55), 15.0, 1.0, false)
	place("stationery_supplies", Vector3(25.0, 0.79, 8.8), 0.0, 1.0, false)
	place("modern_arm_chair_01", Vector3(26.0, 0, 9.4), 200.0)
	note(Vector3(26.8, 0.8, 8.55), "교장의 메모",
		"정문 열쇠는 내 책상 【서랍】에 있다.\n\n학교는 문을 닫았지만 아이들은 아직 돌아가지 못했다.\n\n열쇠를 챙기면 곧장 정문으로 가라. 뒤돌아보지 마라.")
	var pivot := Node3D.new()
	add_child(pivot)
	pivot.position = Vector3(26.0, 0.45, 8.02)
	var panel := bx(Vector3(0, 0.1, -0.02), Vector3(0.8, 0.2, 0.04), pbr("worn_planks", 0.7, Color(0.45, 0.38, 0.3)), pivot)
	make_loot(panel, pivot, "서랍", "", "gate_key", "정문 열쇠", -70.0, true)

	# 벽 가구
	place("drawer_cabinet", Vector3(29.6, 0, 3.4), -90.0)
	place("drawer_cabinet", Vector3(29.6, 0, 4.6), -90.0)
	place("wooden_bookshelf_worn", Vector3(29.55, 0, 6.6), -90.0)
	place("vintage_cabinet_01", Vector3(22.5, 0, 9.5), 180.0)
	place("vintage_telephone_wall_clock", Vector3(20.15, 1.9, 6.0), 90.0, 1.2, false)
	place("cardboard_box_01", Vector3(29.3, 0, 9.3), 30.0)
	place("metal_trash_can", Vector3(20.9, 0, 3.0), 90.0)

	add_light(Vector3(25, 2.6, 6), Color(0.85, 0.72, 0.5), 0.55, 7.0, false, false)


func build_exterior() -> void:
	bx(Vector3(15, -0.15, 4), Vector3(140, 0.1, 100), pbr("grass_ground", 0.25, Color(0.35, 0.42, 0.35)))
	bx(Vector3(33, -0.05, 0), Vector3(6, 0.1, 4), pbr("concrete_floor_worn_001", 0.4, Color(0.5, 0.5, 0.5)))
	add_light(Vector3(34, 3.5, 0), Color(0.6, 0.75, 1.0), 3.0, 14.0, false, false)

	place("street_lamp_02", Vector3(36.5, 0, 3.2), 180.0)
	add_light(Vector3(36.4, 1.7, 3.2), Color(1.0, 0.85, 0.6), 1.2, 9.0, false, true)
	place("fire_hydrant", Vector3(36.0, 0, -3.6), 20.0)
	place("utility_box_01", Vector3(31.0, 0, 4.0), 90.0)
	place("rock_moss_set_01", Vector3(46.0, -0.1, 14.0), 30.0, 1.0, false)
	place("dry_branches_medium_01", Vector3(34.5, 0, 2.3), 40.0, 1.0, false)
	place("dry_branches_medium_01", Vector3(38.0, 0, -1.5), 120.0, 1.0, false)

	# 폐교 앞으로 이어지는 낡은 철문(원경 실루엣)
	bx(Vector3(45, 1.0, 0), Vector3(0.2, 2.0, 8.0), pbr("rusty_metal_02", 0.5, Color(0.25, 0.28, 0.25)))


func build_debris() -> void:
	var paper_mat := color_mat(Color(0.5, 0.48, 0.42), Color(0, 0, 0), 0.95)
	for i in 70:
		var in_corridor := rng.randf() < 0.4
		var x := rng.randf_range(0.5, 29.5)
		var z := rng.randf_range(-1.8, 1.8) if in_corridor else rng.randf_range(2.5, 9.5)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(rng.randf_range(0.15, 0.4), 0.008, rng.randf_range(0.1, 0.3))
		mi.mesh = bm
		mi.material_override = paper_mat
		add_child(mi)
		mi.position = Vector3(x, 0.006, z)
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

	# 반투명 흰 소복 (프레넬 셰이더)
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_opaque;
uniform vec3 body_color = vec3(0.55, 0.6, 0.7);
void fragment() {
	float f = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 2.0);
	ALBEDO = body_color;
	EMISSION = vec3(0.2, 0.32, 0.5) * (0.25 + f * 1.1);
	ALPHA = clamp(0.5 + f * 0.4, 0.0, 1.0);
	ROUGHNESS = 0.9;
}
"""
	t_ghost_mat = ShaderMaterial.new()
	t_ghost_mat.shader = sh

	var robe := MeshInstance3D.new()
	var rm := CylinderMesh.new()
	rm.top_radius = 0.2
	rm.bottom_radius = 0.58
	rm.height = 1.45
	rm.radial_segments = 24
	rm.cap_top = false
	rm.cap_bottom = false
	robe.mesh = rm
	robe.material_override = t_ghost_mat
	robe.position = Vector3(0, 0.95, 0)
	ghost_visual.add_child(robe)

	var head := MeshInstance3D.new()
	var hm := SphereMesh.new()
	hm.radius = 0.19
	hm.height = 0.38
	head.mesh = hm
	head.material_override = color_mat(Color(0.85, 0.85, 0.88), Color(0.15, 0.17, 0.2))
	head.position = Vector3(0, 1.78, 0.02)
	ghost_visual.add_child(head)

	var hair_mat := color_mat(Color(0.01, 0.01, 0.012), Color(0, 0, 0), 0.6)
	var hair_back := MeshInstance3D.new()
	var hbm := CylinderMesh.new()
	hbm.top_radius = 0.2
	hbm.bottom_radius = 0.26
	hbm.height = 1.0
	hair_back.mesh = hbm
	hair_back.material_override = hair_mat
	hair_back.position = Vector3(0, 1.4, -0.1)
	ghost_visual.add_child(hair_back)
	for x in [-0.12, 0.0, 0.12]:
		var strand := MeshInstance3D.new()
		var sm := BoxMesh.new()
		sm.size = Vector3(0.07, 0.34, 0.03)
		strand.mesh = sm
		strand.material_override = hair_mat
		strand.position = Vector3(x, 1.86, 0.19)
		ghost_visual.add_child(strand)

	var eye_mat := color_mat(Color(0.1, 0, 0), Color(1, 0.05, 0.05))
	for x in [-0.07, 0.07]:
		var e := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.025
		sm.height = 0.05
		e.mesh = sm
		e.material_override = eye_mat
		e.position = Vector3(x, 1.76, 0.185)
		ghost_visual.add_child(e)

	for sgn in [-1.0, 1.0]:
		var arm := MeshInstance3D.new()
		var am := CapsuleMesh.new()
		am.radius = 0.05
		am.height = 0.95
		arm.mesh = am
		arm.material_override = t_ghost_mat
		arm.position = Vector3(0.3 * sgn, 1.25, 0.2)
		arm.rotation_degrees = Vector3(-35, 0, 10.0 * sgn)
		ghost_visual.add_child(arm)

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


func hud_box() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.42)
	sb.set_content_margin_all(10)
	sb.set_corner_radius_all(6)
	return sb


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

	var vig := ColorRect.new()
	vig.set_anchors_preset(Control.PRESET_FULL_RECT)
	vig.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var vsh := Shader.new()
	vsh.code = """
shader_type canvas_item;
uniform float fear = 0.0;
uniform float t = 0.0;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void fragment() {
	vec2 uv = UV - 0.5;
	float v = smoothstep(0.3, 0.95, length(uv * vec2(1.0, 0.85)));
	float g = rand(UV * 1100.0 + vec2(t)) - 0.5;
	vec3 col = mix(vec3(0.0), vec3(0.18, 0.0, 0.0), fear);
	float a = clamp(v * (0.65 + fear * 0.35) + abs(g) * 0.07, 0.0, 1.0);
	COLOR = vec4(col + vec3(max(g, 0.0) * 0.08), a);
}
"""
	vig_mat = ShaderMaterial.new()
	vig_mat.shader = vsh
	vig.material = vig_mat
	ui.add_child(vig)

	cross = ColorRect.new()
	cross.color = Color(1, 1, 1, 0.6)
	anchor_box(cross, 0.5, 0.5, 0.5, 0.5, -2, -2, 2, 2)
	ui.add_child(cross)

	l_prompt = mk_label(26, Color(1, 0.95, 0.6))
	l_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	anchor_box(l_prompt, 0, 0.58, 1, 0.58, 0, 0, 0, 44)
	ui.add_child(l_prompt)

	l_msg = mk_label(26)
	l_msg.add_theme_stylebox_override("normal", hud_box())
	l_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	anchor_box(l_msg, 0.05, 0.84, 0.95, 0.84, 0, 0, 0, 50)
	ui.add_child(l_msg)

	l_inv = mk_label(22)
	l_inv.add_theme_stylebox_override("normal", hud_box())
	anchor_box(l_inv, 0, 0, 0, 0, 16, 16, 300, 220)
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

	# 타이틀
	p_title = ColorRect.new()
	p_title.color = Color(0, 0, 0, 0.93)
	p_title.set_anchors_preset(Control.PRESET_FULL_RECT)
	var lt := mk_label(30, Color(0.85, 0.85, 0.85))
	lt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lt.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lt.set_anchors_preset(Control.PRESET_FULL_RECT)
	lt.text = "폐 교  탈 출\n\n…눈을 떠 보니 어두운 폐교의 교실이다.\n정문 열쇠를 찾아 이곳을 빠져나가라.\n밤마다 복도를 돌아다니는 '그것'을 조심하라.\n\nWASD 이동 · 마우스 시점 · Shift 달리기\nE 상호작용 · F 손전등 · B 건전지 교체\n\n[ 아무 키나 눌러 시작 ]"
	lt.add_theme_font_size_override("font_size", 30)
	p_title.add_child(lt)
	ui.add_child(p_title)

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
	p_title.visible = state == "title"
	l_inv.visible = state != "title"
	l_help.visible = state != "title"
	l_msg.visible = msg_t > 0.0
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

	# 먼 곳의 삐걱거림 / 노크 소리 (가끔 랜덤 위치에서 재생)
	var creak := PackedFloat32Array()
	var cn := int(rate * 1.4)
	creak.resize(cn)
	var ph := 0.0
	var cl := 0.0
	for i in cn:
		var t := float(i) / rate
		ph += TAU * (95.0 - 35.0 * t / 1.4) / rate
		cl += (rng.randf_range(-1.0, 1.0) - cl) * 0.05
		var env := pow(sin(PI * t / 1.4), 2.0)
		creak[i] = env * (0.28 * (sin(ph) + 0.5 * sin(2.0 * ph) + 0.3 * sin(3.0 * ph)) + cl * 0.25) * (0.75 + 0.25 * sin(t * 40.0))
	var knock := PackedFloat32Array()
	var kn := int(rate * 1.0)
	knock.resize(kn)
	var kl := 0.0
	for i in kn:
		var t := float(i) / rate
		kl += (rng.randf_range(-1.0, 1.0) - kl) * 0.3
		var v := 0.0
		for st in [0.0, 0.33, 0.62]:
			if t >= st:
				var dt: float = t - st
				v += exp(-dt * 22.0) * sin(TAU * 72.0 * dt) * 0.9 + kl * exp(-dt * 70.0) * 0.5
		knock[i] = v
	amb_sounds = [make_wav(creak, rate, false), make_wav(knock, rate, false)]
	amb3d = AudioStreamPlayer3D.new()
	amb3d.unit_size = 6.0
	amb3d.max_distance = 45.0
	add_child(amb3d)
