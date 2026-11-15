extends Node
class_name Festis
## 페스티스 인센티움 (개발자 전용 스킬): 컷씬 + 불의 용이 전장을 쓸어버린다. 피해 9999, 대기시간 30초.
##
## 타임라인
##   0.0  지팡이를 든다 (마법진이 켜지고 마력이 지팡이로 모인다)
##   1.0  지팡이에서 불줄기가 뿜어져 나온다 (소용돌이치며 하늘로 솟는다)
##   2.3  불줄기의 끝에서 용의 모습이 만들어진다 (포효) - 줄기는 용의 몸통·꼬리가 된다
##   3.5  용이 전장 왼쪽 끝으로 크게 돈다
##   4.5  용이 왼쪽에서 오른쪽으로 전장을 가로지르며 불을 뿜는다 (지나가는 곳의 적이 불붙어 쓰러진다)
##   7.0  임무를 마친 용이 하늘로 솟구치며 식어서 검은 재가 되어 흩어진다
##   10.8 끝 (재가 하늘로 올라가며 세상이 다시 밝아진다)

const DUR := 11.6
const T_RAISE := 1.0     # 지팡이를 든 뒤 1초 뒤에 불이 나온다
const T_FORM := 2.9
const T_ARC := 4.2
const T_SWEEP := 5.2
const T_EXIT := 7.6
const T_END := 9.4
const SWEEP_X0 := -34.0
const SWEEP_SPEED := 29.6
const BREATH_REACH := 7.0
const IGNITE_TO_DEATH := 0.3
const HEAD_S := 2.1              # 용 머리 크기 (머리 길이 약 3.5 단위 × 이 값)
const HN := 760                   # 용 머리를 이루는 불꽃 입자 수
const HEAD_GAIN := 0.016          # 입자 하나의 밝기(겹쳐서 더해지므로 낮게)
const RIB_N := 44                 # 불줄기 튜브의 마디 수
const RIB_SIDES := 8
const NECK := 1.25                # 머리 중심에서 목 시작점까지(머리 단위)
const DAMAGE := 9999.0

var main
var hero: Unit
var t := 0.0
var done := false
var hp := Vector3.ZERO
var root: Node3D

var circle: MeshInstance3D
var circle_mat: ShaderMaterial
var staff_light: OmniLight3D
var charge: CPUParticles3D
var stream: CPUParticles3D
var embers: CPUParticles3D
var dragon: Node3D
var head_mat: ShaderMaterial
var head_mm: MultiMeshInstance3D
var h_tgt := PackedVector3Array()      # 입자가 모여 이루는 머리 모양 (머리 좌표)
var h_born := PackedFloat32Array()     # 지팡이를 떠나는 시각
var h_trv := PackedFloat32Array()      # 지팡이에서 제자리까지 걸리는 시간
var h_seed := PackedFloat32Array()
var h_size := PackedFloat32Array()
var h_lick := PackedFloat32Array()     # 불꽃이 위로 널름거리는 정도 (0 = 고정: 눈·이빨)
var h_part := PackedInt32Array()       # 0 몸 1 아래턱 2 눈 3 이빨
var h_col := PackedColorArray()
var h_buf := PackedFloat32Array()
var dragon_light: OmniLight3D
var breath: CPUParticles3D
var trail: CPUParticles3D
var smoke: CPUParticles3D
var wave: CPUParticles3D
var ash_fall: CPUParticles3D       # 용이 재가 되어 날리는 재
var ash_field: CPUParticles3D      # 전장 위로 떠오르는 재와 불씨
var ash_ramp: Gradient
var rib_mat: ShaderMaterial
var stream_mi: MeshInstance3D      # 지팡이 -> 용으로 이어지는 불줄기
var stream_mesh := ArrayMesh.new()
var tail_mi: MeshInstance3D        # 용 뒤로 길게 끌리는 불의 몸통
var tail_mesh := ArrayMesh.new()
var hist: Array = []               # 용 꼬리 끝이 지나간 자리
var stream_head := Vector3.ZERO
var ash_embers: CPUParticles3D
var ash_k := 0.0                   # 0: 타오름 → 1: 재
var victims: Array = []
var killed := 0
var f := {}                       # 한 번만 일어나는 사건 표시
var ov := {"bars": 0.0, "title": 0.0, "heat": 0.0, "skip": 0.0}
var smoke_mesh: QuadMesh
var fire_mesh: QuadMesh
var fire_ramp: Gradient
var fire_curve: Curve
var smoke_ramp: Gradient
var sun_e0 := 1.0
var amb0 := 0.6
var bg0 := 1.0


static var prewarmed := false


static func prewarm(m) -> void:
	## 용·불꽃 셰이더는 처음 그릴 때 컴파일되느라 순간적으로 멈추므로 (소리도 같이 끊긴다),
	## 개발자 모드면 전투가 시작될 때 아주 작게 한 번 그려서 미리 컴파일해 둔다.
	if prewarmed:
		return
	prewarmed = true
	var holder := Node3D.new()
	holder.position = m.hero.position + Vector3(0, 2.0, 0)
	m.add_child(holder)
	var hm := MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var hq := QuadMesh.new()
	hq.size = Vector2(1, 1)
	mm.mesh = hq
	mm.instance_count = 1
	mm.set_instance_transform(0, Transform3D(Basis.IDENTITY * 0.004, Vector3.ZERO))
	hm.multimesh = mm
	var hmat := ShaderMaterial.new()
	hmat.shader = load("res://shaders/fire_sprite.gdshader")
	hm.material_override = hmat
	holder.add_child(hm)
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(0.02, 0.02)
	q.mesh = qm
	var cmat := ShaderMaterial.new()
	cmat.shader = load("res://shaders/magic_circle.gdshader")
	q.material_override = cmat
	holder.add_child(q)
	var rq := MeshInstance3D.new()
	var rm := QuadMesh.new()
	rm.size = Vector2(0.02, 0.02)
	rq.mesh = rm
	var rmat := ShaderMaterial.new()
	rmat.shader = load("res://shaders/fire_ribbon.gdshader")
	rq.material_override = rmat
	holder.add_child(rq)
	m.get_tree().create_timer(0.8).timeout.connect(holder.queue_free)


