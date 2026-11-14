extends Node3D
## 빛과 어둠의 마법 전쟁 — 전장, 웨이브, 영웅 조작, 투사체를 관리한다.

const ARENA_X := 33.0
const ARENA_Z := 14.0
const PORTAL := Vector3(31, 0, 0)
const CRYSTAL_POS := Vector3(-29, 0, 0)
const MAX_WAVE := 5
const GOLD := {"minion": 4, "warrior": 10, "dark_mage": 8, "boss": 250}

var KINDS := {}
var scenes := {}
var units: Array = []
var projs: Array = []
var floaters: Array = []
var effects: Array = []
var hero: Unit
var crystal: Unit
var boss: Unit = null
var cam: Camera3D
var hud
var units_root: Node3D
var flash_mat: StandardMaterial3D
var proj_mesh: SphereMesh
var proj_mats := {}

var state := "title"   # title / shop / play / win / lose
var t := 0.0
var wave := 0
var spawn_queue: Array = []
var spawn_t := 0.0
var next_wave_t := -1.0
var banner := ""
var banner_sub := ""
var banner_t := 0.0
var kills := 0
var cds := {"attack": 0.0}
var cd_max := {"attack": 0.3}
var earned := 0
var meteors: Array = []
var move_input := Vector2.ZERO
var touch_attack := false
var shake := 0.0
var shield_bubble: MeshInstance3D
var end_t := 0.0


