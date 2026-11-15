extends Node
class_name Judge
## 아스트라 유디키움 (개발자 전용 스킬): 컷씬 + 하늘이 열리고 별이 쏟아져 모든 적을 정화한다. 피해 9999, 대기시간 30초.
##
## 타임라인
##   0.0  지팡이를 든다 (발밑 마법진, 마력이 지팡이로 모인다)
##   1.0  지팡이에서 빛줄기가 하늘로 솟는다
##   2.5  빛줄기가 닿은 하늘이 갈라지며 거대한 마법진이 열린다 (번개)
##   2.9  마법진에서 유성(별)이 잇달아 쏟아져 적을 정화한다 (적이 있는 곳마다 한 발씩)
##   6.7  하늘에서 거대한 빛기둥이 전장 한가운데로 내리꽂혀 남은 적을 모두 쓸어낸다
##   9.2  빛이 걷히고 금빛 가루가 하늘로 오른다
##   10.8 끝

const DUR := 10.8
const T_RAISE := 1.0
const T_OPEN := 2.5
const T_RAIN := 2.9
const T_RAIN_END := 6.3
const T_PILLAR := 6.7
const T_END := 9.2
const SKY_Y := 40.0
const FIELD_X := 4.0                # 전장 가운데
const METEOR_FALL := 0.8            # 유성이 떨어지는 데 걸리는 시간
const BLAST_R := 5.5                # 유성 하나가 정화하는 반경
const MAX_METEORS := 24
const RIB_N := 14
const RIB_SIDES := 8
const DAMAGE := 9999.0

var main
var hero: Unit
var t := 0.0
var done := false
var hp := Vector3.ZERO
var root: Node3D

var circle: MeshInstance3D
var circle_mat: ShaderMaterial
var sky_a: MeshInstance3D
var sky_b: MeshInstance3D
var sky_mat_a: ShaderMaterial
var sky_mat_b: ShaderMaterial
var staff_light: OmniLight3D
var sky_light: OmniLight3D
var pillar_light: OmniLight3D
var charge: CPUParticles3D
var motes: CPUParticles3D
var beam_mi: MeshInstance3D          # 지팡이 -> 하늘로 솟는 빛줄기
var beam_mat: ShaderMaterial
var pillar_in: MeshInstance3D
var pillar_out: MeshInstance3D
var pillar_in_mat: ShaderMaterial
var pillar_out_mat: ShaderMaterial
var pillar_ring: MeshInstance3D
var pillar_ring_mat: ShaderMaterial
var shafts: Array = []               # 하늘에서 비스듬히 새어 내리는 빛살
var shaft_mat: ShaderMaterial
var meteors: Array = []
var bolts: Array = []                # {mi, t0, life}
var themes: Array = []              # 유성 색 테마: 금빛·청록·보랏빛·분홍·에메랄드 (꼬리·후광·충돌 효과가 같은 색)
var rings: Array = []               # 충돌 자리에 퍼지는 룬 마법진
var bolt_mat: ShaderMaterial
var killed := 0
var f := {}
var ov := {"bars": 0.0, "title": 0.0, "heat": 0.0, "skip": 0.0}
var fire_mesh: QuadMesh
var star_ramp: Gradient
var gold_ramp: Gradient
var fire_curve: Curve
var sun_e0 := 1.0
var amb0 := 0.6
var bg0 := 1.0
var rng := RandomNumberGenerator.new()

static var prewarmed := false


static func prewarm(m) -> void:
	## 셰이더는 처음 그릴 때 컴파일되느라 순간적으로 멈추므로 (소리도 같이 끊긴다),
	## 개발자 모드면 전투가 시작될 때 아주 작게 한 번 그려서 미리 컴파일해 둔다.
	if prewarmed:
		return
	prewarmed = true
	var holder := Node3D.new()
	holder.position = m.hero.position + Vector3(0, 2.0, 0)
	m.add_child(holder)
	for sh in ["res://shaders/fire_ribbon.gdshader", "res://shaders/star_beam.gdshader", "res://shaders/magic_circle.gdshader", "res://shaders/star_flare.gdshader"]:
		var q := MeshInstance3D.new()
		var qm := QuadMesh.new()
		qm.size = Vector2(0.02, 0.02)
		q.mesh = qm
		var mat := ShaderMaterial.new()
		mat.shader = load(sh)
		q.material_override = mat
		holder.add_child(q)
	var cy := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.01
	cm.bottom_radius = 0.01
	cm.height = 0.02
	cy.mesh = cm
	var cmat := ShaderMaterial.new()
	cmat.shader = load("res://shaders/star_beam.gdshader")
	cy.material_override = cmat
	holder.add_child(cy)
	m.get_tree().create_timer(0.8).timeout.connect(holder.queue_free)