func start(m, h: Unit) -> void:
	main = m
	hero = h
	hp = hero.position
	root = Node3D.new()
	root.name = "FestisFx"
	main.add_child(root)
	_make_assets()
	sun_e0 = main.sun.light_energy
	if main.world_env:
		amb0 = main.world_env.ambient_light_energy
		bg0 = main.world_env.background_energy_multiplier
	main.cine_active = true
	main.touch_attack = false
	main.move_input = Vector2.ZERO
	hero.face(Vector3(1, 0, 0), true)
	hero.play_once("Spellcast_Raise", 2.2, 0.95)
	hero.shield_t = maxf(hero.shield_t, 0.34)   # 컷씬 동안은 맞지 않는다
	Sfx.play("festis_charge", 1.0, 0.0)
	Sfx.duck = 0.3
	# 발밑 마법진
	circle = MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(12.0, 12.0)
	circle.mesh = qm
	circle_mat = ShaderMaterial.new()
	circle_mat.shader = load("res://shaders/magic_circle.gdshader")
	circle_mat.set_shader_parameter("power", 0.0)
	circle.material_override = circle_mat
	circle.rotation_degrees.x = -90.0
	circle.position = hp + Vector3(0, 0.08, 0)
	circle.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(circle)
	# 불줄기 (지팡이 -> 용)와 용의 불꽃 몸통
	rib_mat = ShaderMaterial.new()
	rib_mat.shader = load("res://shaders/fire_ribbon.gdshader")
	stream_mi = MeshInstance3D.new()
	stream_mi.mesh = stream_mesh
	stream_mi.material_override = rib_mat
	stream_mi.extra_cull_margin = 200.0
	stream_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	stream_mi.visible = false
	root.add_child(stream_mi)
	tail_mi = MeshInstance3D.new()
	tail_mi.mesh = tail_mesh
	tail_mi.material_override = rib_mat
	tail_mi.extra_cull_margin = 200.0
	tail_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	tail_mi.visible = false
	root.add_child(tail_mi)
	# 지팡이 불빛과 빨려드는 마력
	staff_light = OmniLight3D.new()
	staff_light.light_color = Color(1.0, 0.55, 0.18)
	staff_light.omni_range = 14.0
	staff_light.light_energy = 0.0
	root.add_child(staff_light)
	charge = _fire(root, hp, 100, 0.55, 0.0, 0.2, 0.25, 0.55, Vector3(0, 1, 0), 180.0, Vector3.ZERO, false)
	charge.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE_SURFACE
	charge.emission_sphere_radius = 2.4
	charge.radial_accel_min = -11.0
	charge.radial_accel_max = -8.0
	charge.emitting = true


func _make_assets() -> void:
	fire_ramp = Gradient.new()
	fire_ramp.offsets = PackedFloat32Array([0.0, 0.08, 0.4, 0.75, 1.0])
	fire_ramp.colors = PackedColorArray([Color(1.0, 0.78, 0.32, 0.0), Color(1.0, 0.68, 0.24, 0.62), Color(1.0, 0.4, 0.07, 0.55),
		Color(0.72, 0.15, 0.03, 0.34), Color(0.2, 0.04, 0.02, 0.0)])
	fire_curve = Curve.new()
	fire_curve.add_point(Vector2(0.0, 0.35))
	fire_curve.add_point(Vector2(0.25, 1.0))
	fire_curve.add_point(Vector2(1.0, 0.25))
	smoke_ramp = Gradient.new()
	smoke_ramp.offsets = PackedFloat32Array([0.0, 0.25, 1.0])
	smoke_ramp.colors = PackedColorArray([Color(0.12, 0.1, 0.1, 0.0), Color(0.16, 0.13, 0.13, 0.5), Color(0.08, 0.07, 0.07, 0.0)])
	ash_ramp = Gradient.new()
	ash_ramp.offsets = PackedFloat32Array([0.0, 0.12, 0.7, 1.0])
	ash_ramp.colors = PackedColorArray([Color(0.6, 0.52, 0.46, 0.0), Color(0.58, 0.52, 0.48, 0.95), Color(0.4, 0.35, 0.32, 0.8), Color(0.25, 0.22, 0.2, 0.0)])
	# 연기: 밝게 더해지는 불꽃과 달리 어둡게 덮이는 일반 알파 혼합
	fire_mesh = QuadMesh.new()   # 1m 쿼드 (main.spark_mesh는 0.25m라 불기둥에는 너무 작다)
	fire_mesh.size = Vector2(1.0, 1.0)
	fire_mesh.material = main.spark_mesh.material
	smoke_mesh = QuadMesh.new()
	smoke_mesh.size = Vector2(1.0, 1.0)
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	sm.vertex_color_use_as_albedo = true
	sm.albedo_texture = main.spark_mesh.material.albedo_texture
	smoke_mesh.material = sm


func _fire(parent: Node, pos: Vector3, amount: int, life: float, v0: float, v1: float, s0: float, s1: float,
		dir: Vector3, spread: float, grav: Vector3, local := false, as_smoke := false, as_ash := false) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = smoke_mesh if (as_smoke or as_ash) else fire_mesh
	p.amount = amount
	p.lifetime = life
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.25
	p.direction = dir
	p.spread = spread
	p.initial_velocity_min = v0
	p.initial_velocity_max = v1
	p.gravity = grav
	p.scale_amount_min = s0
	p.scale_amount_max = s1
	p.scale_amount_curve = fire_curve
	p.color_ramp = ash_ramp if as_ash else (smoke_ramp if as_smoke else fire_ramp)
	p.local_coords = local
	p.emitting = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(p)
	p.position = pos
	return p


func _ease_back(x: float) -> float:
	var c1 := 1.70158
	var c3 := c1 + 1.0
	return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0)