func _ready() -> void:
	randomize()
	for n in ["Mage", "Knight", "Skeleton_Minion", "Skeleton_Warrior", "Skeleton_Mage"]:
		scenes[n] = load("res://models/%s.glb" % n)
	for n in ["Skeleton_Blade", "Skeleton_Staff", "Skeleton_Shield_Small_A", "Skeleton_Axe"]:
		scenes[n] = load("res://models/weapons/%s.gltf" % n)

	flash_mat = StandardMaterial3D.new()
	flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flash_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	flash_mat.albedo_color = Color(1, 1, 1, 0.55)
	var boss_mat := StandardMaterial3D.new()
	boss_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	boss_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	boss_mat.albedo_color = Color(0.55, 0.1, 0.8, 0.35)
	var hero_mat := StandardMaterial3D.new()
	hero_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hero_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	hero_mat.albedo_color = Color(1.0, 0.85, 0.4, 0.12)

	KINDS = {
		"hero": {"name": "대마법사", "model": "Mage", "team": 0, "hp": 420.0, "speed": 6.2, "range": 15.0, "dmg": 24.0, "cd": 0.3,
			"ranged": true, "scale": 1.15, "hide": ["Spellbook", "Spellbook_open", "1H_Wand"], "overlay": hero_mat},
		"ally_mage": {"name": "견습 마법사", "model": "Mage", "team": 0, "hp": 80.0, "speed": 3.8, "range": 10.0, "aggro": 14.0, "dmg": 11.0, "cd": 1.6,
			"ranged": true, "scale": 0.9, "hide": ["Spellbook_open", "2H_Staff", "Spellbook"], "attack": "1H_Ranged_Shoot"},
		"knight": {"name": "빛의 기사", "model": "Knight", "team": 0, "hp": 170.0, "speed": 4.2, "range": 0.6, "aggro": 16.0, "dmg": 15.0, "cd": 1.1,
			"hide": ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"]},
		"minion": {"name": "해골 병사", "model": "Skeleton_Minion", "team": 1, "hp": 50.0, "speed": 3.3, "range": 0.5, "aggro": 9.0, "dmg": 8.0, "cd": 1.2,
			"weapons": [["Skeleton_Blade", "handslot.r"]], "idle": "Idle_Combat"},
		"warrior": {"name": "해골 전사", "model": "Skeleton_Warrior", "team": 1, "hp": 130.0, "speed": 2.7, "range": 0.6, "aggro": 9.0, "dmg": 14.0, "cd": 1.4,
			"scale": 1.1, "weapons": [["Skeleton_Axe", "handslot.r"], ["Skeleton_Shield_Small_A", "handslot.l"]], "idle": "Idle_Combat", "run": "Walking_A"},
		"dark_mage": {"name": "망령 술사", "model": "Skeleton_Mage", "team": 1, "hp": 65.0, "speed": 3.0, "range": 9.0, "aggro": 12.0, "dmg": 10.0, "cd": 2.0,
			"ranged": true, "weapons": [["Skeleton_Staff", "handslot.r"]], "idle": "Idle_Combat"},
		"boss": {"name": "어둠의 군주 모르가스", "model": "Skeleton_Mage", "team": 1, "hp": 1800.0, "speed": 2.0, "range": 11.0, "aggro": 16.0, "dmg": 22.0, "cd": 1.5,
			"ranged": true, "scale": 2.1, "weapons": [["Skeleton_Staff", "handslot.r"]], "overlay": boss_mat, "idle": "Idle_Combat", "run": "Walking_A", "attack": "Spellcast_Shoot"},
		"crystal": {"name": "빛의 수정", "team": 0, "hp": 900.0},
	}

	proj_mesh = SphereMesh.new()
	proj_mesh.radius = 0.22
	proj_mesh.height = 0.44
	proj_mesh.radial_segments = 10
	proj_mesh.rings = 6
	for k in [["light", Color(1.0, 0.85, 0.4)], ["ally", Color(0.55, 0.9, 1.0)], ["dark", Color(0.75, 0.3, 1.0)]]:
		var pm := StandardMaterial3D.new()
		pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		pm.albedo_color = k[1]
		proj_mats[k[0]] = pm

	_build_world()
	units_root = Node3D.new()
	add_child(units_root)

	crystal = spawn_unit("crystal", CRYSTAL_POS)
	hero = spawn_unit("hero", Vector3(-20, 0, 0))
	hero.is_hero = true
	hero.face(Vector3(1, 0, 0), true)
	hero.max_hp *= 1.0 + 0.15 * Save.up.hp
	hero.hp = hero.max_hp
	hero.dmg *= 1.0 + 0.15 * Save.up.power
	crystal.max_hp *= 1.0 + 0.2 * Save.up.crystal
	crystal.hp = crystal.max_hp
	cd_max.attack = 0.3 / (1.0 + 0.12 * Save.up.speed)
	for id in Save.SKILL_ORDER:
		cds[id] = 0.0
		cd_max[id] = Save.skill_cd(id)
	for i in 4:
		var u := spawn_unit("knight", Vector3(-15, 0, -6 + i * 4))
		u.home = u.position
		u.form_off = Vector3(3.5, 0, -4.5 + i * 3.0)
		u.face(Vector3(1, 0, 0), true)
	for i in 3:
		var u := spawn_unit("ally_mage", Vector3(-21, 0, -6 + i * 6))
		u.home = u.position
		u.form_off = Vector3(-2.5, 0, -4.0 + i * 4.0)
		u.face(Vector3(1, 0, 0), true)

	shield_bubble = MeshInstance3D.new()
	var sb := SphereMesh.new()
	sb.radius = 1.6
	sb.height = 3.2
	shield_bubble.mesh = sb
	var sbm := StandardMaterial3D.new()
	sbm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sbm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sbm.albedo_color = Color(0.5, 0.9, 1.0, 0.25)
	sbm.cull_mode = BaseMaterial3D.CULL_DISABLED
	shield_bubble.material_override = sbm
	shield_bubble.position.y = 1.4
	shield_bubble.visible = false
	hero.add_child(shield_bubble)

	var ring := MeshInstance3D.new()
	var rm := TorusMesh.new()
	rm.inner_radius = 0.75
	rm.outer_radius = 0.95
	ring.mesh = rm
	var ringm := StandardMaterial3D.new()
	ringm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ringm.albedo_color = Color(1.0, 0.85, 0.4)
	ring.material_override = ringm
	ring.position.y = 0.05
	ring.scale = Vector3(1, 0.15, 1)
	hero.add_child(ring)

	cam = Camera3D.new()
	cam.fov = 55
	cam.far = 200
	add_child(cam)
	cam.current = true
	_update_camera(1.0)

	var layer := CanvasLayer.new()
	add_child(layer)
	hud = load("res://hud.gd").new()
	hud.main = self
	layer.add_child(hud)

	if Save.next_action == "start":
		Save.next_action = ""
		begin_battle()
	elif Save.next_action == "shop":
		Save.next_action = ""
		state = "shop"


# ---------------- 전장 만들기 ----------------
func _mat(c: Color, rough := 0.9, emis := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	if emis > 0.0:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = emis
	return m


func _box(pos: Vector3, size: Vector3, m: Material, parent: Node3D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	(parent if parent else self).add_child(mi)
	return mi


func _cyl(pos: Vector3, top: float, bottom: float, h: float, m: Material, seg := 12) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = top
	cm.bottom_radius = bottom
	cm.height = h
	cm.radial_segments = seg
	mi.mesh = cm
	mi.material_override = m
	mi.position = pos
	add_child(mi)
	return mi


func _tower(pos: Vector3, h: float, wall: Material, roof: Material) -> void:
	_cyl(pos + Vector3(0, h / 2, 0), 1.6, 1.8, h, wall)
	_cyl(pos + Vector3(0, h + 1.4, 0), 0.0, 2.1, 2.8, roof)


func _build_world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.12, 0.13, 0.32)
	sm.sky_horizon_color = Color(0.55, 0.5, 0.62)
	sm.ground_horizon_color = Color(0.3, 0.25, 0.35)
	sm.ground_bottom_color = Color(0.1, 0.1, 0.15)
	sky.sky_material = sm
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.55, 0.58, 0.72)
	e.ambient_light_energy = 0.55
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.fog_enabled = true
	e.fog_light_color = Color(0.45, 0.38, 0.55)
	e.fog_density = 0.0025
	e.glow_enabled = true
	e.glow_intensity = 0.4
	e.glow_hdr_threshold = 1.2
	env.environment = e
	add_child(env)

	var sun := DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.86, 0.72)
	sun.light_energy = 1.35
	sun.rotation_degrees = Vector3(-52, -35, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 55.0
	add_child(sun)

	# 땅
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(120, 70)
	ground.mesh = pm
	ground.material_override = _mat(Color(0.2, 0.33, 0.17))
	add_child(ground)
	var path := MeshInstance3D.new()
	var pp := PlaneMesh.new()
	pp.size = Vector2(66, 9)
	path.mesh = pp
	path.material_override = _mat(Color(0.42, 0.34, 0.24))
	path.position = Vector3(0, 0.02, 0)
	add_child(path)
	# 오른쪽 어둠의 땅
	var blight := MeshInstance3D.new()
	var bp := PlaneMesh.new()
	bp.size = Vector2(34, 70)
	blight.mesh = bp
	blight.material_override = _mat(Color(0.22, 0.2, 0.25))
	blight.position = Vector3(43, 0.01, 0)
	add_child(blight)

	# 빛의 성 (왼쪽)
	var stone := _mat(Color(0.78, 0.76, 0.72))
	var blue_roof := _mat(Color(0.2, 0.35, 0.75))
	_box(Vector3(-39, 3, 0), Vector3(3, 6, 34), stone)
	for z in [-15.0, -6.0, 6.0, 15.0]:
		_tower(Vector3(-39, 0, z), 9.0, stone, blue_roof)
	_box(Vector3(-37, 4.5, 0), Vector3(1, 5, 6), _mat(Color(0.35, 0.25, 0.15)))
	for z in [-3.2, 3.2]:
		var flag := _box(Vector3(-36.5, 7.5, z), Vector3(0.1, 2.5, 1.2), _mat(Color(0.95, 0.8, 0.3), 0.6, 0.3))
		flag.name = "Flag"

	# 어둠의 요새 (오른쪽)
	var dark := _mat(Color(0.2, 0.18, 0.24))
	var dark_roof := _mat(Color(0.35, 0.1, 0.4))
	_box(Vector3(39, 3.5, 0), Vector3(3, 7, 34), dark)
	for z in [-15.0, -7.0, 7.0, 15.0]:
		_tower(Vector3(39, 0, z), 11.0, dark, dark_roof)
	# 포탈
	var portal := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 2.6
	tm.outer_radius = 3.2
	tm.rings = 24
	portal.mesh = tm
	portal.material_override = _mat(Color(0.7, 0.25, 1.0), 0.5, 2.5)
	portal.position = Vector3(35, 3.3, 0)
	portal.rotation_degrees = Vector3(0, 0, 90)
	portal.name = "Portal"
	add_child(portal)
	var core := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 2.6
	cm.bottom_radius = 2.6
	cm.height = 0.1
	core.mesh = cm
	var corem := StandardMaterial3D.new()
	corem.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	corem.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	corem.albedo_color = Color(0.4, 0.05, 0.6, 0.7)
	core.material_override = corem
	core.position = Vector3(35, 3.3, 0)
	core.rotation_degrees = Vector3(0, 0, 90)
	add_child(core)
	var pl := OmniLight3D.new()
	pl.light_color = Color(0.7, 0.3, 1.0)
	pl.light_energy = 3.0
	pl.omni_range = 14.0
	pl.position = Vector3(33, 3, 0)
	add_child(pl)

	# 나무와 바위
	var trunk := _mat(Color(0.38, 0.26, 0.16))
	var leaf := _mat(Color(0.2, 0.42, 0.22))
	var dead_leaf := _mat(Color(0.3, 0.22, 0.3))
	var rock := _mat(Color(0.5, 0.5, 0.52))
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 46:
		var x := rng.randf_range(-36, 36)
		var z := rng.randf_range(17, 30) * (1 if rng.randf() < 0.5 else -1)
		var s := rng.randf_range(0.8, 1.5)
		_cyl(Vector3(x, 1.0 * s, z), 0.25 * s, 0.35 * s, 2.0 * s, trunk, 6)
		_cyl(Vector3(x, 3.4 * s, z), 0.0, 1.6 * s, 3.4 * s, dead_leaf if x > 20 else leaf, 8)
	for i in 18:
		var r := MeshInstance3D.new()
		var sp := SphereMesh.new()
		sp.radial_segments = 6
		sp.rings = 3
		var s := rng.randf_range(0.5, 1.4)
		sp.radius = s
		sp.height = s * 1.3
		r.mesh = sp
		r.material_override = rock
		r.position = Vector3(rng.randf_range(-30, 30), 0.2, rng.randf_range(10, 16) * (1 if rng.randf() < 0.5 else -1))
		add_child(r)


# ---------------- 유닛 ----------------
func spawn_unit(kind: String, pos: Vector3) -> Unit:
	var u := Unit.new()
	units_root.add_child(u)
	u.setup(self, kind, KINDS[kind])
	u.position = pos
	units.append(u)
	if kind == "knight" or kind == "ally_mage":
		var k: float = 1.0 + 0.15 * Save.up.knight
		u.max_hp *= k
		u.hp = u.max_hp
		u.power = k
	return u


func nearest_enemy(u: Unit, r: float) -> Unit:
	var best: Unit = null
	var bd := r * r
	for o in units:
		if o.dead or o.team == u.team:
			continue
		var d: float = u.position.distance_squared_to(o.position)
		if d < bd:
			bd = d
			best = o
	return best


func on_death(u: Unit) -> void:
	if u.team == 1:
		kills += 1
		if state == "play" and GOLD.has(u.kind):
			var g: int = GOLD[u.kind]
			earned += g
			Save.gold += g
			add_floater(u.position + Vector3(0, u.bar_h + 0.6, 0), "+%dG" % g, Color(1.0, 0.82, 0.3))
	if u == boss and state == "play":
		state = "win"
		end_t = 0.0
		show_banner("승리!", "어둠의 군주가 쓰러졌습니다", 99.0)
		earned += 150
		Save.gold += 150
		Save.wins += 1
		Save.best_wave = maxi(Save.best_wave, wave)
		Save.save_data()
		for o in units:
			if o.team == 1 and not o.dead:
				o.die()
			elif o.team == 0 and not o.dead:
				o.play_once("Cheer", 99.0)
	elif (u == hero or u == crystal) and state == "play":
		state = "lose"
		end_t = 0.0
		show_banner("패배", "대마법사가 쓰러졌습니다" if u == hero else "빛의 수정이 파괴되었습니다", 99.0)
		Save.best_wave = maxi(Save.best_wave, wave)
		Save.save_data()
		for o in units:
			if o.team == 1 and not o.dead:
				o.play_once("Cheer", 99.0)


func show_banner(a: String, b: String, dur := 2.6) -> void:
	banner = a
	banner_sub = b
	banner_t = dur


func add_floater(pos: Vector3, txt: String, col: Color) -> void:
	floaters.append({"pos": pos + Vector3(randf() - 0.5, 0, 0), "text": txt, "t": 0.9, "col": col})


# ---------------- 게임 흐름 ----------------
func start_game() -> void:
	# 상점에서 산 강화를 반영하려고 항상 씬을 새로 불러온 뒤 전투를 시작한다
	Save.next_action = "start"
	get_tree().reload_current_scene()


func begin_battle() -> void:
	state = "play"
	next_wave_t = 1.0
	show_banner("전투 시작", "빛의 수정을 지키고 어둠의 군주를 쓰러뜨리세요")


func start_wave() -> void:
	wave += 1
	spawn_queue.clear()
	for i in 3 + wave * 2:
		spawn_queue.append("minion")
	for i in wave:
		spawn_queue.append("warrior")
	for i in (wave + 1) / 2:
		spawn_queue.append("dark_mage")
	spawn_queue.shuffle()
	if wave == MAX_WAVE:
		spawn_queue.push_front("boss")
		show_banner("최종 웨이브", "어둠의 군주 모르가스가 나타났습니다!", 3.0)
	else:
		show_banner("웨이브 %d / %d" % [wave, MAX_WAVE], "어둠의 군단이 몰려옵니다", 2.4)
	spawn_t = 0.5


func reinforce() -> void:
	var n := 0
	for i in 2:
		var u := spawn_unit("knight", Vector3(-27, 0, -3 + i * 6))
		u.home = Vector3(-15, 0, -4 + i * 8 + randf() * 2)
		u.form_off = Vector3(randf_range(2.0, 5.0), 0, randf_range(-6.0, 6.0))
		n += 1
	var m := spawn_unit("ally_mage", Vector3(-28, 0, 0))
	m.home = Vector3(-21, 0, randf_range(-6, 6))
	m.form_off = Vector3(randf_range(-4.0, -2.0), 0, randf_range(-5.0, 5.0))
	hero.heal(hero.max_hp * 0.35)
	crystal.heal(120)
	show_banner("증원군 도착", "빛의 기사 2명, 견습 마법사 1명 합류 · 체력 회복", 2.4)


func _process(delta: float) -> void:
	delta = minf(delta, 0.05)
	t += delta
	banner_t -= delta
	for k in cds:
		cds[k] = maxf(0.0, cds[k] - delta)
	shake = maxf(0.0, shake - delta * 3.0)
	var active := state == "play"
	if active:
		_update_hero(delta)
		_update_waves(delta)
	elif state == "win" or state == "lose":
		end_t += delta
		hero.loop_anim("Idle")
	for u in units:
		u.tick(delta, active)
	_separate()
	_update_projs(delta)
	_update_meteors(delta)
	for f in floaters:
		f.t -= delta
		f.pos.y += delta * 1.5
	floaters = floaters.filter(func(f): return f.t > 0)
	for e in effects:
		e.t += delta
		var k: float = e.t / e.dur
		e.node.scale = Vector3.ONE * lerpf(e.s0, e.s1, k)
		e.mat.albedo_color.a = e.a0 * (1.0 - k)
		if k >= 1.0:
			e.node.queue_free()
	effects = effects.filter(func(e): return e.t < e.dur)
	var keep: Array = []
	for u in units:
		if u.dead and u.dead_t > 3.5 and u != hero and u != crystal:
			u.queue_free()
		else:
			keep.append(u)
	units = keep
	var portal := get_node_or_null("Portal")
	if portal:
		portal.rotation.x += delta * 0.8
	_update_camera(delta)


func _update_waves(delta: float) -> void:
	if next_wave_t >= 0.0:
		next_wave_t -= delta
		if next_wave_t < 0.0:
			if wave > 0:
				reinforce()
			start_wave()
		return
	if not spawn_queue.is_empty():
		spawn_t -= delta
		if spawn_t <= 0.0:
			var k: String = spawn_queue.pop_front()
			var u := spawn_unit(k, PORTAL + Vector3(randf() * 2, 0, randf_range(-3, 3)))
			u.face(Vector3(-1, 0, 0), true)
			if k == "boss":
				boss = u
			spawn_t = maxf(0.45, 1.2 - wave * 0.12)
		return
	if wave < MAX_WAVE:
		for u in units:
			if u.team == 1 and not u.dead:
				return
		next_wave_t = 3.5
		var bonus := 20 * wave
		earned += bonus
		Save.gold += bonus
		Save.save_data()
		show_banner("웨이브 %d 방어 성공" % wave, "보너스 +%d 골드 · 잠시 후 다음 웨이브" % bonus, 2.4)


func _update_hero(delta: float) -> void:
	if hero.dead:
		return
	var v := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT): v.x -= 1
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT): v.x += 1
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP): v.y -= 1
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN): v.y += 1
	v += move_input
	if v.length() > 1.0:
		v = v.normalized()
	var mv := Vector3(v.x, 0, v.y)
	hero.position += mv * hero.speed * delta
	hero.position.x = clampf(hero.position.x, -ARENA_X + 6, ARENA_X)
	hero.position.z = clampf(hero.position.z, -ARENA_Z, ARENA_Z)
	if v.length() > 0.1:
		hero.face(mv)
		hero.loop_anim("Running_A")
	else:
		hero.loop_anim("Idle")
	hero.heal(delta * 4.0)
	shield_bubble.visible = hero.shield_t > 0.0
	if (touch_attack or Input.is_physical_key_pressed(KEY_SPACE) or Input.is_physical_key_pressed(KEY_J)) and cds.attack <= 0.0:
		hero_attack()