func start(m, h: Unit) -> void:
	main = m
	hero = h
	hp = hero.position
	rng.randomize()
	root = Node3D.new()
	root.name = "JudgeFx"
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
	Sfx.play("judge_charge", 1.0, 0.0)
	Sfx.duck = 0.3
	# 발밑 마법진 (푸른 빛)
	circle = _circle_quad(Vector2(12.0, 12.0), Color(0.35, 0.6, 1.0), Color(1.0, 0.95, 0.7))
	circle_mat = circle.material_override
	circle.rotation_degrees.x = -90.0
	circle.position = hp + Vector3(0, 0.08, 0)
	root.add_child(circle)
	# 하늘의 거대한 마법진 두 겹 (아직 보이지 않는다)
	sky_a = _circle_quad(Vector2(84.0, 84.0), Color(0.4, 0.62, 1.0), Color(1.0, 0.93, 0.65))
	sky_b = _circle_quad(Vector2(60.0, 60.0), Color(1.0, 0.82, 0.4), Color(0.75, 0.85, 1.0))
	sky_mat_a = sky_a.material_override
	sky_mat_b = sky_b.material_override
	for s in [sky_a, sky_b]:
		s.rotation_degrees.x = 90.0
		root.add_child(s)
	sky_a.position = Vector3(FIELD_X, SKY_Y, 0.0)
	sky_b.position = Vector3(FIELD_X, SKY_Y - 1.5, 0.0)
	sky_mat_a.set_shader_parameter("power", 0.0)
	sky_mat_b.set_shader_parameter("power", 0.0)
	# 빛
	staff_light = OmniLight3D.new()
	staff_light.light_color = Color(0.75, 0.85, 1.0)
	staff_light.omni_range = 16.0
	staff_light.light_energy = 0.0
	root.add_child(staff_light)
	sky_light = OmniLight3D.new()
	sky_light.light_color = Color(0.7, 0.82, 1.0)
	sky_light.omni_range = 110.0
	sky_light.light_energy = 0.0
	sky_light.position = Vector3(FIELD_X, 30.0, 6.0)
	root.add_child(sky_light)
	charge = _puff(root, hp, 90, 0.6, 0.0, 0.2, 0.18, 0.5, Vector3(0, 1, 0), 180.0, Vector3.ZERO, gold_ramp)
	charge.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE_SURFACE
	charge.emission_sphere_radius = 2.6
	charge.radial_accel_min = -10.0
	charge.radial_accel_max = -7.0
	charge.emitting = true


func _circle_quad(size: Vector2, c1: Color, c2: Color) -> MeshInstance3D:
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = size
	q.mesh = qm
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/magic_circle.gdshader")
	mat.set_shader_parameter("power", 0.0)
	mat.set_shader_parameter("col1", Vector3(c1.r, c1.g, c1.b))
	mat.set_shader_parameter("col2", Vector3(c2.r, c2.g, c2.b))
	q.material_override = mat
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	q.extra_cull_margin = 100.0
	return q