func staff_tip() -> Vector3:
	## 지팡이 끝 위치: 지팡이 메시의 가장 높은 모서리들의 평균
	var node: Node = hero.model.find_child("2H_Staff", true, false)
	var mi: MeshInstance3D = null
	if node is MeshInstance3D:
		mi = node
	elif node:
		var kids := node.find_children("*", "MeshInstance3D", true, false)
		if not kids.is_empty():
			mi = kids[0]
	if mi == null:
		return hero.position + Vector3(0.6, 3.3, 0)
	var ab := mi.get_aabb()
	var top := -1e9
	for i in 8:
		top = maxf(top, (mi.global_transform * ab.get_endpoint(i)).y)
	var sum := Vector3.ZERO
	var n := 0
	for i in 8:
		var p: Vector3 = mi.global_transform * ab.get_endpoint(i)
		if p.y > top - 0.2:
			sum += p
			n += 1
	return sum / float(maxi(n, 1))


# ---------------- 용의 경로 ----------------
func _bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, k: float) -> Vector3:
	var u := 1.0 - k
	return a * u * u * u + b * 3.0 * u * u * k + c * 3.0 * u * k * k + d * k * k * k


func dragon_pos(tt: float) -> Vector3:
	if tt < T_ARC:   # 주인공 머리 위에 떠 있다 (불이 모이는 동안 조금 솟아오른다)
		var rise := smoothstep(T_FORM, T_FORM + 1.3, tt)
		return hp + Vector3(6.5, 7.8 + 1.8 * rise + 0.3 * sin(tt * 3.0), 0.0)
	if tt < T_SWEEP:   # 크게 돌아 왼쪽 끝으로 간다
		var k := smoothstep(0.0, 1.0, (tt - T_ARC) / (T_SWEEP - T_ARC))
		var p0 := hp + Vector3(6.5, 9.6, 0.0)
		var p3 := Vector3(SWEEP_X0, 5.0, 0.0)
		return _bezier(p0, p0 + Vector3(-8.0, 10.0, 10.0), p3 + Vector3(-6.0, 9.0, 9.0), p3, k)
	if tt < T_EXIT:   # 왼쪽 끝에서 오른쪽 끝까지 낮게 가로지른다
		var s := tt - T_SWEEP
		return Vector3(SWEEP_X0 + SWEEP_SPEED * s, 5.0 + 0.4 * sin(s * 5.0), 1.6 * sin(s * 2.2))
	var e := tt - T_EXIT   # 하늘로 솟구친다
	var ex := SWEEP_X0 + SWEEP_SPEED * (T_EXIT - T_SWEEP)
	var ek := e / (T_END - T_EXIT)
	return Vector3(ex + 16.0 * ek, 5.0 + 26.0 * ek * ek, 2.0 * ek)


func update(delta: float) -> void:
	if done:
		return
	t += delta
	hp = hero.position
	hero.shield_t = maxf(hero.shield_t, 0.34)
	_events()
	_update_hero()
	_update_world()
	_update_fx()
	_update_dragon(delta)
	_update_ribbons()
	_update_victims()
	_update_overlay()
	if t >= DUR:
		finish()


func _events() -> void:
	if t >= T_RAISE and not f.has("burst"):
		f["burst"] = true
		Sfx.play("festis_burst", 1.0, 0.0)
		main.white_flash = 0.55
		main.shake = maxf(main.shake, 1.2)
		var tip := staff_tip()
		stream = _fire(root, tip, 40, 0.8, 1.0, 3.0, 0.9, 1.8, Vector3(0.3, 1, 0), 40.0, Vector3(0, 2.5, 0), false)   # 불줄기 끝의 불덩이
		stream.emission_sphere_radius = 0.9
		stream.emitting = true
		embers = _fire(root, tip, 90, 1.6, 6.0, 14.0, 0.12, 0.3, Vector3(0.2, 1, 0), 28.0, Vector3(0, 3.0, 0), false)
		embers.emitting = true
		stream_mi.visible = true
		_spawn_dragon()
		main.ring_effect(hp, Color(1.0, 0.55, 0.15), 0.6, 13.0, 0.9)
		main.ring_effect(hp, Color(1.0, 0.9, 0.5), 0.4, 8.0, 0.7)
		main.sparks(tip, Color(1.0, 0.75, 0.3), 70, 12.0, 0.9)
	if t >= T_FORM - 0.35 and not f.has("charge_off"):
		f["charge_off"] = true
		if charge:
			charge.emitting = false
	if t >= T_FORM and not f.has("form"):
		f["form"] = true
		Sfx.play("dragon_roar", 1.0, 0.0)
		main.white_flash = 0.4
		main.shake = maxf(main.shake, 1.0)
		var dp := dragon_pos(T_FORM)
		main.ring_effect(Vector3(dp.x, 0.0, dp.z), Color(1.0, 0.5, 0.12), 0.5, 15.0, 1.0)
		main.sparks(dp, Color(1.0, 0.7, 0.25), 90, 14.0, 1.1)
	if t >= T_ARC and not f.has("arc"):
		f["arc"] = true
		_snapshot_victims()
	if t >= T_SWEEP - 0.2 and not f.has("sweep"):
		f["sweep"] = true
		Sfx.play("dragon_pass", 1.0, 0.0)
		main.shake = maxf(main.shake, 0.6)
		if breath:
			breath.emitting = true
		if wave:
			wave.emitting = true
	if t >= T_EXIT and not f.has("exit"):
		f["exit"] = true
		if breath:
			breath.emitting = false
		if wave:
			wave.emitting = false
		main.sparks(dragon.position if dragon else hp, Color(1.0, 0.6, 0.2), 60, 16.0, 1.2)
		_start_ash()
	if t >= T_END - 0.5 and not f.has("ash_off"):
		f["ash_off"] = true
		for p in [ash_field, ash_embers]:
			if p:
				p.emitting = false
	if t >= T_END and not f.has("gone"):
		f["gone"] = true
		if dragon:
			main.sparks(dragon.position, Color(1.0, 0.7, 0.3), 120, 18.0, 1.6)
			dragon.visible = false
			head_mm.visible = false
			_ash_burst(dragon.position, 220, 5.5, 10.0)
			dragon_light.light_energy = 0.0
		for p in [trail, breath, wave, smoke, ash_fall]:
			if p:
				p.emitting = false
		if tail_mi:
			tail_mi.visible = false