func hero_attack() -> void:
	cds.attack = cd_max.attack
	var tg := nearest_enemy(hero, hero.attack_range)
	var dir := hero.forward()
	if tg:
		dir = tg.position - hero.position
		dir.y = 0
		hero.face(dir, true)
	hero.play_once("Spellcast_Shoot", 0.22, 1.8)
	spawn_proj(hero, tg, hero.dmg * (0.9 + randf() * 0.2), hero.position + Vector3(0, 1.5, 0) + dir.normalized() * 0.7, dir)


func use_slot(i: int) -> void:
	if i < Save.equipped.size():
		use_skill(Save.equipped[i])


func use_skill(s: String) -> void:
	if state != "play" or hero.dead or not cds.has(s) or cds[s] > 0.0 or Save.skills.get(s, 0) <= 0:
		return
	cds[s] = cd_max[s]
	var v := Save.sv(s, Save.skills[s])
	match s:
		"shield":
			hero.shield_t = v.dur
			hero.play_once("Block", 0.5)
		"nova":
			hero.play_once("Spellcast_Long", 0.45, 1.6)
			ring_effect(hero.position, Color(1.0, 0.85, 0.4), 0.5, v.rad, 0.5)
			shake = 0.6
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(hero.position) < v.rad:
					u.take_damage(v.dmg * (1.0 + 0.15 * Save.up.power))
					var away: Vector3 = u.position - hero.position
					away.y = 0
					u.knock = away.normalized() * (4.0 if u.kind == "boss" else 14.0)
		"summon":
			hero.play_once("Spellcast_Raise", 0.6)
			for i in v.count:
				var p := hero.position + Vector3(1.5, 0, -1.8 * (v.count - 1) / 2.0 + i * 1.8)
				var k := spawn_unit("knight", p)
				k.home = p
				k.form_off = Vector3(randf_range(1.5, 4.5), 0, randf_range(-5.0, 5.0))
				k.face(Vector3(1, 0, 0), true)
				ring_effect(p, Color(0.55, 0.9, 1.0), 0.3, 2.5, 0.6)
		"chain":
			hero.play_once("Spellcast_Shoot", 0.3, 1.6)
			var from := hero.position + Vector3(0, 1.5, 0)
			var hit_list: Array = []
			var cur: Unit = hero
			for j in v.jumps:
				var best: Unit = null
				var bd := 14.0 * 14.0 if j == 0 else 8.0 * 8.0
				for u in units:
					if u.team == 1 and not u.dead and not hit_list.has(u):
						var d: float = cur.position.distance_squared_to(u.position)
						if d < bd:
							bd = d
							best = u
				if best == null:
					break
				var to := best.position + Vector3(0, 1.2, 0)
				beam_effect(from, to, Color(0.7, 0.85, 1.0))
				best.take_damage(v.dmg * (1.0 + 0.15 * Save.up.power))
				hit_list.append(best)
				cur = best
				from = to
			if hit_list.is_empty():
				cds[s] = 0.5
		"frost":
			hero.play_once("Spellcast_Long", 0.45, 1.6)
			ring_effect(hero.position, Color(0.6, 0.9, 1.0), 0.5, v.rad, 0.8)
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(hero.position) < v.rad:
					u.take_damage(v.dmg * (1.0 + 0.15 * Save.up.power))
					u.slow_t = v.dur
					add_floater(u.position + Vector3(0, u.bar_h + 0.5, 0), "둔화", Color(0.6, 0.9, 1.0))
		"heal":
			hero.play_once("Spellcast_Raise", 0.6)
			hero.heal(hero.max_hp * v.hero)
			add_floater(hero.position + Vector3(0, hero.bar_h, 0), "+%d" % int(hero.max_hp * v.hero), Color(0.5, 1.0, 0.6))
			ring_effect(hero.position, Color(0.5, 1.0, 0.6), 0.5, 10.0, 0.7)
			for u in units:
				if u.team == 0 and not u.dead and u != hero:
					u.heal(u.max_hp * v.ally)
		"meteor":
			hero.play_once("Spellcast_Raise", 0.6)
			shake = 0.3
			var targets: Array = units.filter(func(u): return u.team == 1 and not u.dead and u.position.distance_to(hero.position) < 22.0)
			for i in v.count:
				var p: Vector3
				if not targets.is_empty():
					p = targets[i % targets.size()].position + Vector3(randf_range(-1, 1), 0, randf_range(-1, 1))
				else:
					p = hero.position + Vector3(randf_range(3, 12), 0, randf_range(-6, 6))
				spawn_meteor(p, v.dmg * (1.0 + 0.15 * Save.up.power), i * 0.18)