func _beam_material(core: Color, edge: Color, inten: float, top_y: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/star_beam.gdshader")
	m.set_shader_parameter("core_col", Vector3(core.r, core.g, core.b))
	m.set_shader_parameter("edge_col", Vector3(edge.r, edge.g, edge.b))
	m.set_shader_parameter("intensity", inten)
	m.set_shader_parameter("top_y", top_y)
	return m


func _cyl(mat: ShaderMaterial) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.0
	cm.bottom_radius = 1.0
	cm.height = 1.0
	cm.radial_segments = 28
	cm.rings = 1
	cm.cap_top = false
	cm.cap_bottom = false
	mi.mesh = cm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 200.0
	return mi


func _set_cyl(mi: MeshInstance3D, base: Vector3, radius: float, y0: float, y1: float) -> void:
	## 원통을 y0~y1 높이, 지름 radius 로 맞춘다 (메시는 반지름 1, 높이 1)
	mi.scale = Vector3(radius, maxf(y1 - y0, 0.01), radius)
	mi.position = Vector3(base.x, (y0 + y1) * 0.5, base.z)


func _make_assets() -> void:
	star_ramp = Gradient.new()
	star_ramp.offsets = PackedFloat32Array([0.0, 0.1, 0.45, 1.0])
	star_ramp.colors = PackedColorArray([Color(1.0, 1.0, 0.92, 0.0), Color(1.0, 0.96, 0.75, 0.7), Color(0.55, 0.72, 1.0, 0.5), Color(0.25, 0.2, 0.75, 0.0)])
	gold_ramp = Gradient.new()
	gold_ramp.offsets = PackedFloat32Array([0.0, 0.15, 0.6, 1.0])
	gold_ramp.colors = PackedColorArray([Color(1.0, 0.95, 0.7, 0.0), Color(1.0, 0.9, 0.55, 0.85), Color(1.0, 0.7, 0.25, 0.55), Color(0.8, 0.4, 0.1, 0.0)])
	fire_curve = Curve.new()
	fire_curve.add_point(Vector2(0.0, 0.4))
	fire_curve.add_point(Vector2(0.25, 1.0))
	fire_curve.add_point(Vector2(1.0, 0.2))
	fire_mesh = QuadMesh.new()
	fire_mesh.size = Vector2(1.0, 1.0)
	fire_mesh.material = main.spark_mesh.material
	# 유성 색 테마: [핵, 중간, 가장자리] 색과 입자 색띠
	var defs := [
		[Color(1.0, 0.97, 0.8), Color(1.0, 0.75, 0.3), Color(0.85, 0.35, 0.1)],
		[Color(0.9, 1.0, 1.0), Color(0.3, 0.9, 1.0), Color(0.1, 0.3, 0.9)],
		[Color(1.0, 0.9, 1.0), Color(0.8, 0.45, 1.0), Color(0.35, 0.15, 0.8)],
		[Color(1.0, 0.92, 0.96), Color(1.0, 0.45, 0.75), Color(0.7, 0.1, 0.45)],
		[Color(0.92, 1.0, 0.95), Color(0.35, 1.0, 0.6), Color(0.05, 0.5, 0.35)],
	]
	for d in defs:
		var cm := ShaderMaterial.new()
		cm.shader = load("res://shaders/fire_ribbon.gdshader")
		cm.set_shader_parameter("core_col", Vector3(d[0].r, d[0].g, d[0].b))
		cm.set_shader_parameter("mid_col", Vector3(d[1].r, d[1].g, d[1].b))
		cm.set_shader_parameter("edge_col", Vector3(d[2].r, d[2].g, d[2].b))
		cm.set_shader_parameter("intensity", 1.6)
		cm.set_shader_parameter("lick", 0.5)
		var ramp := Gradient.new()
		ramp.offsets = PackedFloat32Array([0.0, 0.1, 0.5, 1.0])
		ramp.colors = PackedColorArray([Color(1, 1, 1, 0.0), Color(d[0].r, d[0].g, d[0].b, 0.85), Color(d[1].r, d[1].g, d[1].b, 0.55), Color(d[2].r, d[2].g, d[2].b, 0.0)])
		themes.append({"mat": cm, "ramp": ramp, "core": d[0], "mid": d[1], "edge": d[2]})
	bolt_mat = ShaderMaterial.new()
	bolt_mat.shader = load("res://shaders/fire_ribbon.gdshader")
	bolt_mat.set_shader_parameter("core_col", Vector3(1.0, 1.0, 1.0))
	bolt_mat.set_shader_parameter("mid_col", Vector3(0.7, 0.82, 1.0))
	bolt_mat.set_shader_parameter("edge_col", Vector3(0.3, 0.4, 1.0))
	bolt_mat.set_shader_parameter("intensity", 2.4)
	bolt_mat.set_shader_parameter("lick", 0.15)


func _puff(parent: Node, pos: Vector3, amount: int, life: float, v0: float, v1: float, s0: float, s1: float,
		dir: Vector3, spread: float, grav: Vector3, ramp: Gradient, local := false) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = fire_mesh
	p.amount = amount
	p.lifetime = life
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.3
	p.direction = dir
	p.spread = spread
	p.initial_velocity_min = v0
	p.initial_velocity_max = v1
	p.gravity = grav
	p.scale_amount_min = s0
	p.scale_amount_max = s1
	p.scale_amount_curve = fire_curve
	p.color_ramp = ramp
	p.local_coords = local
	p.emitting = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(p)
	p.position = pos
	return p


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


func _ease_back(x: float) -> float:
	var c1 := 1.70158
	var c3 := c1 + 1.0
	return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0)


func _bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, k: float) -> Vector3:
	var u := 1.0 - k
	return a * u * u * u + b * 3.0 * u * u * k + c * 3.0 * u * k * k + d * k * k * k


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
	_update_meteors()
	_update_pillar()
	_update_bolts()
	_update_overlay()
	if t >= DUR:
		finish()


func _events() -> void:
	if t >= T_RAISE and not f.has("raise"):
		f["raise"] = true
		var tip := staff_tip()
		main.white_flash = 0.5
		main.shake = maxf(main.shake, 1.0)
		main.ring_effect(hp, Color(0.55, 0.75, 1.0), 0.6, 13.0, 0.9)
		main.ring_effect(hp, Color(1.0, 0.92, 0.6), 0.4, 8.0, 0.7)
		main.sparks(tip, Color(1.0, 0.95, 0.7), 70, 12.0, 0.9)
		# 지팡이에서 하늘로 솟는 빛줄기
		beam_mat = _beam_material(Color(1.0, 0.97, 0.85), Color(0.35, 0.55, 1.0), 2.0, SKY_Y + 6.0)
		beam_mi = _cyl(beam_mat)
		root.add_child(beam_mi)
	if t >= T_OPEN - 0.3 and not f.has("plan"):
		f["plan"] = true
		_plan_meteors()
	if t >= T_OPEN and not f.has("open"):
		f["open"] = true
		Sfx.play("judge_open", 1.0, 0.0)
		main.white_flash = 0.55
		main.shake = maxf(main.shake, 1.3)
		for i in 4:
			_bolt(Vector3(FIELD_X + rng.randf_range(-30.0, 34.0), 0.0, rng.randf_range(-5.0, 5.0)), 0.35)
		_make_shafts()
	if t >= T_PILLAR - 0.6 and not f.has("pre"):
		f["pre"] = true
		Sfx.play("judge_pillar", 1.0, 0.0)
	if t >= T_PILLAR and not f.has("pillar"):
		f["pillar"] = true
		_start_pillar()
	if t >= T_PILLAR + 0.12 and not f.has("sweep"):
		f["sweep"] = true
		for u in _live_enemies():
			_kill(u)
	if t >= T_PILLAR + 1.9 and not f.has("motes_off"):
		f["motes_off"] = true
		if motes:
			motes.emitting = false
	if t >= T_PILLAR + 0.5 and not f.has("off_charge"):
		f["off_charge"] = true
		if charge:
			charge.emitting = false