func _update_world() -> void:
	## 불빛이 주인공이 되도록 컷씬 동안 세상을 어둡게 한다 (낮 하늘에서는 불이 묻혀서 모양이 안 보인다)
	var k := smoothstep(0.4, 1.3, t) * (1.0 - smoothstep(T_EXIT + 1.2, T_END + 1.2, t))
	main.sun.light_energy = sun_e0 * (1.0 - 0.78 * k)
	if main.world_env:
		main.world_env.ambient_light_energy = amb0 * (1.0 - 0.7 * k)
		main.world_env.background_energy_multiplier = bg0 * (1.0 - 0.82 * k)


func _update_hero() -> void:
	if t >= 2.2 and t < T_END:
		hero.loop_anim("Spellcasting")
	elif t >= T_END:
		hero.lock_t = 0.0
		hero.loop_anim("Idle")


func _update_fx() -> void:
	var tip := staff_tip()
	# 마법진: 켜지고, 불이 터질 때 강해졌다가, 끝에서 꺼진다
	var pw := smoothstep(0.0, 0.7, t) * 1.2
	if t >= T_RAISE:
		pw += 0.7 * exp(-(t - T_RAISE) * 1.2)
	pw *= 1.0 - smoothstep(T_EXIT, T_END - 0.4, t)
	circle_mat.set_shader_parameter("power", pw)
	circle.position = hp + Vector3(0, 0.08, 0)
	# 지팡이 불빛
	var le := 0.0
	if t < T_RAISE:
		le = 6.0 * t
	elif t < T_ARC:
		le = 11.0 + 3.0 * sin(t * 18.0)
	else:
		le = maxf(0.0, 11.0 * (1.0 - (t - T_ARC) * 2.0))
	staff_light.light_energy = le
	staff_light.position = tip
	if charge:
		charge.position = tip
	if stream:
		stream.position = stream_head
		if t >= T_FORM + 0.2:
			stream.emitting = false
	if embers:
		embers.position = tip
	main.shake = maxf(main.shake, 0.35 if (t > T_RAISE and t < T_FORM) else 0.0)


func _head_targets() -> void:
	## 용 머리 모양(머리 좌표: +X 앞, +Y 위, Z 좌우)을 불꽃 입자 위치로 만든다.
	## 두개골·주둥이·아래턱·뿔·갈기·목·눈·이빨을 타원체/곡선에서 뽑아 입자마다 "모일 자리"를 정한다.
	var rng := RandomNumberGenerator.new()
	rng.seed = 7731
	var add := func(p: Vector3, part: int, heat: float, size: float, lick: float) -> void:
		h_tgt.append(p)
		h_part.append(part)
		h_size.append(size)
		h_lick.append(lick)
		h_seed.append(rng.randf())
		var c := Color(0.95, 0.2, 0.03).lerp(Color(1.0, 0.55, 0.1), clampf(heat * 1.5, 0.0, 1.0))
		c = c.lerp(Color(1.0, 0.92, 0.6), clampf((heat - 0.75) * 2.5, 0.0, 1.0))
		h_col.append(c)
	var ell := func(c: Vector3, r: Vector3, n: int, surf: float, part: int, heat: float, size: float, lick: float) -> void:
		for i in n:
			var d := Vector3(rng.randfn(), rng.randfn(), rng.randfn()).normalized()
			var k := surf + (1.0 - surf) * pow(rng.randf(), 0.33)
			add.call(c + d * r * k, part, heat * rng.randf_range(0.8, 1.15), size * rng.randf_range(0.8, 1.2), lick)
	ell.call(Vector3(0.0, 0.25, 0.0), Vector3(0.95, 0.8, 0.8), 170, 0.78, 0, 0.55, 0.55, 0.35)          # 두개골
	ell.call(Vector3(0.45, 0.72, 0.42), Vector3(0.42, 0.17, 0.26), 28, 0.8, 0, 0.7, 0.34, 0.2)           # 눈썹뼈
	ell.call(Vector3(0.45, 0.72, -0.42), Vector3(0.42, 0.17, 0.26), 28, 0.8, 0, 0.7, 0.34, 0.2)
	ell.call(Vector3(1.4, 0.02, 0.0), Vector3(1.0, 0.38, 0.46), 130, 0.85, 0, 0.5, 0.42, 0.25)         # 주둥이
	ell.call(Vector3(1.05, -0.2, 0.0), Vector3(0.7, 0.16, 0.26), 44, 0.5, 0, 1.0, 0.34, 0.3)           # 입 속(벌리면 밝게 타오른다)
	ell.call(Vector3(-1.1, -0.45, 0.0), Vector3(0.95, 0.95, 0.9), 90, 0.7, 0, 0.4, 0.75, 0.6)          # 목 시작
	ell.call(Vector3(-0.85, 0.45, 0.0), Vector3(0.9, 0.7, 0.9), 150, 0.5, 0, 0.3, 0.8, 1.6)            # 갈기: 위로 길게 타오른다
	for s in [-1.0, 1.0]:   # 뿔: 뒤쪽 위로 휘어진다
		for i in 45:
			var u := float(i) / 44.0
			var p := Vector3(-0.15 - 1.7 * u, 0.85 + 1.0 * u - 0.35 * u * u, s * (0.5 + 0.55 * u))
			add.call(p + Vector3(rng.randfn(), rng.randfn(), rng.randfn()) * 0.05, 0, 0.55, 0.4 * (1.0 - 0.5 * u), 0.5)
	for s in [-1.0, 1.0]:   # 눈
		for i in 8:
			add.call(Vector3(0.62, 0.52, s * 0.55) + Vector3(rng.randfn(), rng.randfn(), rng.randfn()) * 0.06, 2, 1.25, 0.24, 0.0)
	for s in [-1.0, 1.0]:   # 콧구멍
		for i in 3:
			add.call(Vector3(2.35, 0.18, s * 0.2) + Vector3(rng.randfn(), rng.randfn(), rng.randfn()) * 0.04, 2, 1.1, 0.2, 0.15)
	for s in [-1.0, 1.0]:   # 이빨(위)
		for i in 9:
			var x := 0.85 + 1.3 * float(i) / 8.0
			add.call(Vector3(x, -0.3, s * lerpf(0.42, 0.2, float(i) / 8.0)), 3, 1.15, 0.17, 0.0)
	for s in [-1.0, 1.0]:   # 이빨(아래: 아래턱과 함께 움직인다)
		for i in 8:
			var x := 0.9 + 1.1 * float(i) / 7.0
			add.call(Vector3(x, -0.56 + 0.2, s * lerpf(0.34, 0.18, float(i) / 7.0)), 1, 1.15, 0.16, 0.0)
	ell.call(Vector3(1.0, -0.62, 0.0), Vector3(0.95, 0.2, 0.36), 90, 0.8, 1, 0.5, 0.4, 0.25)          # 아래턱
	for i in h_tgt.size():
		h_born.append(T_RAISE + 0.95 * pow(rng.randf(), 1.25))
		h_trv.append(1.0 + 0.6 * rng.randf())