func use_item(id: String) -> void:
	if state != "play" or hero.dead or Save.items.get(id, 0) <= 0:
		return
	match id:
		"potion_hp":
			if hero.hp >= hero.max_hp:
				return
			hero.heal(hero.max_hp * 0.5)
			ring_effect(hero.position, Color(0.5, 1.0, 0.6), 0.3, 3.0, 0.5)
		"potion_mana":
			for k in cds:
				cds[k] = 0.0
			ring_effect(hero.position, Color(0.6, 0.5, 1.0), 0.3, 3.0, 0.5)
		"potion_crystal":
			if crystal.hp >= crystal.max_hp:
				return
			crystal.heal(crystal.max_hp * 0.4)
			ring_effect(crystal.position, Color(0.5, 0.9, 1.0), 0.5, 4.0, 0.6)
	Save.items[id] -= 1
	Save.save_data()


func beam_effect(a: Vector3, b: Vector3, col: Color) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	var ln := a.distance_to(b)
	bm.size = Vector3(0.12, 0.12, ln)
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = col
	mi.material_override = m
	add_child(mi)
	mi.position = (a + b) / 2.0
	if ln > 0.01:
		mi.look_at(b, Vector3.UP)
	effects.append({"node": mi, "mat": m, "t": 0.0, "dur": 0.35, "s0": 1.0, "s1": 1.0, "a0": 1.0})
	burst_effect(b, col)