func _live_enemies() -> Array:
	var out: Array = []
	for u in main.units:
		if u.team == 1 and not u.dead and not u.scripted:
			out.append(u)
	return out


func _update_world() -> void:
	## 별빛이 주인공이 되도록 컷씬 동안 세상을 어둡게 한다
	var k := smoothstep(0.5, 1.6, t) * (1.0 - smoothstep(T_PILLAR + 0.8, T_END, t))
	main.sun.light_energy = sun_e0 * (1.0 - 0.85 * k)
	if main.world_env:
		main.world_env.ambient_light_energy = amb0 * (1.0 - 0.6 * k)
		main.world_env.background_energy_multiplier = bg0 * (1.0 - 0.88 * k)


func _update_hero() -> void:
	if t >= 2.2 and t < T_END - 0.6:
		hero.loop_anim("Spellcasting")
	elif t >= T_END - 0.6:
		hero.lock_t = 0.0
		hero.loop_anim("Idle")


func _update_fx() -> void:
	var tip := staff_tip()
	# 발밑 마법진
	var pw := smoothstep(0.0, 0.7, t) * 1.2
	if t >= T_RAISE:
		pw += 0.7 * exp(-(t - T_RAISE) * 1.2)
	pw *= 1.0 - smoothstep(T_PILLAR + 1.0, T_END, t)
	circle_mat.set_shader_parameter("power", pw)
	circle.position = hp + Vector3(0, 0.08, 0)
	# 지팡이 불빛
	var le := 0.0
	if t < T_RAISE:
		le = 6.0 * t
	elif t < T_OPEN + 0.5:
		le = 12.0 + 3.0 * sin(t * 18.0)
	else:
		le = maxf(0.0, 12.0 * (1.0 - (t - T_OPEN - 0.5) * 1.5))
	staff_light.light_energy = le
	staff_light.position = tip
	if charge:
		charge.position = tip
	# 지팡이에서 솟는 빛줄기: 하늘까지 뻗고, 마법진이 열리면 가늘어진다
	if beam_mi:
		var k := smoothstep(0.0, 1.0, (t - T_RAISE) / (T_OPEN - T_RAISE))
		var top := lerpf(tip.y, SKY_Y, k)
		var rad := (0.5 + 0.12 * sin(t * 20.0)) * (1.0 - 0.8 * smoothstep(T_OPEN, T_OPEN + 1.0, t))
		_set_cyl(beam_mi, tip, maxf(rad, 0.05), tip.y, top)
		beam_mat.set_shader_parameter("fade", 1.0 - smoothstep(T_OPEN + 0.6, T_OPEN + 1.4, t))
		if t > T_OPEN + 1.5:
			beam_mi.visible = false
	# 하늘의 마법진: 빛줄기가 닿으면 열린다
	var open := clampf((t - (T_RAISE + 1.0)) / (T_OPEN - T_RAISE - 0.8), 0.0, 1.0)
	var os := _ease_back(open)
	var close_k := 1.0 - smoothstep(T_PILLAR + 1.2, T_END, t)
	sky_a.scale = Vector3(1, 1, 1) * maxf(os, 0.01)
	sky_b.scale = Vector3(1, 1, 1) * maxf(os, 0.01)
	sky_a.rotation.y = t * 0.12
	sky_b.rotation.y = -t * 0.2
	var surge := 0.0
	if t >= T_PILLAR:
		surge = 0.8 * exp(-(t - T_PILLAR) * 1.4)
	sky_mat_a.set_shader_parameter("power", (open * 1.3 + surge) * close_k)
	sky_mat_b.set_shader_parameter("power", (open * 1.1 + surge) * close_k)
	sky_light.light_energy = (open * 1.6 + surge * 2.0) * close_k
	# 빛살
	for s in shafts:
		var a: float = float(s.fade_in) * (1.0 - smoothstep(T_PILLAR - 0.2, T_PILLAR + 0.5, t))
		(s.mat as ShaderMaterial).set_shader_parameter("fade", a * (0.7 + 0.3 * sin(t * 3.0 + float(s.ph))))
	if t >= T_PILLAR + 0.6:
		for s in shafts:
			(s.mi as MeshInstance3D).visible = false


func _make_shafts() -> void:
	shaft_mat = null
	for i in 7:
		var m := _beam_material(Color(0.9, 0.95, 1.0), Color(0.45, 0.6, 1.0), 0.55, SKY_Y + 4.0)
		m.set_shader_parameter("rings", 0.0)
		m.set_shader_parameter("fade", 0.0)
		var mi := _cyl(m)
		root.add_child(mi)
		var bx := FIELD_X + rng.randf_range(-34.0, 36.0)
		var bz := rng.randf_range(-6.0, 4.0)
		_set_cyl(mi, Vector3(bx, 0, bz), rng.randf_range(0.9, 2.2), 0.0, SKY_Y)
		shafts.append({"mi": mi, "mat": m, "fade_in": 1.0, "ph": rng.randf() * 6.0})