func _spawn_dragon() -> void:
	## 불줄기에서 날아온 불꽃 입자들이 모여 용의 머리를 이룬다 (불줄기 -> 용으로 이어지는 변신 효과의 핵심)
	dragon = Node3D.new()
	root.add_child(dragon)
	_head_targets()
	head_mat = ShaderMaterial.new()
	head_mat.shader = load("res://shaders/fire_sprite.gdshader")
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	mm.mesh = q
	mm.instance_count = h_tgt.size()
	head_mm = MultiMeshInstance3D.new()
	head_mm.multimesh = mm
	head_mm.material_override = head_mat
	head_mm.extra_cull_margin = 300.0
	head_mm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(head_mm)
	h_buf.resize(h_tgt.size() * 16)
	dragon_light = OmniLight3D.new()
	dragon_light.light_color = Color(1.0, 0.5, 0.15)
	dragon_light.light_energy = 0.0
	dragon_light.omni_range = 26.0
	root.add_child(dragon_light)
	var dp := dragon_pos(T_FORM)
	trail = _fire(root, dp, 90, 1.0, 0.6, 2.4, 1.6, 3.0, Vector3(0, 1, 0), 40.0, Vector3(0, 1.6, 0), false)
	trail.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	trail.emission_sphere_radius = 1.8
	smoke = _fire(root, dp, 40, 1.6, 0.4, 1.6, 2.2, 3.6, Vector3(0, 1, 0), 40.0, Vector3(0, 2.0, 0), false, true)
	smoke.emission_sphere_radius = 1.8
	breath = _fire(root, dp, 110, 0.75, 30.0, 42.0, 1.6, 3.0, Vector3(0, 0, 1), 11.0, Vector3(0, 2.0, 0), false)
	breath.emission_sphere_radius = 0.5
	wave = _fire(root, Vector3(SWEEP_X0, 0.3, 0.0), 70, 0.9, 3.0, 8.0, 1.1, 2.0, Vector3(0, 1, 0), 18.0, Vector3(0, 3.0, 0), false)
	wave.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	wave.emission_box_extents = Vector3(0.8, 0.2, 16.0)


func _update_dragon(_delta: float) -> void:
	if dragon == null or not dragon.visible:
		return
	var pos := dragon_pos(t)
	var ahead := dragon_pos(t + 0.06) - dragon_pos(t - 0.06)
	var pdir := ahead.normalized() if ahead.length() > 0.01 else Vector3(1, 0, 0)
	# 불이 모일 때는 정면(카메라 쪽)을 보고, 날아갈 때는 진행 방향을 보되 얼굴이 보이게 살짝 카메라 쪽으로 튼다
	var face := Vector3(0.4, -0.14, 1.0).normalized()
	var kfly := smoothstep(T_ARC, T_ARC + 0.9, t)
	var dir := face.lerp((pdir * 0.85 + Vector3(0.0, 0.0, 0.5)).normalized(), kfly).normalized()
	var form := clampf((t - T_RAISE - 0.6) / 2.2, 0.0, 1.0)
	var out := clampf((t - T_EXIT - 0.15) / (T_END - T_EXIT - 0.15), 0.0, 1.0)
	var sc := HEAD_S * (0.6 + 0.4 * _ease_back(form)) * (1.0 + 0.25 * smoothstep(T_ARC, T_SWEEP, t)) * (1.0 - 0.2 * out)
	ash_k = smoothstep(0.05, 0.85, clampf((t - T_EXIT) / (T_END - T_EXIT), 0.0, 1.0))
	var u := (Vector3.UP - dir * Vector3.UP.dot(dir)).normalized()
	var b := Basis(dir, u, dir.cross(u))
	# 입: 포효할 때 크게 벌리고, 전장을 쓸 때는 불을 뿜으며 연신 벌린다
	var roar := smoothstep(T_FORM - 0.15, T_FORM + 0.3, t) * (1.0 - smoothstep(T_FORM + 1.0, T_FORM + 1.7, t))
	var jaw := 0.1 + 0.62 * roar
	if t >= T_SWEEP - 0.2 and t < T_EXIT:
		jaw = 0.32 + 0.22 * sin(t * 6.0)
	dragon.position = pos
	hist.append(pos - dir * NECK * sc - Vector3(0.0, 0.5 * sc, 0.0))
	if hist.size() > 700:
		hist = hist.slice(hist.size() - 600)
	if ash_fall:
		ash_fall.position = pos
	if ash_embers:
		ash_embers.position = pos
	dragon_light.position = pos + Vector3(0, 1.0, 0)
	dragon_light.light_energy = (11.0 + 2.5 * sin(t * 14.0)) * (1.0 - ash_k) * smoothstep(T_RAISE, T_FORM, t)
	trail.position = pos - dir * sc * 0.8
	smoke.position = pos - dir * sc * 0.8
	var mouth := pos + b * (Vector3(2.3, -0.4, 0.0) * sc)
	breath.position = mouth
	breath.basis = Basis.looking_at(-(dir + Vector3(0, -0.4, 0)).normalized(), Vector3.UP)
	wave.position = Vector3(pos.x + 3.0, 0.3, 0.0)
	if t >= T_SWEEP and t < T_EXIT:
		main.shake = maxf(main.shake, 0.4)
	_update_head(pos, b, sc, jaw, dir)