func spawn_meteor(p: Vector3, d: float, delay: float) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.6
	sm.height = 1.2
	sm.radial_segments = 10
	sm.rings = 6
	mi.mesh = sm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(1.0, 0.55, 0.2)
	mi.material_override = m
	mi.position = p + Vector3(-6, 18, 0)
	mi.visible = false
	add_child(mi)
	meteors.append({"node": mi, "target": p, "t": -delay, "dmg": d, "start": mi.position})


func _update_meteors(delta: float) -> void:
	var keep: Array = []
	for mt in meteors:
		mt.t += delta
		var node: MeshInstance3D = mt.node
		if mt.t < 0.0:
			keep.append(mt)
			continue
		node.visible = true
		var k: float = mt.t / 0.5
		node.position = mt.start.lerp(mt.target, minf(k, 1.0))
		if k >= 1.0:
			ring_effect(mt.target, Color(1.0, 0.55, 0.2), 0.3, 3.0, 0.4)
			burst_effect(mt.target + Vector3(0, 0.5, 0), Color(1.0, 0.6, 0.25))
			shake = maxf(shake, 0.25)
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(mt.target) < 2.8:
					u.take_damage(mt.dmg)
			node.queue_free()
		else:
			keep.append(mt)
	meteors = keep


func boss_summon(b: Unit) -> void:
	show_banner("어둠의 소환", "모르가스가 해골 병사를 불러냅니다", 1.8)
	for i in 3:
		var p := b.position + Vector3(randf_range(-3, 3), 0, randf_range(-3, 3))
		var u := spawn_unit("minion", p)
		ring_effect(p, Color(0.7, 0.3, 1.0), 0.3, 2.5, 0.6)
		u.face(Vector3(-1, 0, 0), true)