# ---------------- 유성 ----------------
func _plan_meteors() -> void:
	## 적이 있는 곳마다 유성 한 발씩 (한 발이 반경 BLAST_R 의 적을 정화한다). 남은 적은 마지막 빛기둥이 쓸어낸다
	var left := _live_enemies()
	left.sort_custom(func(a, b): return a.position.x < b.position.x)
	var targets: Array = []
	while not left.is_empty() and targets.size() < MAX_METEORS:
		var e: Unit = left.pop_front()
		var tg := Vector3(e.position.x, 0.0, e.position.z)
		targets.append(tg)
		var rest: Array = []
		for u in left:
			if Vector2(u.position.x - tg.x, u.position.z - tg.z).length() > BLAST_R:
				rest.append(u)
		left = rest
	# 적이 적을 때도 유성우가 볼만하도록, 살아 있는 적을 한 번 더 겨냥한다 (빈 땅에는 떨어뜨리지 않는다)
	var alive := _live_enemies()
	var extra := 0
	while not alive.is_empty() and targets.size() < 10 and extra < 12:
		var e2: Unit = alive[rng.randi() % alive.size()]
		targets.append(Vector3(e2.position.x + rng.randf_range(-1.0, 1.0), 0.0, e2.position.z + rng.randf_range(-1.0, 1.0)))
		extra += 1
	targets.shuffle()
	var n := targets.size()
	for i in n:
		var k := float(i) / float(maxi(n - 1, 1))
		var t_hit := T_RAIN + METEOR_FALL + (T_RAIN_END - T_RAIN - METEOR_FALL) * pow(k, 0.85)
		var tg: Vector3 = targets[i]
		meteors.append({"to": tg, "from": tg + Vector3(rng.randf_range(-20.0, -12.0), SKY_Y, rng.randf_range(-3.0, 3.0)),
			"t_hit": t_hit, "t0": t_hit - METEOR_FALL, "st": 0, "theme": i % themes.size()})


func _ribbon_mi(mat: ShaderMaterial) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = ArrayMesh.new()
	mi.material_override = mat
	mi.extra_cull_margin = 200.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	return mi


func _spawn_meteor(m: Dictionary) -> void:
	var th: Dictionary = themes[m.theme]
	var n := Node3D.new()
	root.add_child(n)
	# 하얗게 타는 핵 + 반짝이는 십자 별빛 + 후광
	var core := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.6
	sm.height = 1.2
	core.mesh = sm
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1.0, 0.98, 0.92)
	mat.fog_enabled = false
	core.material_override = mat
	core.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(core)
	var flare := MeshInstance3D.new()
	var fq := QuadMesh.new()
	fq.size = Vector2(1, 1)
	flare.mesh = fq
	var fm := ShaderMaterial.new()
	fm.shader = load("res://shaders/star_flare.gdshader")
	var mc: Color = th.mid
	fm.set_shader_parameter("col", Vector3(mc.r, mc.g, mc.b))
	flare.material_override = fm
	flare.scale = Vector3.ONE * 8.0
	flare.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(flare)
	var glow := _puff(n, Vector3.ZERO, 20, 0.5, 0.2, 1.0, 2.0, 3.6, Vector3(0, 1, 0), 180.0, Vector3.ZERO, th.ramp)
	glow.emitting = true
	# 지나간 자리에 흩뿌려지는 별가루
	var dust := _puff(root, Vector3.ZERO, 90, 1.5, 0.4, 2.4, 0.25, 0.6, Vector3(0, 1, 0), 180.0, Vector3(0, -1.2, 0), th.ramp)
	dust.emitting = true
	var light := OmniLight3D.new()
	light.light_color = th.mid
	light.omni_range = 20.0
	light.light_energy = 5.0
	n.add_child(light)
	m["node"] = n
	m["core"] = core
	m["flare"] = flare
	m["flare_mat"] = fm
	m["dust"] = dust
	m["tail"] = _ribbon_mi(th.mat)
	m["helix1"] = _ribbon_mi(th.mat)
	m["helix2"] = _ribbon_mi(th.mat)
	m["light"] = light
	m["glow"] = glow
	m["st"] = 1
	Sfx.play("star_fall", 0.55, 0.12)