func _update_head(pos: Vector3, b: Basis, sc: float, jaw: float, dir: Vector3) -> void:
	var tip := staff_tip()
	var cj := cos(jaw)
	var sj := sin(jaw)
	var hinge := Vector3(0.35, -0.4, 0.0)
	for i in h_tgt.size():
		var o := i * 16
		var tt := t - h_born[i]
		var sd := h_seed[i]
		var fade := 1.0
		if ash_k > 0.0:
			fade = 1.0 - smoothstep(sd * 0.5, sd * 0.5 + 0.5, ash_k)
		if tt < 0.0 or fade <= 0.0:
			for k in 16:
				h_buf[o + k] = 0.0
			continue
		var tl := h_tgt[i]
		if h_part[i] == 1:   # 아래턱은 턱 관절을 축으로 열린다
			var d := tl - hinge
			tl = hinge + Vector3(cj * d.x + sj * d.y, -sj * d.x + cj * d.y, d.z)
		var wt := pos + b * (tl * sc)
		var k := clampf(tt / h_trv[i], 0.0, 1.0)
		var ke := k * k * (3.0 - 2.0 * k)
		var p := wt
		var hot := 1.0
		var inten := 1.0
		if k < 1.0:   # 지팡이에서 소용돌이치며 날아와 제 자리로 모인다
			var c1 := tip + Vector3(0.6, 4.0 + 3.0 * sd, 0.0)
			var c2 := wt + Vector3(-3.5, -2.0 - 2.0 * sd, 0.0)
			var bz := _bezier(tip, c1, c2, wt, ke)
			var ang := ke * 11.0 + sd * TAU - t * 7.0
			var amp := (1.4 + 1.6 * h_seed[(i * 7) % h_seed.size()]) * sin(PI * ke)
			p = bz + Vector3(0.0, cos(ang), sin(ang)) * amp
			hot = 1.5 - 0.5 * ke
			inten = smoothstep(0.0, 0.12, k)
		elif h_lick[i] > 0.0:   # 자리를 잡은 뒤에는 불꽃이 위로 널름거린다
			var ph := fposmod(sd * 7.31 + t * (0.55 + 0.5 * sd), 1.0)
			p += (Vector3.UP * 0.9 - dir * 0.35) * (ph * h_lick[i] * sc)
			inten = pow(1.0 - ph, 1.1) * smoothstep(0.0, 0.12, ph)
		if ash_k > 0.0:   # 식으면서 위로 흩날린다
			p += Vector3.UP * ash_k * (2.0 + 7.0 * sd)
		var c := h_col[i]
		var ember := ash_k
		var g := HEAD_GAIN * inten * fade * hot * (0.85 + 0.3 * sin(t * 14.0 + sd * 40.0))
		var cr := lerpf(c.r, 0.55, ember) * g
		var cg := lerpf(c.g, 0.08, ember) * g
		var cb := lerpf(c.b, 0.02, ember) * g
		var s := h_size[i] * sc * 0.5 * (0.35 + 0.65 * ke)
		h_buf[o] = s
		h_buf[o + 1] = 0.0
		h_buf[o + 2] = 0.0
		h_buf[o + 3] = p.x
		h_buf[o + 4] = 0.0
		h_buf[o + 5] = s
		h_buf[o + 6] = 0.0
		h_buf[o + 7] = p.y
		h_buf[o + 8] = 0.0
		h_buf[o + 9] = 0.0
		h_buf[o + 10] = s
		h_buf[o + 11] = p.z
		h_buf[o + 12] = cr
		h_buf[o + 13] = cg
		h_buf[o + 14] = cb
		h_buf[o + 15] = sd
	head_mm.multimesh.buffer = h_buf


# ---------------- 불줄기 / 불의 몸통 (튜브) ----------------
func _bez_stream(a: Vector3, d: Vector3, u: float) -> Vector3:
	return _bezier(a, a + Vector3(0.5, 5.5, 0.0), d + Vector3(-4.5, -0.5, 0.0), d, u)