func boss_wave(b: Unit) -> void:
	ring_effect(b.position, Color(0.7, 0.3, 1.0), 0.5, 8.0, 0.7)
	shake = 0.5
	for u in units:
		if u.team == 0 and not u.dead and u.kind != "crystal" and u.position.distance_to(b.position) < 8.0:
			u.take_damage(35.0)
			var away: Vector3 = u.position - b.position
			away.y = 0
			u.knock = away.normalized() * 10.0


func ring_effect(pos: Vector3, col: Color, s0: float, s1: float, dur: float) -> void:
	var mi := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.85
	tm.outer_radius = 1.0
	tm.rings = 32
	mi.mesh = tm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = col
	mi.material_override = m
	mi.position = pos + Vector3(0, 0.3, 0)
	add_child(mi)
	effects.append({"node": mi, "mat": m, "t": 0.0, "dur": dur, "s0": s0, "s1": s1, "a0": 0.9})


func burst_effect(pos: Vector3, col: Color) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 10
	sm.rings = 6
	mi.mesh = sm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = col
	mi.material_override = m
	mi.position = pos
	add_child(mi)
	effects.append({"node": mi, "mat": m, "t": 0.0, "dur": 0.25, "s0": 0.4, "s1": 1.6, "a0": 0.8})


func _separate() -> void:
	var n := units.size()
	for i in n:
		var a: Unit = units[i]
		if a.dead:
			continue
		for j in range(i + 1, n):
			var b: Unit = units[j]
			if b.dead:
				continue
			var d: Vector3 = b.position - a.position
			d.y = 0
			var min_d := a.radius + b.radius
			var l := d.length()
			if l < min_d and l > 0.0001:
				var push := d / l * (min_d - l) * 0.5
				if a.is_static:
					b.position += push * 2.0
				elif b.is_static:
					a.position -= push * 2.0
				else:
					a.position -= push
					b.position += push
	for u in units:
		if not u.is_static:
			u.position.x = clampf(u.position.x, -ARENA_X - 4, ARENA_X + 3)
			u.position.z = clampf(u.position.z, -ARENA_Z - 1, ARENA_Z + 1)
			u.position.y = 0.0 if not u.dead else u.position.y