func _update_meteors() -> void:
	for m in meteors:
		if m.st == 0 and t >= m.t0:
			_spawn_meteor(m)
		if m.st == 1:
			var k := clampf((t - m.t0) / METEOR_FALL, 0.0, 1.0)
			var kk := pow(k, 1.5)
			var from: Vector3 = m.from
			var to: Vector3 = m.to
			var p := from.lerp(to, kk)
			(m.node as Node3D).position = p
			(m.dust as CPUParticles3D).position = p
			var fs := 8.0 * (1.0 + 0.15 * sin(t * 30.0 + float(m.to.x)))
			(m.flare as MeshInstance3D).scale = Vector3.ONE * fs
			# 꼬리: 지나온 길을 따라 길게 늘어진다 + 그 둘레를 두 가닥의 빛줄기가 나선으로 휘감는다
			var back := from.lerp(to, pow(maxf(k - 0.34, 0.0), 1.5))
			var dirv := (to - from).normalized()
			var n1 := dirv.cross(Vector3.UP).normalized()
			var n2 := dirv.cross(n1)
			var pts := PackedVector3Array()
			var rad := PackedFloat32Array()
			var h1 := PackedVector3Array()
			var h2 := PackedVector3Array()
			var hr := PackedFloat32Array()
			pts.resize(RIB_N)
			rad.resize(RIB_N)
			h1.resize(RIB_N)
			h2.resize(RIB_N)
			hr.resize(RIB_N)
			for i in RIB_N:
				var s := float(i) / float(RIB_N - 1)   # 0 꼬리 → 1 머리
				var c := back.lerp(p, s)
				pts[i] = c
				rad[i] = 1.0 * smoothstep(0.0, 0.6, s) * (0.3 + 0.7 * s)
				var ang := s * 16.0 - t * 16.0
				var amp := 0.3 + 2.2 * (1.0 - s) * smoothstep(0.0, 0.25, s * 2.0)
				h1[i] = c + (n1 * cos(ang) + n2 * sin(ang)) * amp
				h2[i] = c + (n1 * cos(ang + PI) + n2 * sin(ang + PI)) * amp
				hr[i] = 0.2 * smoothstep(0.0, 0.5, s)
			_build_ribbon((m.tail as MeshInstance3D).mesh as ArrayMesh, pts, rad)
			_build_ribbon((m.helix1 as MeshInstance3D).mesh as ArrayMesh, h1, hr)
			_build_ribbon((m.helix2 as MeshInstance3D).mesh as ArrayMesh, h2, hr)
			if k >= 1.0:
				m.st = 2
				m["t_dead"] = t + 0.35
				_impact(m)
		elif m.st == 2:
			var age := 1.0 - (float(m.t_dead) - t) / 0.35
			if m.has("flare_mat") and m.flare_mat != null:
				(m.flare as MeshInstance3D).scale = Vector3.ONE * lerpf(8.0, 26.0, clampf(age * 3.0, 0.0, 1.0))
				(m.flare_mat as ShaderMaterial).set_shader_parameter("fade", clampf(1.0 - age, 0.0, 1.0))
			if m.has("light") and is_instance_valid(m.light):
				(m.light as OmniLight3D).light_energy = maxf(0.0, 16.0 * (1.0 - age))
			if t >= float(m.t_dead):
				m.st = 3
				for key in ["node", "tail", "helix1", "helix2", "dust"]:
					if m.has(key) and is_instance_valid(m[key]):
						(m[key] as Node).queue_free()
	# 충돌 자리에 퍼지는 룬 마법진
	for r in rings.duplicate():
		var ag: float = (t - float(r.t0)) / 1.0
		if ag >= 1.0:
			(r.mi as Node).queue_free()
			rings.erase(r)
			continue
		var e := 1.0 - pow(1.0 - ag, 3.0)
		(r.mi as MeshInstance3D).scale = Vector3.ONE * lerpf(0.35, 1.5, e)
		(r.mat as ShaderMaterial).set_shader_parameter("power", 1.7 * (1.0 - ag) * (1.0 - ag))
		(r.mi as MeshInstance3D).rotation.y = ag * 1.6


func _impact(m: Dictionary) -> void:
	var to: Vector3 = m.to
	var th: Dictionary = themes[m.theme]
	var cmid: Color = th.mid
	var ccore: Color = th.core
	(m.core as MeshInstance3D).visible = false
	(m.glow as CPUParticles3D).emitting = false
	(m.dust as CPUParticles3D).emitting = false
	(m.tail as MeshInstance3D).visible = false
	(m.helix1 as MeshInstance3D).visible = false
	(m.helix2 as MeshInstance3D).visible = false
	(m.node as Node3D).position = to + Vector3(0, 1.2, 0)
	main.ring_effect(to, cmid.lightened(0.3), 0.5, 13.0, 0.8)
	main.ring_effect(to, ccore, 0.3, 8.0, 0.55)
	main.sparks(to + Vector3(0, 0.5, 0), ccore, 50, 12.0, 1.0)
	main.sparks(to + Vector3(0, 0.5, 0), cmid, 40, 8.0, 1.2)
	main.burst_effect(to + Vector3(0, 1.0, 0), cmid.lightened(0.4))
	var fl := _puff(root, to + Vector3(0, 0.8, 0), 18, 0.8, 2.0, 8.0, 2.6, 5.4, Vector3(0, 1, 0), 75.0, Vector3(0, 1.0, 0), th.ramp)
	fl.one_shot = true
	fl.explosiveness = 0.9
	fl.emitting = true
	var col := _puff(root, to + Vector3(0, 0.2, 0), 28, 0.9, 6.0, 20.0, 0.8, 1.5, Vector3(0, 1, 0), 14.0, Vector3(0, -2.0, 0), th.ramp)   # 솟는 빛의 기둥
	col.one_shot = true
	col.explosiveness = 0.8
	col.emitting = true
	var pet := _puff(root, to + Vector3(0, 0.4, 0), 34, 1.8, 3.0, 9.0, 0.35, 0.8, Vector3(0, 1, 0), 55.0, Vector3(0, -1.4, 0), th.ramp)   # 꽃잎처럼 흩날리는 빛
	pet.one_shot = true
	pet.explosiveness = 0.85
	pet.emitting = true
	# 땅 위로 번지는 룬 마법진
	var rq := _circle_quad(Vector2(16.0, 16.0), cmid, ccore)
	rq.rotation_degrees.x = -90.0
	rq.position = to + Vector3(0, 0.1, 0)
	root.add_child(rq)
	rings.append({"mi": rq, "mat": rq.material_override, "t0": t})
	main.shake = maxf(main.shake, 0.55)
	main.white_flash = maxf(main.white_flash, 0.1)
	Sfx.play("star_hit", 0.8, 0.15)
	for u in _live_enemies():
		if Vector2(u.position.x - to.x, u.position.z - to.z).length() <= BLAST_R:
			_kill(u)