func _build_ribbon(mesh: ArrayMesh, pts: PackedVector3Array, rad: PackedFloat32Array) -> void:
	mesh.clear_surfaces()
	var n := pts.size()
	if n < 2:
		return
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	var prev := Vector3.UP
	for i in n:
		var tg: Vector3 = pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]
		tg = tg.normalized() if tg.length() > 0.0001 else Vector3.RIGHT
		var nr := prev - tg * prev.dot(tg)
		if nr.length() < 0.01:
			nr = tg.cross(Vector3.FORWARD)
		nr = nr.normalized()
		prev = nr
		var bn := tg.cross(nr)
		for j in RIB_SIDES + 1:
			var a := TAU * float(j) / float(RIB_SIDES)
			var dr := nr * cos(a) + bn * sin(a)
			verts.append(pts[i] + dr * rad[i])
			norms.append(dr)
			uvs.append(Vector2(float(i) / float(n - 1), float(j) / float(RIB_SIDES)))
	for i in n - 1:
		for j in RIB_SIDES:
			var a0 := i * (RIB_SIDES + 1) + j
			var a1 := a0 + RIB_SIDES + 1
			idx.append_array([a0, a0 + 1, a1, a0 + 1, a1 + 1, a1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)


func _update_ribbons() -> void:
	rib_mat.set_shader_parameter("fade", 1.0 - ash_k)
	rib_mat.set_shader_parameter("intensity", 0.38 + 0.1 * sin(t * 13.0))
	# 1) 지팡이 → 용: 소용돌이치며 솟는 불줄기. 용이 모습을 갖추면 줄기의 꼬리가 용에게 빨려 들어간다
	if stream_mi.visible:
		var tip := staff_tip()
		var dp := dragon_pos(maxf(t, T_FORM))
		var rear := dp - Vector3(0.3, 1.0, 0.0) * HEAD_S * 1.0 - Vector3(0.0, 0.0, 0.0)
		var p := 1.0 - pow(1.0 - clampf((t - T_RAISE) / (T_FORM - T_RAISE), 0.0, 1.0), 2.2)
		var ak := smoothstep(T_FORM + 0.6, T_ARC + 0.2, t)
		var pts := PackedVector3Array()
		var rad := PackedFloat32Array()
		pts.resize(RIB_N)
		rad.resize(RIB_N)
		var rmax := (1.1 + 1.0 * sin(PI * clampf(p, 0.0, 1.0)) + 0.5 * smoothstep(0.7, 1.0, p)) * (1.0 - ak) * smoothstep(0.0, 0.12, p)
		for i in RIB_N:
			var sk := float(i) / float(RIB_N - 1)
			var u := lerpf(ak * p, p, sk)
			var pos := _bez_stream(tip, rear, u)
			var tg := (_bez_stream(tip, rear, minf(u + 0.02, 1.0)) - _bez_stream(tip, rear, maxf(u - 0.02, 0.0))).normalized()
			var n1 := tg.cross(Vector3(0, 0, 1))
			n1 = n1.normalized() if n1.length() > 0.01 else Vector3.UP
			var n2 := tg.cross(n1)
			var ang := u * 15.0 - t * 9.0
			var amp := 1.3 * sin(PI * u) * (1.0 - ak)
			pts[i] = pos + (n1 * cos(ang) + n2 * sin(ang)) * amp
			rad[i] = rmax * smoothstep(0.0, 0.12, sk) * (1.0 - 0.4 * sk)
		stream_head = pts[RIB_N - 1]
		_build_ribbon(stream_mesh, pts, rad)
		if ak >= 1.0:
			stream_mi.visible = false
			stream_mesh.clear_surfaces()
	# 2) 용 뒤로 길게 끌리는 불의 몸통
	if dragon and dragon.visible and hist.size() > 1 and t >= T_FORM + 0.3:
		var span := 30.0 * smoothstep(T_FORM + 0.3, T_ARC + 0.8, t)
		var pts2: Array = [hist[hist.size() - 1]]
		var cum: Array = [0.0]
		for i in range(hist.size() - 2, -1, -1):
			var d: float = (pts2[pts2.size() - 1] as Vector3).distance_to(hist[i])
			if d < 0.05:
				continue
			pts2.append(hist[i])
			cum.append(float(cum[cum.size() - 1]) + d)
			if float(cum[cum.size() - 1]) >= span:
				break
		var total: float = cum[cum.size() - 1]
		if total < 0.4 or pts2.size() < 2:
			tail_mi.visible = false
			return
		tail_mi.visible = true
		var out := PackedVector3Array()
		var rr := PackedFloat32Array()
		out.resize(RIB_N)
		rr.resize(RIB_N)
		var j := 0
		var rt := 2.4 * smoothstep(T_FORM + 0.3, T_ARC + 0.5, t) * (1.0 - 0.7 * ash_k)
		for i in RIB_N:
			var want := float(i) / float(RIB_N - 1) * total   # 머리(꼬리 끝 시작점)로부터의 거리
			while j < cum.size() - 2 and float(cum[j + 1]) < want:
				j += 1
			var seg := maxf(float(cum[j + 1]) - float(cum[j]), 0.0001)
			var fr := clampf((want - float(cum[j])) / seg, 0.0, 1.0)
			var pp: Vector3 = (pts2[j] as Vector3).lerp(pts2[j + 1], fr)
			var wob := smoothstep(0.0, 7.0, want) * 0.55   # 뱀처럼 굽이치는 몸통
			pp += Vector3(0.0, sin(want * 0.55 - t * 7.0), cos(want * 0.45 - t * 5.0) * 1.3) * wob
			var sk := 1.0 - float(i) / float(RIB_N - 1)    # 꼬리 0 → 용 쪽 1
			out[RIB_N - 1 - i] = pp
			rr[RIB_N - 1 - i] = rt * (0.2 + 0.8 * smoothstep(0.0, 0.7, sk)) * smoothstep(0.0, 0.05, sk)
		_build_ribbon(tail_mesh, out, rr)


# ---------------- 재 ----------------
func _start_ash() -> void:
	## 용이 식어서 검은 재가 된다: 몸에서 재와 불씨가 피어올라 하늘로 흩어지고, 전장 위에도 재가 떠오른다
	var dp := dragon.position
	ash_fall = _fire(root, dp, 300, 2.3, 0.6, 3.0, 0.5, 1.3, Vector3(0, 1, 0), 180.0, Vector3(0, 1.4, 0), false, false, true)
	ash_fall.emission_sphere_radius = 5.0
	ash_fall.emitting = true
	ash_embers = _fire(root, dp, 130, 2.0, 2.0, 8.0, 0.1, 0.3, Vector3(0, 1, 0), 120.0, Vector3(0, 3.5, 0))
	ash_embers.emission_sphere_radius = 5.0
	ash_embers.emitting = true
	ash_field = _fire(root, Vector3(4.0, 7.0, 0.0), 700, 2.6, 0.4, 2.0, 0.5, 1.3, Vector3(0, 1, 0), 35.0, Vector3(0, 1.0, 0), false, false, true)
	ash_field.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	ash_field.emission_box_extents = Vector3(38.0, 7.0, 8.0)
	ash_field.emitting = true


func _ash_burst(pos: Vector3, amount: int, rad: float, up: float) -> void:
	var p := _fire(root, pos, amount, 2.4, 1.0, up * 0.5, 0.18, 0.6, Vector3(0, 1, 0), 150.0, Vector3(0, 0.9, 0), false, false, true)
	p.emission_sphere_radius = rad * 0.4
	p.one_shot = true
	p.explosiveness = 0.85
	p.emitting = true


# ---------------- 적 태우기 ----------------
func _snapshot_victims() -> void:
	victims.clear()
	for u in main.units:
		if u.team == 1 and not u.dead and not u.scripted:
			# 용이 u 보다 BREATH_REACH 만큼 뒤에 왔을 때 불이 붙는다
			var ign: float = T_SWEEP - 0.05 + maxf(0.0, (u.position.x - BREATH_REACH - SWEEP_X0) / SWEEP_SPEED)
			victims.append({"u": u, "ign": ign, "kill": -1.0, "st": 0})


func _update_victims() -> void:
	for v in victims:
		if not is_instance_valid(v.u):
			v.st = 2
			continue
		var u: Unit = v.u
		if v.st == 0 and t >= v.ign:
			v.st = 1
			v.kill = t + IGNITE_TO_DEATH
			_ignite(u)
		if v.st == 1 and t >= v.kill:
			v.st = 2
			_kill(u)


func _ignite(u: Unit) -> void:
	if u.dead:
		return
	u.base_overlay = main._tint_mat("burn")
	u._set_overlay(u.base_overlay)
	var fx := _fire(u, Vector3(0, 1.0, 0), 40, 0.7, 1.2, 2.8, 0.6, 1.2, Vector3(0, 1, 0), 30.0, Vector3(0, 2.6, 0), true)
	fx.emission_sphere_radius = 0.5
	fx.emitting = true
	Sfx.play("ignite", 0.8, 0.12)
	main.sparks(u.position + Vector3(0, 1.0, 0), Color(1.0, 0.6, 0.15), 18, 6.0, 0.6)


func _kill(u: Unit) -> void:
	if u.dead:
		return
	u.take_damage(DAMAGE, null, true)
	killed += 1
	main.sparks(u.position + Vector3(0, 1.0, 0), Color(1.0, 0.5, 0.12), 36 if not u.is_boss else 120, 9.0, 0.9)
	main.burst_effect(u.position + Vector3(0, 1.0, 0), Color(1.0, 0.65, 0.2))
	_ash_burst(u.position + Vector3(0, 1.0, 0), 70 if u.is_boss else 24, 1.4 if u.is_boss else 0.9, 6.0)


# ---------------- 화면 연출 값과 카메라 ----------------
func _update_overlay() -> void:
	ov.bars = clampf(t / 0.55, 0.0, 1.0) * (1.0 - clampf((t - (DUR - 1.0)) / 0.8, 0.0, 1.0))
	ov.title = smoothstep(T_RAISE, T_RAISE + 0.35, t) * (1.0 - smoothstep(T_ARC - 0.5, T_ARC + 0.2, t))
	var heat := 0.3 * smoothstep(T_RAISE, T_FORM, t)
	heat += 0.18 * smoothstep(T_SWEEP - 0.3, T_SWEEP + 0.3, t) * (1.0 - smoothstep(T_EXIT, T_END, t))
	ov.heat = heat * (1.0 - smoothstep(T_END, DUR, t))
	ov.skip = smoothstep(0.8, 1.3, t)


func camera() -> Array:
	if t < T_RAISE:   # 지팡이를 드는 모습을 낮은 각도에서 가까이
		var k := smoothstep(0.0, 1.0, t / T_RAISE)
		var pos := hp + Vector3(lerpf(3.8, 2.8, k), lerpf(4.0, 3.5, k), lerpf(7.0, 5.6, k))
		var look := hp + Vector3(0.0, lerpf(2.3, 3.2, k), 0.0)
		return [pos, look]
	if t < T_FORM:   # 불이 솟는 걸 보며 뒤로 빠진다
		var k2 := smoothstep(0.0, 1.0, (t - T_RAISE) / (T_FORM - T_RAISE))
		var pos2 := hp + Vector3(2.8, 3.5, 5.6).lerp(Vector3(8.0, 5.0, 24.0), k2)
		var look2 := hp + Vector3(2.0, lerpf(3.0, 7.0, k2), 0.0)
		return [pos2, look2]
	var dp := dragon_pos(minf(t, T_END + 0.5))
	if t < T_ARC:   # 용이 모습을 갖추는 걸 올려다보며 천천히 돈다
		var k3 := smoothstep(0.0, 1.0, (t - T_FORM) / (T_ARC - T_FORM))
		var pos3 := hp + Vector3(8.0, 5.0, 24.0).lerp(Vector3(12.0, 6.5, 28.0), k3)
		return [pos3, dp + Vector3(0.0, -0.3, 0.0)]
	if t < T_SWEEP:   # 용을 따라 왼쪽 끝으로
		var k4 := smoothstep(0.0, 1.0, (t - T_ARC) / (T_SWEEP - T_ARC))
		var from_pos := hp + Vector3(12.0, 6.5, 28.0)
		var to_pos := Vector3(-24.0, 10.0, 33.0)   # 왼쪽 성벽·탑 뒤로 넘어가지 않게 x를 제한
		return [from_pos.lerp(to_pos, k4), dp + Vector3(0.0, -0.3, 0.0)]
	if t < T_EXIT:   # 전장을 가로지르는 용을 옆에서 따라간다
		return [Vector3(maxf(dp.x - 6.0, -24.0), 10.0, 33.0), Vector3(dp.x - 2.0, 5.5, 0.0)]
	# 용이 재가 되어 하늘로 솟는 걸 따라가다가, 낮은 각도에서 올려다보며 재가 하늘로 흩어지는 모습을 본다
	var k5 := smoothstep(0.0, 1.0, (t - T_EXIT) / (DUR - T_EXIT))
	var p5 := Vector3(maxf(dp.x - 6.0, -24.0), 10.0, 33.0).lerp(Vector3(24.0, 3.0, 30.0), k5)
	var dc := dp + Vector3(0.0, -0.3, 0.0)
	var l5 := dc.lerp(Vector3(dc.x - 6.0, 26.0, 0.0), smoothstep(T_END - 0.6, DUR, t))
	return [p5, l5]


# ---------------- 끝내기 / 건너뛰기 ----------------
func skip() -> void:
	if done or t < 0.8:
		return
	finish()


func finish() -> void:
	if done:
		return
	done = true
	# 아직 안 쓰러진 적은 모두 쓰러뜨린다 (건너뛰어도 피해는 똑같이 들어간다)
	if victims.is_empty():
		_snapshot_victims()
	for v in victims:
		if is_instance_valid(v.u) and not v.u.dead:
			_kill(v.u)
	if root:
		root.queue_free()
	main.sun.light_energy = sun_e0   # 어두워졌던 세상을 원래대로
	if main.world_env:
		main.world_env.ambient_light_energy = amb0
		main.world_env.background_energy_multiplier = bg0
	Sfx.duck = 1.0
	hero.lock_t = 0.0
	hero.cur_anim = ""
	hero.loop_anim("Idle")
	main.cine_active = false
	main.festis = null
	main.show_banner("페스티스 인센티움", "불꽃의 용이 적 %d명을 태웠습니다" % killed, 2.4)
	queue_free()