# ---------------- 투사체 ----------------
func spawn_proj(src: Unit, tg: Unit, d: float, from: Vector3, dir: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = proj_mesh
	var key := "dark" if src.team == 1 else ("light" if src.is_hero else "ally")
	mi.material_override = proj_mats[key]
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if src.kind == "boss":
		mi.scale = Vector3.ONE * 2.2
	elif src.is_hero:
		mi.scale = Vector3.ONE * 1.3
	mi.position = from
	add_child(mi)
	dir.y = 0
	projs.append({"node": mi, "team": src.team, "target": tg, "dir": dir.normalized(), "dmg": d, "life": 1.6,
		"speed": 22.0 if src.is_hero else 15.0, "col": proj_mats[key].albedo_color})


func _update_projs(delta: float) -> void:
	var keep: Array = []
	for p in projs:
		var node: MeshInstance3D = p.node
		p.life -= delta
		var tg = p.target
		if tg != null and is_instance_valid(tg) and not tg.dead:
			var aim: Vector3 = tg.position + Vector3(0, 1.0, 0) - node.position
			p.dir = p.dir.lerp(aim.normalized(), minf(1.0, delta * 10.0)).normalized()
		node.position += p.dir * p.speed * delta
		var hit: Unit = null
		for u in units:
			if u.dead or u.team == p.team:
				continue
			var d: Vector3 = u.position - node.position
			d.y = 0
			if d.length() < u.radius + 0.35:
				hit = u
				break
		if hit:
			hit.take_damage(p.dmg)
			burst_effect(node.position, p.col)
			node.queue_free()
		elif p.life <= 0.0 or absf(node.position.x) > 45.0:
			node.queue_free()
		else:
			keep.append(p)
	projs = keep


func _update_camera(delta: float) -> void:
	var focus := hero.position if hero else Vector3.ZERO
	var desired := focus + Vector3(0, 13, 15)
	cam.position = cam.position.lerp(desired, minf(1.0, delta * 5.0))
	if shake > 0.0:
		cam.position += Vector3(randf() - 0.5, randf() - 0.5, 0) * shake
	cam.look_at(cam.position + Vector3(0, -13, -15), Vector3.UP)


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo:
		match ev.physical_keycode:
			KEY_Q:
				use_slot(0)
			KEY_E:
				use_slot(1)
			KEY_R:
				use_slot(2)
			KEY_F:
				use_slot(3)
			KEY_1:
				use_item("potion_hp")
			KEY_2:
				use_item("potion_mana")
			KEY_3:
				use_item("potion_crystal")
			KEY_ENTER:
				if state != "play":
					start_game()