func _kill(u: Unit) -> void:
	if not is_instance_valid(u) or u.dead:
		return
	u.take_damage(DAMAGE, null, true)
	killed += 1
	var pos := u.position + Vector3(0, 1.0, 0)
	main.sparks(pos, Color(1.0, 0.93, 0.6), 36 if not u.is_boss else 120, 9.0, 0.9)
	var mo := _puff(root, pos, 26 if not u.is_boss else 70, 1.5, 1.0, 5.0, 0.25, 0.6, Vector3(0, 1, 0), 60.0, Vector3(0, 2.0, 0), gold_ramp)
	mo.one_shot = true
	mo.explosiveness = 0.9
	mo.emitting = true


# ---------------- 번개 ----------------
func _bolt(ground: Vector3, life: float) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = ArrayMesh.new()
	mi.material_override = bolt_mat
	mi.extra_cull_margin = 300.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	var pts := PackedVector3Array()
	var rad := PackedFloat32Array()
	var top := Vector3(ground.x + rng.randf_range(-6.0, 6.0), SKY_Y, ground.z + rng.randf_range(-3.0, 3.0))
	pts.resize(RIB_N + 6)
	rad.resize(RIB_N + 6)
	var n := pts.size()
	for i in n:
		var s := float(i) / float(n - 1)   # 0 땅 → 1 하늘
		var p := ground.lerp(top, s)
		var amp := 2.4 * sin(PI * s) + 0.4
		pts[i] = p + Vector3(rng.randf_range(-amp, amp), 0.0, rng.randf_range(-amp, amp) * 0.4)
		rad[i] = 0.28 * (0.4 + 0.6 * sin(PI * s)) + 0.04
	pts[0] = ground
	_build_ribbon(mi.mesh as ArrayMesh, pts, rad)
	bolts.append({"mi": mi, "t0": t, "life": life, "ground": ground})
	main.sparks(ground + Vector3(0, 0.5, 0), Color(0.85, 0.92, 1.0), 30, 10.0, 0.6)


func _update_bolts() -> void:
	for b in bolts.duplicate():
		var age: float = t - float(b.t0)
		var mi: MeshInstance3D = b.mi
		if age >= float(b.life):
			mi.queue_free()
			bolts.erase(b)
			continue
		mi.visible = fposmod(age * 24.0, 1.0) > 0.25   # 깜빡이는 번개


# ---------------- 빛기둥 ----------------
func _start_pillar() -> void:
	Sfx.duck = 0.25
	main.white_flash = 1.0
	main.shake = maxf(main.shake, 2.0)
	var c := Vector3(FIELD_X, 0.0, 0.0)
	pillar_in_mat = _beam_material(Color(1.0, 1.0, 1.0), Color(0.85, 0.92, 1.0), 1.7, 120.0)
	pillar_out_mat = _beam_material(Color(0.95, 0.95, 1.0), Color(0.3, 0.45, 1.0), 1.1, 120.0)
	pillar_in = _cyl(pillar_in_mat)
	pillar_out = _cyl(pillar_out_mat)
	root.add_child(pillar_in)
	root.add_child(pillar_out)
	# 바닥에 깔리는 거대한 마법진
	pillar_ring = _circle_quad(Vector2(64.0, 64.0), Color(0.45, 0.65, 1.0), Color(1.0, 0.95, 0.75))
	pillar_ring.rotation_degrees.x = -90.0
	pillar_ring.position = c + Vector3(0, 0.12, 0)
	root.add_child(pillar_ring)
	pillar_ring_mat = pillar_ring.material_override
	pillar_light = OmniLight3D.new()
	pillar_light.light_color = Color(0.85, 0.9, 1.0)
	pillar_light.omni_range = 70.0
	pillar_light.light_energy = 0.0
	pillar_light.position = c + Vector3(0, 10.0, 4.0)
	root.add_child(pillar_light)
	for i in 3:
		main.ring_effect(c, Color(0.8, 0.88, 1.0) if i != 1 else Color(1.0, 0.92, 0.6), 1.0, 46.0 - i * 9.0, 1.2 + i * 0.25)
	for i in 8:
		_bolt(Vector3(FIELD_X + rng.randf_range(-34.0, 36.0), 0.0, rng.randf_range(-5.0, 5.0)), 0.5)
	main.sparks(c + Vector3(0, 1.0, 0), Color(1.0, 0.95, 0.75), 160, 22.0, 1.6)
	motes = _puff(root, Vector3(FIELD_X, 1.0, 0.0), 300, 2.2, 0.6, 3.2, 0.14, 0.34, Vector3(0, 1, 0), 30.0, Vector3(0, 1.1, 0), gold_ramp)
	motes.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	motes.emission_box_extents = Vector3(38.0, 0.5, 8.0)
	motes.emitting = true


func _update_pillar() -> void:
	if pillar_in == null:
		return
	var age := t - T_PILLAR
	var slam := clampf(age / 0.22, 0.0, 1.0)
	var life_k := 1.0 - smoothstep(1.6, T_END - T_PILLAR, age)
	var pulse := 1.0 + 0.07 * sin(t * 15.0)
	var c := Vector3(FIELD_X, 0.0, 0.0)
	var h := SKY_Y + 6.0
	_set_cyl(pillar_in, c, lerpf(0.4, 3.6, slam) * pulse * (0.4 + 0.6 * life_k), 0.0, h)
	_set_cyl(pillar_out, c, lerpf(1.0, 9.0, slam) * pulse * (0.5 + 0.5 * life_k), 0.0, h)
	pillar_in_mat.set_shader_parameter("fade", life_k)
	pillar_out_mat.set_shader_parameter("fade", life_k * 0.85)
	pillar_ring_mat.set_shader_parameter("power", (1.6 * slam + 0.4 * sin(t * 6.0)) * life_k)
	pillar_ring.rotation.y = t * 0.3
	pillar_light.light_energy = 9.0 * life_k * (0.9 + 0.1 * sin(t * 12.0))
	main.shake = maxf(main.shake, 0.5 * life_k if age < 1.8 else 0.0)


# ---------------- 화면 연출 값과 카메라 ----------------
func _update_overlay() -> void:
	ov.bars = clampf(t / 0.55, 0.0, 1.0) * (1.0 - clampf((t - (DUR - 1.0)) / 0.8, 0.0, 1.0))
	ov.title = smoothstep(T_RAISE, T_RAISE + 0.35, t) * (1.0 - smoothstep(T_OPEN + 0.6, T_OPEN + 1.3, t))
	var heat := 0.3 * smoothstep(T_RAISE, T_OPEN, t)
	heat += 0.2 * smoothstep(T_PILLAR - 0.2, T_PILLAR + 0.2, t) * (1.0 - smoothstep(T_PILLAR + 0.6, T_END, t))
	ov.heat = heat * (1.0 - smoothstep(T_END, DUR, t))
	ov.skip = smoothstep(0.8, 1.3, t)


func camera() -> Array:
	var c := FIELD_X
	var keys := [
		[0.0, hp + Vector3(3.8, 4.0, 7.0), hp + Vector3(0.0, 2.3, 0.0)],
		[T_RAISE, hp + Vector3(2.8, 3.5, 5.6), hp + Vector3(0.0, 3.2, 0.0)],
		[T_OPEN, hp + Vector3(10.0, 5.0, 22.0), hp + Vector3(1.0, 24.0, 0.0)],
		[T_RAIN + 0.6, Vector3(hp.x + 14.0, 6.5, 28.0), Vector3(hp.x + 12.0, 12.0, 0.0)],
		[T_RAIN_END, Vector3(c + 22.0, 9.5, 34.0), Vector3(c + 2.0, 8.0, 0.0)],
		[T_PILLAR + 0.15, Vector3(c - 6.0, 3.0, 29.0), Vector3(c, 15.0, 0.0)],
		[T_PILLAR + 2.4, Vector3(c - 18.0, 2.4, 34.0), Vector3(c, 26.0, 0.0)],
		[DUR, hp + Vector3(4.0, 4.0, 14.0), hp + Vector3(2.0, 3.0, 0.0)],
	]
	var tt := minf(t, DUR)
	for i in keys.size() - 1:
		var a: Array = keys[i]
		var b: Array = keys[i + 1]
		if tt <= float(b[0]):
			var k := smoothstep(0.0, 1.0, (tt - float(a[0])) / maxf(float(b[0]) - float(a[0]), 0.001))
			return [(a[1] as Vector3).lerp(b[1], k), (a[2] as Vector3).lerp(b[2], k)]
	return [keys[keys.size() - 1][1], keys[keys.size() - 1][2]]


# ---------------- 끝내기 / 건너뛰기 ----------------
func skip() -> void:
	if done or t < 0.8:
		return
	finish()


func finish() -> void:
	if done:
		return
	done = true
	# 아직 안 쓰러진 적은 모두 정화한다 (건너뛰어도 피해는 똑같이 들어간다)
	for u in _live_enemies():
		_kill(u)
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
	main.judge = null
	main.show_banner("아스트라 유디키움", "별의 심판이 적 %d명을 정화했습니다" % killed, 2.4)
	queue_free()
