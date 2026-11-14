extends Node3D
## 빛과 어둠의 마법 전쟁 — 전장, 스테이지, 인트로, 웨이브, 영웅 조작, 효과를 관리한다.

const ARENA_X := 33.0
const ARENA_Z := 14.0
const PORTAL := Vector3(31, 0, 0)
const CRYSTAL_POS := Vector3(-29, 0, 0)
const GOLD := {"minion": 4, "warrior": 10, "dark_mage": 8, "rogue": 9,
	"boss_general": 200, "boss_lich": 250, "boss_rogue": 300, "boss_golem": 350, "boss": 500}
const BOSS_ROTATION := ["boss_general", "boss_lich", "boss_rogue", "boss_golem", "boss"]
const HERO_SPEED := 9.0
const DASH_CD := 2.0

const ENVS := {
	"day": {"top": Color(0.22, 0.42, 0.78), "hor": Color(0.72, 0.76, 0.84), "sun": Color(1.0, 0.95, 0.85), "sun_e": 1.45,
		"amb": Color(0.6, 0.63, 0.72), "ground": Color(0.24, 0.4, 0.18), "path": Color(0.45, 0.37, 0.26), "leaf": Color(0.2, 0.45, 0.2),
		"fog": Color(0.72, 0.78, 0.88), "fog_d": 0.002, "fx": "leaves"},
	"night": {"top": Color(0.02, 0.03, 0.1), "hor": Color(0.14, 0.2, 0.36), "sun": Color(0.62, 0.72, 1.0), "sun_e": 0.95,
		"amb": Color(0.36, 0.44, 0.68), "ground": Color(0.12, 0.22, 0.16), "path": Color(0.3, 0.28, 0.26), "leaf": Color(0.1, 0.26, 0.2),
		"fog": Color(0.14, 0.2, 0.35), "fog_d": 0.006, "fx": "fireflies"},
	"fire": {"top": Color(0.22, 0.07, 0.05), "hor": Color(0.92, 0.42, 0.16), "sun": Color(1.0, 0.62, 0.35), "sun_e": 1.35,
		"amb": Color(0.62, 0.42, 0.36), "ground": Color(0.3, 0.23, 0.13), "path": Color(0.4, 0.27, 0.16), "leaf": Color(0.32, 0.16, 0.08),
		"fog": Color(0.62, 0.3, 0.14), "fog_d": 0.005, "fx": "embers"},
	"ice": {"top": Color(0.38, 0.55, 0.78), "hor": Color(0.86, 0.9, 0.96), "sun": Color(0.92, 0.96, 1.0), "sun_e": 1.25,
		"amb": Color(0.66, 0.73, 0.86), "ground": Color(0.76, 0.82, 0.9), "path": Color(0.55, 0.68, 0.8), "leaf": Color(0.58, 0.72, 0.78),
		"fog": Color(0.82, 0.87, 0.96), "fog_d": 0.006, "fx": "snow"},
	"dark": {"top": Color(0.08, 0.04, 0.13), "hor": Color(0.38, 0.22, 0.44), "sun": Color(0.92, 0.72, 1.0), "sun_e": 1.05,
		"amb": Color(0.46, 0.38, 0.62), "ground": Color(0.18, 0.2, 0.16), "path": Color(0.33, 0.27, 0.27), "leaf": Color(0.26, 0.18, 0.3),
		"fog": Color(0.3, 0.18, 0.36), "fog_d": 0.0035, "fx": "ash"},
}

var KINDS := {}
var scenes := {}
var units: Array = []
var projs: Array = []
var floaters: Array = []
var effects: Array = []
var meteors: Array = []
var intro_units: Array = []
var hero: Unit
var crystal: Unit
var boss: Unit = null
var cam: Camera3D
var sun: DirectionalLight3D
var hud
var menu
var units_root: Node3D
var flash_mat: StandardMaterial3D
var elite_mat: StandardMaterial3D
var proj_mesh: SphereMesh
var proj_mats := {}
var spark_mesh: QuadMesh

var stage: Dictionary
var stage_idx := 0
var endless := false
var state := "title"   # intro / title / play / win / lose
var paused := false
var t := 0.0
var intro_t := 0.0
var wave := 0
var max_wave := 3
var spawn_queue: Array = []
var spawn_t := 0.0
var next_wave_t := -1.0
var banner := ""
var banner_sub := ""
var banner_t := 0.0
var kills := 0
var earned := 0
var stars_got := 0
var first_clear := false
var cds := {"attack": 0.0, "dash": 0.0}
var cd_max := {"attack": 0.3, "dash": DASH_CD}
var move_input := Vector2.ZERO
var touch_attack := false
var shake := 0.0
var shield_bubble: MeshInstance3D
var end_t := 0.0
var dash_t := 0.0
var dash_dir := Vector3.ZERO
var cam_focus: Unit = null
var cam_focus_t := 0.0
var slowmo_until := 0
var white_flash := 0.0


func _ready() -> void:
	randomize()
	stage = Save.stage(Save.current_stage)
	endless = stage.id == "endless"
	max_wave = stage.waves
	for i in Save.STAGES.size():
		if Save.STAGES[i].id == stage.id:
			stage_idx = i
	for n in ["Mage", "Knight", "Rogue", "Skeleton_Minion", "Skeleton_Warrior", "Skeleton_Mage", "Skeleton_Rogue"]:
		scenes[n] = load("res://models/%s.glb" % n)
	for n in ["Skeleton_Blade", "Skeleton_Staff", "Skeleton_Shield_Small_A", "Skeleton_Axe"]:
		scenes[n] = load("res://models/weapons/%s.gltf" % n)

	flash_mat = _overlay(Color(1, 1, 1, 0.55))
	elite_mat = _overlay(Color(1.0, 0.75, 0.15, 0.3))
	var hero_mat := _overlay(Color(1.0, 0.85, 0.4, 0.12))

	var sk_r := [["Skeleton_Blade", "handslot.r"]]
	KINDS = {
		"hero": {"name": "대마법사", "model": "Mage", "team": 0, "hp": 420.0, "speed": HERO_SPEED, "range": 15.0, "dmg": 24.0, "cd": 0.3,
			"ranged": true, "scale": 1.15, "hide": ["Spellbook", "Spellbook_open", "1H_Wand"], "overlay": hero_mat},
		"ally_mage": {"name": "견습 마법사", "model": "Mage", "team": 0, "hp": 80.0, "speed": 4.4, "range": 10.0, "aggro": 15.0, "dmg": 11.0, "cd": 1.6,
			"ranged": true, "scale": 0.9, "hide": ["Spellbook_open", "2H_Staff", "Spellbook"], "attack": "1H_Ranged_Shoot"},
		"archer": {"name": "빛의 궁수", "model": "Rogue", "team": 0, "hp": 90.0, "speed": 4.6, "range": 12.0, "aggro": 16.0, "dmg": 12.0, "cd": 1.3,
			"ranged": true, "hide": ["Knife_Offhand", "2H_Crossbow", "Knife", "Throwable"], "attack": "1H_Ranged_Shoot"},
		"knight": {"name": "빛의 기사", "model": "Knight", "team": 0, "hp": 170.0, "speed": 4.8, "range": 0.6, "aggro": 16.0, "dmg": 15.0, "cd": 1.1,
			"hide": ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"]},
		"minion": {"name": "해골 병사", "model": "Skeleton_Minion", "team": 1, "hp": 50.0, "speed": 3.3, "range": 0.5, "aggro": 9.0, "dmg": 8.0, "cd": 1.2,
			"weapons": sk_r, "idle": "Idle_Combat"},
		"warrior": {"name": "해골 전사", "model": "Skeleton_Warrior", "team": 1, "hp": 130.0, "speed": 2.7, "range": 0.6, "aggro": 9.0, "dmg": 14.0, "cd": 1.4,
			"scale": 1.1, "weapons": [["Skeleton_Axe", "handslot.r"], ["Skeleton_Shield_Small_A", "handslot.l"]], "idle": "Idle_Combat", "run": "Walking_A"},
		"dark_mage": {"name": "망령 술사", "model": "Skeleton_Mage", "team": 1, "hp": 65.0, "speed": 3.0, "range": 9.0, "aggro": 12.0, "dmg": 10.0, "cd": 2.0,
			"ranged": true, "weapons": [["Skeleton_Staff", "handslot.r"]], "idle": "Idle_Combat"},
		"rogue": {"name": "해골 암살자", "model": "Skeleton_Rogue", "team": 1, "hp": 60.0, "speed": 4.8, "range": 0.5, "aggro": 12.0, "dmg": 11.0, "cd": 0.9,
			"weapons": [["Skeleton_Blade", "handslot.r"], ["Skeleton_Blade", "handslot.l"]], "idle": "Idle_Combat", "attack": "Dualwield_Melee_Attack_Chop"},
		"boss_general": {"name": "해골 장군 그림클로", "model": "Skeleton_Warrior", "team": 1, "hp": 900.0, "speed": 2.6, "range": 1.0, "aggro": 16.0, "dmg": 30.0, "cd": 1.6,
			"scale": 2.0, "boss": true, "weapons": [["Skeleton_Axe", "handslot.r"], ["Skeleton_Shield_Small_A", "handslot.l"]], "overlay": _overlay(Color(0.9, 0.2, 0.15, 0.28)),
			"idle": "Idle_Combat", "run": "Walking_A"},
		"boss_lich": {"name": "망령왕 베일", "model": "Skeleton_Mage", "team": 1, "hp": 1100.0, "speed": 2.2, "range": 12.0, "aggro": 16.0, "dmg": 20.0, "cd": 1.3,
			"ranged": true, "scale": 2.0, "boss": true, "weapons": [["Skeleton_Staff", "handslot.r"]], "overlay": _overlay(Color(0.2, 0.8, 0.9, 0.3)),
			"idle": "Idle_Combat", "run": "Walking_A"},
		"boss_rogue": {"name": "그림자 암살자 녹스", "model": "Skeleton_Rogue", "team": 1, "hp": 1200.0, "speed": 4.4, "range": 0.8, "aggro": 18.0, "dmg": 26.0, "cd": 0.8,
			"scale": 1.9, "boss": true, "weapons": [["Skeleton_Blade", "handslot.r"], ["Skeleton_Blade", "handslot.l"]], "overlay": _overlay(Color(0.25, 0.0, 0.1, 0.45)),
			"idle": "Idle_Combat", "attack": "Dualwield_Melee_Attack_Chop", "special_cd": 5.0},
		"boss_golem": {"name": "서리 거인 하임", "model": "Skeleton_Warrior", "team": 1, "hp": 2200.0, "speed": 1.9, "range": 1.4, "aggro": 16.0, "dmg": 45.0, "cd": 2.0,
			"scale": 2.7, "radius": 0.7, "boss": true, "weapons": [["Skeleton_Axe", "handslot.r"]], "overlay": _overlay(Color(0.6, 0.85, 1.0, 0.4)),
			"idle": "Idle_Combat", "run": "Walking_A"},
		"boss": {"name": "어둠의 군주 모르가스", "model": "Skeleton_Mage", "team": 1, "hp": 2600.0, "speed": 2.0, "range": 11.0, "aggro": 16.0, "dmg": 24.0, "cd": 1.5,
			"ranged": true, "scale": 2.2, "boss": true, "weapons": [["Skeleton_Staff", "handslot.r"]], "overlay": _overlay(Color(0.55, 0.1, 0.8, 0.35)),
			"idle": "Idle_Combat", "run": "Walking_A", "attack": "Spellcast_Shoot"},
		"crystal": {"name": "빛의 수정", "team": 0, "hp": 900.0},
	}

	proj_mesh = SphereMesh.new()
	proj_mesh.radius = 0.22
	proj_mesh.height = 0.44
	proj_mesh.radial_segments = 10
	proj_mesh.rings = 6
	for k in [["light", Color(1.0, 0.85, 0.4)], ["ally", Color(0.55, 0.9, 1.0)], ["arrow", Color(0.7, 1.0, 0.6)], ["dark", Color(0.75, 0.3, 1.0)]]:
		var pm := StandardMaterial3D.new()
		pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		pm.albedo_color = k[1]
		proj_mats[k[0]] = pm
	spark_mesh = QuadMesh.new()
	spark_mesh.size = Vector2(0.25, 0.25)
	var spm := StandardMaterial3D.new()
	spm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	spm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	spm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	spm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	spm.vertex_color_use_as_albedo = true
	var gt := GradientTexture2D.new()
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	gt.width = 64
	gt.height = 64
	var gg := Gradient.new()
	gg.set_color(0, Color(1, 1, 1, 1))
	gg.set_color(1, Color(1, 1, 1, 0))
	gg.add_point(0.35, Color(1, 1, 1, 0.75))
	gt.gradient = gg
	spm.albedo_texture = gt
	spark_mesh.material = spm

	_build_world()
	units_root = Node3D.new()
	add_child(units_root)

	crystal = spawn_unit("crystal", CRYSTAL_POS)
	hero = spawn_unit("hero", Vector3(-20, 0, 0))
	hero.is_hero = true
	hero.anim_speed = 1.4
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
		_ally("knight", Vector3(-15, 0, -6 + i * 4), Vector3(3.5, 0, -4.5 + i * 3.0))
	for i in 2:
		_ally("ally_mage", Vector3(-22, 0, -4 + i * 8), Vector3(-2.5, 0, -5.0 + i * 10.0))
	for i in 2:
		_ally("archer", Vector3(-21, 0, -1.5 + i * 3), Vector3(-2.0, 0, -1.8 + i * 3.6))

	shield_bubble = MeshInstance3D.new()
	var sb := SphereMesh.new()
	sb.radius = 1.6
	sb.height = 3.2
	shield_bubble.mesh = sb
	var sbm := _overlay(Color(0.5, 0.9, 1.0, 0.25))
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
	ring.material_override = _overlay(Color(1.0, 0.85, 0.4, 1.0))
	ring.position.y = 0.05
	ring.scale = Vector3(1, 0.15, 1)
	hero.add_child(ring)

	cam = Camera3D.new()
	cam.fov = 55
	cam.far = 220
	add_child(cam)
	cam.current = true

	var layer := CanvasLayer.new()
	add_child(layer)
	hud = load("res://hud.gd").new()
	hud.main = self
	layer.add_child(hud)
	menu = load("res://menu.gd").new()
	menu.main = self
	layer.add_child(menu)

	if Save.next_action == "start":
		Save.next_action = ""
		begin_battle()
	elif Save.next_action != "":
		state = "title"
		menu.open_page(Save.next_action)
		Save.next_action = ""
		Sfx.music("music_title")
	elif not Save.intro_seen:
		begin_intro()
	else:
		state = "title"
		Sfx.music("music_title")
	_update_camera(1.0, true)


func _overlay(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = c
	return m


func _ally(kind: String, pos: Vector3, off: Vector3) -> Unit:
	var u := spawn_unit(kind, pos)
	u.home = pos
	u.form_off = off
	u.face(Vector3(1, 0, 0), true)
	return u


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


func _box(pos: Vector3, size: Vector3, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	add_child(mi)
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
	_cyl(pos + Vector3(0, h + 0.2, 0), 1.9, 1.9, 0.4, wall)
	_cyl(pos + Vector3(0, h + 1.6, 0), 0.0, 2.1, 2.8, roof)


func _torch(pos: Vector3, col: Color) -> void:
	_cyl(pos + Vector3(0, 1.0, 0), 0.08, 0.1, 2.0, _mat(Color(0.3, 0.2, 0.12)), 6)
	var f := _cyl(pos + Vector3(0, 2.15, 0), 0.0, 0.18, 0.4, _mat(col, 0.5, 3.0), 6)
	f.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var l := OmniLight3D.new()
	l.light_color = col
	l.light_energy = 1.4
	l.omni_range = 7.0
	l.position = pos + Vector3(0, 2.3, 0)
	add_child(l)
	var p := _particles(pos + Vector3(0, 2.3, 0), col, 12, 0.6, 0.2, Vector3(0, 1.2, 0), false)
	p.emission_sphere_radius = 0.08
	p.scale_amount_min = 0.5
	p.scale_amount_max = 0.9


func _build_world() -> void:
	var E: Dictionary = ENVS[stage.env]
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = E.top
	sm.sky_horizon_color = E.hor
	sm.ground_horizon_color = E.hor.darkened(0.3)
	sm.ground_bottom_color = E.top.darkened(0.5)
	sky.sky_material = sm
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = E.amb
	e.ambient_light_energy = 0.6
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.fog_enabled = true
	e.fog_light_color = E.fog
	e.fog_density = E.fog_d
	e.glow_enabled = true
	e.glow_intensity = 0.5
	e.glow_hdr_threshold = 1.1
	env.environment = e
	add_child(env)

	sun = DirectionalLight3D.new()
	sun.light_color = E.sun
	sun.light_energy = E.sun_e
	sun.rotation_degrees = Vector3(-52, -35, 0)
	sun.shadow_enabled = Save.settings.shadows
	sun.directional_shadow_max_distance = 55.0
	add_child(sun)

	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(140, 80)
	ground.mesh = pm
	ground.material_override = _mat(E.ground)
	add_child(ground)
	var path := MeshInstance3D.new()
	var pp := PlaneMesh.new()
	pp.size = Vector2(66, 9)
	path.mesh = pp
	path.material_override = _mat(E.path)
	path.position = Vector3(0, 0.02, 0)
	add_child(path)
	var blight := MeshInstance3D.new()
	var bp := PlaneMesh.new()
	bp.size = Vector2(34, 80)
	blight.mesh = bp
	blight.material_override = _mat(E.ground.lerp(Color(0.2, 0.17, 0.24), 0.7))
	blight.position = Vector3(46, 0.01, 0)
	add_child(blight)

	# 빛의 성
	var stone := _mat(Color(0.8, 0.78, 0.74))
	var blue_roof := _mat(Color(0.2, 0.35, 0.78))
	_box(Vector3(-39, 3, 0), Vector3(3, 6, 34), stone)
	for z in range(-16, 17, 2):
		_box(Vector3(-37.8, 6.4, z), Vector3(0.8, 0.8, 0.9), stone)
	for z in [-15.0, -6.0, 6.0, 15.0]:
		_tower(Vector3(-39, 0, z), 9.0, stone, blue_roof)
	_box(Vector3(-37, 4.5, 0), Vector3(1, 5, 6), _mat(Color(0.35, 0.25, 0.15)))
	for z in [-3.2, 3.2]:
		_box(Vector3(-36.5, 7.5, z), Vector3(0.1, 2.5, 1.2), _mat(Color(0.95, 0.8, 0.3), 0.6, 0.4))
	for z in [-4.5, 4.5]:
		_torch(Vector3(-34, 0, z), Color(1.0, 0.7, 0.3))

	# 어둠의 요새
	var dark := _mat(Color(0.2, 0.18, 0.24))
	var dark_roof := _mat(Color(0.35, 0.1, 0.4))
	_box(Vector3(39, 3.5, 0), Vector3(3, 7, 34), dark)
	for z in [-15.0, -7.0, 7.0, 15.0]:
		_tower(Vector3(39, 0, z), 11.0, dark, dark_roof)
	for z in [-5.0, 5.0]:
		_torch(Vector3(32, 0, z), Color(0.7, 0.3, 1.0))
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
	core.material_override = _overlay(Color(0.4, 0.05, 0.6, 0.7))
	core.position = Vector3(35, 3.3, 0)
	core.rotation_degrees = Vector3(0, 0, 90)
	add_child(core)
	var pl := OmniLight3D.new()
	pl.light_color = Color(0.7, 0.3, 1.0)
	pl.light_energy = 3.0
	pl.omni_range = 14.0
	pl.position = Vector3(33, 3, 0)
	add_child(pl)
	var pp2 := _particles(Vector3(34.6, 3.3, 0), Color(0.75, 0.35, 1.0), 60, 1.4, 2.6, Vector3(-1.5, 0, 0), false)
	pp2.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	pp2.emission_ring_axis = Vector3(1, 0, 0)
	pp2.emission_ring_radius = 2.8
	pp2.emission_ring_inner_radius = 2.4
	pp2.emission_ring_height = 0.1

	# 나무·바위
	var trunk := _mat(Color(0.38, 0.26, 0.16))
	var leaf := _mat(E.leaf)
	var dead_leaf := _mat(Color(0.26, 0.18, 0.28))
	var rock := _mat(Color(0.5, 0.5, 0.53) if stage.env != "ice" else Color(0.7, 0.8, 0.88))
	var rng := RandomNumberGenerator.new()
	rng.seed = 7 + stage_idx
	for i in 56:
		var x := rng.randf_range(-38, 38)
		# 카메라 쪽(+z)은 화면을 가리지 않게 멀리, 반대쪽(-z)은 배경으로 촘촘히
		var z := rng.randf_range(27, 36) if rng.randf() < 0.3 else -rng.randf_range(17, 32)
		var s := rng.randf_range(0.8, 1.6)
		_cyl(Vector3(x, 1.0 * s, z), 0.25 * s, 0.35 * s, 2.0 * s, trunk, 6)
		_cyl(Vector3(x, 3.0 * s, z), 0.0, 1.7 * s, 2.6 * s, dead_leaf if x > 22 else leaf, 8)
		_cyl(Vector3(x, 4.4 * s, z), 0.0, 1.2 * s, 2.0 * s, dead_leaf if x > 22 else leaf, 8)
	for i in 22:
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
	if stage.env == "fire":
		for i in 10:
			var p := Vector3(rng.randf_range(-25, 28), 0, rng.randf_range(11, 16) * (1 if rng.randf() < 0.5 else -1))
			var f := _particles(p, Color(1.0, 0.5, 0.15), 24, 1.0, 0.4, Vector3(0, 2.5, 0), false)
			f.scale_amount_min = 1.5
			f.scale_amount_max = 3.0

	# 날씨/분위기 입자
	var fx := _particles(Vector3(0, 6, 0), Color.WHITE, 160, 6.0, 0.0, Vector3.ZERO, false)
	fx.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	fx.emission_box_extents = Vector3(42, 6, 22)
	match E.fx:
		"leaves":
			fx.color = Color(0.9, 1.0, 0.6, 0.6)
			fx.gravity = Vector3(0.3, -0.4, 0)
			fx.amount = 70
		"fireflies":
			fx.color = Color(0.8, 1.0, 0.5, 0.9)
			fx.gravity = Vector3(0, 0.05, 0)
			fx.initial_velocity_max = 0.6
			fx.position.y = 2.5
			fx.emission_box_extents = Vector3(42, 2, 22)
		"embers":
			fx.color = Color(1.0, 0.55, 0.2, 0.9)
			fx.gravity = Vector3(0.5, 0.8, 0)
		"snow":
			fx.color = Color(1, 1, 1, 0.9)
			fx.gravity = Vector3(0.2, -1.2, 0)
			fx.amount = 260
		"ash":
			fx.color = Color(0.75, 0.55, 0.9, 0.7)
			fx.gravity = Vector3(-0.2, 0.3, 0)


func _particles(pos: Vector3, col: Color, amount: int, life: float, spd: float, grav: Vector3, one_shot := true) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = spark_mesh
	p.amount = maxi(1, amount)
	p.lifetime = life
	p.one_shot = one_shot
	p.explosiveness = 0.95 if one_shot else 0.0
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.3
	p.direction = Vector3(0, 1, 0)
	p.spread = 180.0
	p.initial_velocity_min = spd * 0.4
	p.initial_velocity_max = spd
	p.gravity = grav
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.4
	var g := Gradient.new()
	g.set_color(0, col)
	g.set_color(1, Color(col, 0.0))
	p.color_ramp = g
	p.position = pos
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	p.emitting = true
	if one_shot:
		get_tree().create_timer(life + 0.3, false).timeout.connect(p.queue_free)
	return p


func sparks(pos: Vector3, col: Color, amount := 16, spd := 5.0, life := 0.5) -> void:
	_particles(pos, col, amount, life, spd, Vector3(0, -6, 0))


# ---------------- 유닛 ----------------
func spawn_unit(kind: String, pos: Vector3) -> Unit:
	var u := Unit.new()
	units_root.add_child(u)
	u.setup(self, kind, KINDS[kind])
	u.position = pos
	units.append(u)
	if kind in ["knight", "ally_mage", "archer"]:
		var k: float = 1.0 + 0.15 * Save.up.knight
		u.max_hp *= k
		u.hp = u.max_hp
		u.power = k
	elif u.team == 1:
		var m := enemy_mult()
		u.max_hp *= m
		u.hp = u.max_hp
		u.dmg *= 1.0 + (m - 1.0) * 0.6
	return u


func enemy_mult() -> float:
	if endless:
		return 1.0 + 0.16 * maxi(0, wave - 1)
	return stage.mult


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
		Save.stats.kills += 1
		if u.elite:
			Save.stats.elites += 1
		if u.is_boss:
			Save.stats.bosses += 1
		sparks(u.position + Vector3(0, 1, 0), Color(0.85, 0.7, 1.0), 14 if not u.is_boss else 60, 4.0 if not u.is_boss else 9.0, 0.7)
		if state == "play" and GOLD.has(u.kind):
			var g: int = GOLD[u.kind] * (3 if u.elite else 1)
			earned += g
			Save.gold += g
			add_floater(u.position + Vector3(0, u.bar_h + 0.6, 0), "+%dG" % g, Color(1.0, 0.82, 0.3))
			Sfx.play("coin", 0.5)
	if u == boss and state == "play" and not endless:
		_victory()
	elif u == boss and endless:
		boss = null
		show_banner("보스 격파!", "+%d 골드" % GOLD[u.kind], 2.5)
		_slowmo(900)
	elif (u == hero or u == crystal) and state == "play":
		state = "lose"
		end_t = 0.0
		touch_attack = false
		show_banner("패배", "대마법사가 쓰러졌습니다" if u == hero else "빛의 수정이 파괴되었습니다", 99.0)
		if endless:
			Save.endless_best = maxi(Save.endless_best, wave)
			banner_sub = "끝없는 밤 웨이브 %d 도달 (최고 %d)" % [wave, Save.endless_best]
		Save.save_data()
		Sfx.music("")
		Sfx.play("lose")
		for o in units:
			if o.team == 1 and not o.dead:
				o.play_once("Cheer", 99.0)


func _victory() -> void:
	state = "win"
	end_t = 0.0
	touch_attack = false
	var ratio: float = crystal.hp / crystal.max_hp
	stars_got = 3 if ratio >= 0.9 else (2 if ratio >= 0.5 else 1)
	var prev := int(Save.stars.get(stage.id, 0))
	first_clear = prev == 0
	Save.stars[stage.id] = maxi(prev, stars_got)
	var bonus: int = 100 + (stage.reward if first_clear else 0)
	earned += bonus
	Save.gold += bonus
	Save.save_data()
	show_banner("승리!", "%s 클리어" % stage.name, 99.0)
	_slowmo(1400)
	white_flash = 0.8
	Sfx.music("")
	Sfx.play("win")
	for o in units:
		if o.team == 1 and not o.dead:
			o.die()
		elif o.team == 0 and not o.dead:
			o.play_once("Cheer", 99.0)
	for i in 6:
		sparks(hero.position + Vector3(randf_range(-6, 6), 3, randf_range(-4, 4)), [Color(1, 0.85, 0.3), Color(0.5, 0.9, 1.0)][i % 2], 30, 8.0, 1.2)


func on_boss_enrage(b: Unit) -> void:
	show_banner("%s 분노!" % b.display_name, "공격이 더 빠르고 강해집니다", 2.2)
	Sfx.play("boss", 0.8)
	ring_effect(b.position, Color(1.0, 0.2, 0.3), 0.5, 9.0, 0.8)
	sparks(b.position + Vector3(0, 2, 0), Color(1.0, 0.3, 0.3), 50, 8.0, 0.8)
	shake = 0.8


func show_banner(a: String, b: String, dur := 2.6) -> void:
	banner = a
	banner_sub = b
	banner_t = dur


func add_floater(pos: Vector3, txt: String, col: Color, sz := 1.0) -> void:
	floaters.append({"pos": pos + Vector3(randf() - 0.5, 0, 0), "text": txt, "t": 0.9, "col": col, "sz": sz})


func _slowmo(ms: int) -> void:
	slowmo_until = Time.get_ticks_msec() + ms


# ---------------- 인트로 ----------------
## 카메라 키프레임: [시간, 카메라 위치, 바라보는 곳]
const INTRO_KEYS := [
	[0.0, Vector3(26, 3.2, 7.5), Vector3(34.5, 2.6, 0)],
	[3.2, Vector3(23, 4.5, 11), Vector3(29, 1.5, 0)],
	[6.6, Vector3(10, 6, 14), Vector3(2, 1.5, 0)],
	[9.3, Vector3(-7, 3.2, 14), Vector3(-7, 1.8, 0)],
	[10.3, Vector3(-7.2, 4.2, 11.0), Vector3(-7.2, 3.0, 0)],
	[10.9, Vector3(-7.5, 4.6, 9.4), Vector3(-7.5, 3.6, 0)],
	[12.3, Vector3(-7, 4.0, 12.5), Vector3(-7, 2.2, 0)],
	[15.5, Vector3(-9, 7, 14), Vector3(-18, 1.5, 0)],
]
const INTRO_LEN := 16.0
const PORTAL_EXIT := Vector3(34.4, 0, 0)
const CROUCH_T := 9.55     # 도약 준비 (웅크리기)
const LEAP_T := 10.0       # 발을 떼는 순간
const FLY_T := 0.72        # 도약 → 충돌까지 비행 시간
const CLASH_T := LEAP_T + FLY_T
const HITSTOP := 0.14      # 충돌 순간 멈춤
const GRAV := 24.0
const INTRO_BOSS_SCALE := 1.5
const HERO_INTRO := Vector3(-11, 0, 0)
const BOSS_INTRO := Vector3(-3, 0, 0)
const CLASH_POS := Vector3(-7.75, 4.25, 0.3)
const HERO_PEAK := Vector3(-9.0, 2.6, 0)
const BOSS_PEAK := Vector3(-5.7, 2.0, 0)

var intro_boss: Unit = null
var jumpers := {}   # Unit -> 점프 상태


func begin_intro() -> void:
	state = "intro"
	intro_t = 0.0
	jumpers.clear()
	Sfx.music("music_title")
	Sfx.play("whoosh", 0.7)
	# 아군: 대마법사가 군단의 맨 앞에 선다
	hero.position = HERO_INTRO
	hero.face(Vector3(1, 0, 0), true)
	hero.scripted = true
	# 적 군단: 포탈에서 한 명씩 걸어 나와 대열을 갖춘다 (맨 앞은 어둠의 군주)
	intro_boss = spawn_unit("boss", PORTAL_EXIT)
	intro_boss.run_anim = "Running_A"
	intro_boss.model.scale = Vector3.ONE * INTRO_BOSS_SCALE
	intro_boss.radius = 0.55 * INTRO_BOSS_SCALE
	_intro_slot(intro_boss, BOSS_INTRO.x, 0.0, 0.9)
	var kinds := ["warrior", "minion", "rogue", "minion", "dark_mage"]
	for i in 18:
		var row := i / 6
		var u := spawn_unit(kinds[(i + row) % kinds.size()], PORTAL_EXIT + Vector3(0, 0, randf_range(-1.4, 1.4)))
		_intro_slot(u, BOSS_INTRO.x + 3.2 + row * 2.4 + randf() * 0.6, -6.25 + (i % 6) * 2.5, 1.7 + i * 0.19)
	for u in intro_units:
		u.scripted = true
		u.visible = false
		u.face(Vector3(-1, 0, 0), true)
		u.loop_anim(u.run_anim)


func _intro_slot(u: Unit, stop_x: float, slot_z: float, emerge: float) -> void:
	u.set_meta("stop_x", stop_x)
	u.set_meta("slot_z", slot_z)
	u.set_meta("emerge", emerge)
	u.set_meta("base_scale", u.model.scale)
	intro_units.append(u)


func _start_jump(u: Unit, peak: Vector3) -> void:
	## 비행 시간 FLY_T 뒤에 peak에 닿도록 초속도를 계산 (실제 포물선)
	var v := Vector3((peak.x - u.position.x) / FLY_T, (peak.y + 0.5 * GRAV * FLY_T * FLY_T) / FLY_T, (peak.z - u.position.z) / FLY_T)
	jumpers[u] = {"v": v, "phase": "air", "sq": 1.25, "lean": 0.0, "lean_to": 0.22, "land_t": 0.0}


func _update_jumper(u: Unit, st: Dictionary, delta: float, frozen: bool) -> void:
	var base: Vector3 = u.get_meta("base_scale")
	if not frozen:
		match st.phase:
			"air":
				st.v.y -= GRAV * delta
				u.position += st.v * delta
				if u.position.y <= 0.0 and st.v.y < 0.0:
					# 착지: 발이 닿는 순간 무릎을 굽히며 찌그러지고, 남은 속도로 미끄러진다
					u.position.y = 0.0
					st.phase = "skid"
					st.sq = 0.72
					st.lean_to = 0.0
					st.v.y = 0.0
					u.play_once("Jump_Land", 0.6)
					Sfx.play("hit", 0.9)
					shake = maxf(shake, 0.45)
					sparks(u.position + Vector3(0, 0.15, 0), Color(0.78, 0.72, 0.6), 30, 4.5, 0.7)
					ring_effect(u.position, Color(0.85, 0.8, 0.7), 0.3, 2.6, 0.5)
			"skid":
				var hv := Vector3(st.v.x, 0, st.v.z)
				var sp := maxf(0.0, hv.length() - 14.0 * delta)
				st.v = hv.normalized() * sp if sp > 0.0 else Vector3.ZERO
				u.position += st.v * delta
				if sp > 0.5 and randf() < 0.5:
					sparks(u.position + Vector3(0, 0.1, 0), Color(0.78, 0.72, 0.6), 3, 1.5, 0.4)
				st.land_t += delta
				if sp <= 0.0 and st.land_t > 0.55:
					st.phase = "done"
					u.loop_anim(u.idle_anim)
	# 찌그러짐/늘어남은 스프링처럼 1로 돌아온다 (부피 유지)
	st.sq = lerpf(st.sq, 1.0, minf(1.0, delta * (7.0 if st.phase == "air" else 9.0)))
	var sx := 1.0 / sqrt(st.sq)
	u.model.scale = Vector3(base.x * sx, base.y * st.sq, base.z * sx)
	st.lean = lerpf(st.lean, st.lean_to, minf(1.0, delta * 8.0))
	u.model.rotation.x = st.lean


func _update_intro(delta: float) -> void:
	var prev := intro_t
	intro_t += delta
	var it := intro_t
	var crossed := func(at: float) -> bool: return prev < at and it >= at
	# 1) 포탈에서 등장 → 진격 → 아군 앞에서 정지
	for u in intro_units:
		if jumpers.has(u) or (u == intro_boss and it >= CROUCH_T):
			continue
		var em: float = u.get_meta("emerge")
		if it < em:
			continue
		var base: Vector3 = u.get_meta("base_scale")
		if not u.visible:
			u.visible = true
			sparks(u.position + Vector3(0, 1.5, 0), Color(0.75, 0.35, 1.0), 14, 4.0, 0.5)
			if u == intro_boss:
				ring_effect(u.position, Color(0.75, 0.3, 1.0), 0.5, 5.0, 0.8)
		var grow := clampf((it - em) / 0.35, 0.0, 1.0)
		u.model.scale = base * lerpf(0.35, 1.0, grow)
		var sx: float = u.get_meta("stop_x")
		if u.position.x > sx:
			u.position.x = maxf(sx, u.position.x - 7.0 * delta)
			var dz: float = float(u.get_meta("slot_z")) - u.position.z
			u.position.z += clampf(dz, -2.2 * delta, 2.2 * delta)
			u.loop_anim(u.run_anim)
		elif u.cur_anim == u.run_anim:
			u.position.z = u.get_meta("slot_z")
			u.loop_anim(u.idle_anim)
	if crossed.call(0.9):
		Sfx.play("summon", 0.6)
	if crossed.call(3.4):
		Sfx.play("boss", 0.9)
	if crossed.call(8.2):
		hero.play_once("Spellcast_Raise", 1.0)
		sparks(hero.position + Vector3(0.4, 2.6, 0), Color(1, 0.85, 0.4), 40, 6.0, 1.0)
		Sfx.play("summon", 0.7)
	if not hero.has_meta("base_scale"):
		hero.set_meta("base_scale", hero.model.scale)
	# 2) 도약 준비: 웅크리며 힘을 모은다
	if crossed.call(CROUCH_T):
		for u in [hero, intro_boss]:
			u.position.y = 0.0
			u.play_once("Jump_Start", 0.5)
			jumpers[u] = {"v": Vector3.ZERO, "phase": "crouch", "sq": 1.0, "lean": 0.0, "lean_to": 0.12, "land_t": 0.0}
		sparks(hero.position + Vector3(0, 0.2, 0), Color(1, 0.85, 0.4), 12, 2.0, 0.6)
		sparks(intro_boss.position + Vector3(0, 0.2, 0), Color(0.7, 0.3, 1.0), 12, 2.0, 0.6)
	if it >= CROUCH_T and it < LEAP_T:
		for u in [hero, intro_boss]:
			jumpers[u].sq = lerpf(1.0, 0.82, clampf((it - CROUCH_T) / (LEAP_T - CROUCH_T), 0, 1))
	# 3) 발을 떼고 실제 포물선으로 날아오른다
	if crossed.call(LEAP_T):
		_start_jump(hero, HERO_PEAK)
		_start_jump(intro_boss, BOSS_PEAK)
		hero.play_once("Jump_Idle", 0.5)
		intro_boss.play_once("Jump_Idle", 0.5)
		Sfx.play("dash")
		Sfx.play("whoosh", 0.6)
		for u in [hero, intro_boss]:
			sparks(u.position + Vector3(0, 0.15, 0), Color(0.78, 0.72, 0.6), 24, 4.0, 0.6)
			ring_effect(u.position, Color(0.85, 0.8, 0.7), 0.3, 2.2, 0.4)
	if crossed.call(CLASH_T - 0.36):
		hero.play_once("2H_Melee_Attack_Chop", 0.9, 1.6)
		intro_boss.play_once("2H_Melee_Attack_Chop", 0.9, 1.6)
		_slowmo(950)
	# 4) 공중에서 무기 충돌 → 짧게 멈췄다가 서로 튕겨 나간다
	if crossed.call(CLASH_T):
		hero.position = HERO_PEAK
		intro_boss.position = BOSS_PEAK
		Sfx.play("impact")
		Sfx.play("explode", 0.8)
		white_flash = 0.55
		shake = 1.0
		sparks(CLASH_POS, Color(1.0, 0.85, 0.4), 90, 14.0, 1.0)
		sparks(CLASH_POS, Color(0.75, 0.3, 1.0), 90, 14.0, 1.0)
		burst_effect(CLASH_POS, Color(1, 1, 0.9))
		ring_effect(Vector3(CLASH_POS.x, 0, 0), Color(1.0, 0.85, 0.4), 0.5, 14.0, 1.0)
		ring_effect(Vector3(CLASH_POS.x, 0, 0), Color(0.75, 0.3, 1.0), 0.5, 10.0, 1.2)
		for u in [hero, intro_boss]:
			if u.anim:
				u.anim.speed_scale = 0.05
	var frozen := it >= CLASH_T and it < CLASH_T + HITSTOP
	if crossed.call(CLASH_T + HITSTOP):
		jumpers[hero].v = Vector3(-6.5, 4.5, 0)
		jumpers[intro_boss].v = Vector3(5.5, 4.0, 0)
		for u in [hero, intro_boss]:
			if u.anim:
				u.anim.speed_scale = 1.0
			u.play_once("Hit_A", 0.5)
			jumpers[u].lean_to = -0.35
			jumpers[u].sq = 1.15
	for u in jumpers:
		var st: Dictionary = jumpers[u]
		if st.phase == "crouch":
			_update_jumper(u, st, delta, true)
		else:
			_update_jumper(u, st, delta, frozen)
	if intro_t >= INTRO_LEN:
		end_intro()


func end_intro() -> void:
	if state != "intro":
		return
	Save.intro_seen = true
	for u in intro_units:
		units.erase(u)
		u.queue_free()
	intro_units.clear()
	intro_boss = null
	hero.scripted = false
	if hero.has_meta("base_scale"):
		hero.model.scale = hero.get_meta("base_scale")
	hero.model.rotation.x = 0.0
	if hero.anim:
		hero.anim.speed_scale = 1.0
	jumpers.clear()
	hero.position = Vector3(-20, 0, 0)
	hero.face(Vector3(1, 0, 0), true)
	hero.lock_t = 0.0
	hero.cur_anim = ""
	hero.loop_anim("Idle")
	slowmo_until = 0
	state = "title"
	white_flash = maxf(white_flash, 0.5)
	Sfx.music("music_title")


func _intro_cam() -> Array:
	var keys := INTRO_KEYS
	for i in range(keys.size() - 1):
		var a: Array = keys[i]
		var b: Array = keys[i + 1]
		if intro_t <= b[0]:
			var k := smoothstep(0.0, 1.0, (intro_t - a[0]) / (b[0] - a[0]))
			return [a[1].lerp(b[1], k), a[2].lerp(b[2], k)]
	return [keys[-1][1], keys[-1][2]]


# ---------------- 게임 흐름 ----------------
func start_game(stage_id := "") -> void:
	if stage_id != "":
		Save.current_stage = stage_id
		Save.save_data()
	Save.next_action = "start"
	Engine.time_scale = 1.0
	get_tree().reload_current_scene()


func go_title(page := "") -> void:
	Save.next_action = page if page != "" else "title"
	Engine.time_scale = 1.0
	get_tree().reload_current_scene()


func begin_battle() -> void:
	state = "play"
	next_wave_t = 1.2
	Save.stats.games += 1
	Sfx.music("music_battle")
	show_banner(stage.name, stage.sub, 3.0)


func _wave_plan(w: int) -> Array:
	var q: Array = []
	var si := 4 if endless else stage_idx
	for i in 3 + w * 2:
		q.append("minion")
	for i in w:
		q.append("warrior")
	if si >= 1 or w >= 2:
		for i in (w + 1) / 2:
			q.append("dark_mage")
	if si >= 2 or (endless and w >= 3):
		for i in maxi(1, w / 2):
			q.append("rogue")
	q.shuffle()
	return q


func start_wave() -> void:
	wave += 1
	spawn_queue = _wave_plan(wave)
	var boss_kind := ""
	if endless:
		if wave % 5 == 0:
			boss_kind = BOSS_ROTATION[(wave / 5 - 1) % BOSS_ROTATION.size()]
	elif wave == max_wave:
		boss_kind = stage.boss
	if boss_kind != "":
		spawn_queue.insert(mini(3, spawn_queue.size()), boss_kind)
		show_banner("최종 웨이브" if not endless else "보스 웨이브 %d" % wave, "%s 이(가) 다가옵니다" % KINDS[boss_kind].name, 3.0)
	elif endless:
		show_banner("웨이브 %d" % wave, "적이 점점 강해집니다 (x%.2f)" % enemy_mult(), 2.4)
	else:
		show_banner("웨이브 %d / %d" % [wave, max_wave], "어둠의 군단이 몰려옵니다", 2.4)
	Sfx.play("wave", 0.8)
	spawn_t = 0.5


func reinforce() -> void:
	for i in 2:
		_ally("knight", Vector3(-27, 0, -3 + i * 6), Vector3(randf_range(2.0, 5.0), 0, randf_range(-6.0, 6.0)))
	_ally("archer" if wave % 2 == 0 else "ally_mage", Vector3(-28, 0, 0), Vector3(randf_range(-4.0, -2.0), 0, randf_range(-5.0, 5.0)))
	hero.heal(hero.max_hp * 0.35)
	crystal.heal(120)
	show_banner("증원군 도착", "기사 2명, 원거리 부대 1명 합류 · 체력 회복", 2.4)
	Sfx.play("levelup", 0.6)


func _process(delta: float) -> void:
	# 시간 배율: 치트 속도 × 슬로모션
	var ts := float(Save.cheats.speed) if state == "play" else 1.0
	if Time.get_ticks_msec() < slowmo_until:
		ts *= 0.3
	if paused:
		ts = 1.0
	Engine.time_scale = ts
	delta = minf(delta, 0.05 * ts)
	t += delta
	white_flash = maxf(0.0, white_flash - delta * 1.5)
	if paused:
		units_root.process_mode = Node.PROCESS_MODE_DISABLED
		return
	units_root.process_mode = Node.PROCESS_MODE_INHERIT
	banner_t -= delta
	for k in cds:
		cds[k] = 0.0 if Save.cheats.no_cd else maxf(0.0, cds[k] - delta)
	shake = maxf(0.0, shake - delta * 3.0)
	cam_focus_t -= delta
	var active := state == "play"
	if state == "intro":
		_update_intro(delta)
	elif active:
		_update_hero(delta)
		_update_waves(delta)
	elif state == "win" or state == "lose":
		end_t += delta
		hero.loop_anim("Idle")
	elif state == "title":
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
			sparks(u.position + Vector3(0, 1.5, 0), Color(0.7, 0.3, 1.0), 14, 4.0, 0.5)
			var elite_p: float = stage.elite + (0.01 * wave if endless else 0.0)
			if not u.is_boss and randf() < elite_p:
				u.make_elite()
			if u.is_boss:
				boss = u
				cam_focus = u
				cam_focus_t = 2.4
				_slowmo(1600)
				Sfx.play("boss")
				Sfx.music("music_boss")
				ring_effect(u.position, Color(0.8, 0.3, 1.0), 0.5, 10.0, 1.0)
			spawn_t = maxf(0.4, 1.2 - wave * 0.1)
		return
	if not endless and wave >= max_wave:
		return
	for u in units:
		if u.team == 1 and not u.dead:
			return
	next_wave_t = 3.5
	var bonus := 20 * wave
	earned += bonus
	Save.gold += bonus
	Save.save_data()
	if endless:
		Save.endless_best = maxi(Save.endless_best, wave)
	if boss != null and endless:
		Sfx.music("music_battle")
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
	if dash_t > 0.0:
		dash_t -= delta
		hero.position += dash_dir * 42.0 * delta
		if randf() < 0.8:
			sparks(hero.position + Vector3(0, 1.2, 0), Color(1, 0.85, 0.4), 4, 1.0, 0.4)
	else:
		hero.position += mv * hero.speed * delta
	hero.position.x = clampf(hero.position.x, -ARENA_X + 6, ARENA_X)
	hero.position.z = clampf(hero.position.z, -ARENA_Z, ARENA_Z)
	if v.length() > 0.1:
		hero.face(mv)
		hero.loop_anim("Running_A")
	else:
		hero.loop_anim("Idle")
	hero.heal(delta * 4.0)
	shield_bubble.visible = hero.shield_t > 0.35
	if (touch_attack or Input.is_physical_key_pressed(KEY_SPACE) or Input.is_physical_key_pressed(KEY_J)) and cds.attack <= 0.0:
		hero_attack()


func dash() -> void:
	if state != "play" or hero.dead or cds.dash > 0.0 or paused:
		return
	cds.dash = cd_max.dash
	var v := move_input
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT): v.x -= 1
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT): v.x += 1
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP): v.y -= 1
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN): v.y += 1
	dash_dir = Vector3(v.x, 0, v.y).normalized() if v.length() > 0.1 else hero.forward()
	dash_t = 0.17
	hero.shield_t = maxf(hero.shield_t, 0.3)
	hero.face(dash_dir, true)
	Sfx.play("dash")
	sparks(hero.position + Vector3(0, 1, 0), Color(1, 0.9, 0.5), 20, 5.0, 0.4)


func hero_attack() -> void:
	cds.attack = cd_max.attack
	var tg := nearest_enemy(hero, hero.attack_range)
	var dir := hero.forward()
	if tg:
		dir = tg.position - hero.position
		dir.y = 0
		hero.face(dir, true)
	hero.play_once("Spellcast_Shoot", 0.18, 2.0)
	var crit := randf() < 0.15
	spawn_proj(hero, tg, hero.dmg * (0.9 + randf() * 0.2) * (2.0 if crit else 1.0), hero.position + Vector3(0, 1.5, 0) + dir.normalized() * 0.7, dir, crit)
	Sfx.play("cast", 0.45, 0.15)


func use_slot(i: int) -> void:
	if i < Save.equipped.size():
		use_skill(Save.equipped[i])


func use_skill(s: String) -> void:
	if state != "play" or paused or hero.dead or not cds.has(s) or cds[s] > 0.0 or Save.skills.get(s, 0) <= 0:
		return
	cds[s] = cd_max[s]
	var v := Save.sv(s, Save.skills[s])
	var pw: float = 1.0 + 0.15 * Save.up.power
	match s:
		"shield":
			hero.shield_t = v.dur
			hero.play_once("Block", 0.5)
			Sfx.play("shield")
			sparks(hero.position + Vector3(0, 1.4, 0), Color(0.5, 0.9, 1.0), 30, 5.0, 0.6)
		"nova":
			hero.play_once("Spellcast_Long", 0.45, 1.6)
			ring_effect(hero.position, Color(1.0, 0.85, 0.4), 0.5, v.rad, 0.5)
			sparks(hero.position + Vector3(0, 1, 0), Color(1.0, 0.85, 0.4), 70, 12.0, 0.7)
			_shake(0.6)
			Sfx.play("nova")
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(hero.position) < v.rad:
					u.take_damage(v.dmg * pw)
					var away: Vector3 = u.position - hero.position
					away.y = 0
					u.knock = away.normalized() * (4.0 if u.is_boss else 14.0)
		"summon":
			hero.play_once("Spellcast_Raise", 0.6)
			Sfx.play("summon")
			for i in v.count:
				var p := hero.position + Vector3(1.5, 0, -1.8 * (v.count - 1) / 2.0 + i * 1.8)
				_ally("knight", p, Vector3(randf_range(1.5, 4.5), 0, randf_range(-5.0, 5.0)))
				ring_effect(p, Color(0.55, 0.9, 1.0), 0.3, 2.5, 0.6)
				sparks(p + Vector3(0, 1, 0), Color(0.55, 0.9, 1.0), 24, 4.0, 0.7)
		"chain":
			hero.play_once("Spellcast_Shoot", 0.3, 1.6)
			Sfx.play("chain")
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
				best.take_damage(v.dmg * pw)
				hit_list.append(best)
				cur = best
				from = to
			if hit_list.is_empty():
				cds[s] = 0.5
		"frost":
			hero.play_once("Spellcast_Long", 0.45, 1.6)
			Sfx.play("frost")
			ring_effect(hero.position, Color(0.6, 0.9, 1.0), 0.5, v.rad, 0.8)
			var fp := _particles(hero.position + Vector3(0, 1, 0), Color(0.8, 0.95, 1.0), 90, 1.0, 10.0, Vector3(0, -2, 0))
			fp.direction = Vector3(1, 0.2, 0)
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(hero.position) < v.rad:
					u.take_damage(v.dmg * pw)
					u.slow_t = v.dur
		"heal":
			hero.play_once("Spellcast_Raise", 0.6)
			Sfx.play("heal")
			hero.heal(hero.max_hp * v.hero)
			add_floater(hero.position + Vector3(0, hero.bar_h, 0), "+%d" % int(hero.max_hp * v.hero), Color(0.5, 1.0, 0.6), 1.3)
			ring_effect(hero.position, Color(0.5, 1.0, 0.6), 0.5, 10.0, 0.7)
			_particles(hero.position + Vector3(0, 0.5, 0), Color(0.6, 1.0, 0.6), 50, 1.2, 2.0, Vector3(0, 3, 0))
			for u in units:
				if u.team == 0 and not u.dead and u != hero:
					u.heal(u.max_hp * v.ally)
		"meteor":
			hero.play_once("Spellcast_Raise", 0.6)
			_shake(0.3)
			var targets: Array = units.filter(func(u): return u.team == 1 and not u.dead and u.position.distance_to(hero.position) < 22.0)
			for i in v.count:
				var p: Vector3
				if not targets.is_empty():
					p = targets[i % targets.size()].position + Vector3(randf_range(-1, 1), 0, randf_range(-1, 1))
				else:
					p = hero.position + Vector3(randf_range(3, 12), 0, randf_range(-6, 6))
				spawn_meteor(p, v.dmg * pw, i * 0.18)


func use_item(id: String) -> bool:
	if state != "play" or paused or hero.dead or Save.items.get(id, 0) <= 0:
		return false
	match id:
		"potion_hp":
			if hero.hp >= hero.max_hp:
				return false
			hero.heal(hero.max_hp * 0.5)
			ring_effect(hero.position, Color(0.5, 1.0, 0.6), 0.3, 3.0, 0.5)
		"potion_mana":
			for k in cds:
				cds[k] = 0.0
			ring_effect(hero.position, Color(0.6, 0.5, 1.0), 0.3, 3.0, 0.5)
		"potion_crystal":
			if crystal.hp >= crystal.max_hp:
				return false
			crystal.heal(crystal.max_hp * 0.4)
			ring_effect(crystal.position, Color(0.5, 0.9, 1.0), 0.5, 4.0, 0.6)
	Save.items[id] -= 1
	Save.save_data()
	Sfx.play("heal", 0.7)
	return true


func cheat_battle(id: String) -> String:
	if state != "play":
		return "전투 중에만 쓸 수 있습니다"
	match id:
		"kill_all":
			for u in units:
				if u.team == 1 and not u.dead:
					u.take_damage(u.hp + 1)
			spawn_queue.clear()
		"next_wave":
			for u in units:
				if u.team == 1 and not u.dead and not u.is_boss:
					u.die()
			spawn_queue.clear()
			if not endless and wave >= max_wave:
				return "이미 마지막 웨이브입니다"
			next_wave_t = 0.1
		"boss":
			if boss != null and not boss.dead:
				return "보스가 이미 있습니다"
			spawn_queue.push_front(stage.boss if not endless else BOSS_ROTATION[0])
			spawn_t = 0.0
			if next_wave_t >= 0.0:
				next_wave_t = -1.0
		"heal":
			hero.hp = hero.max_hp
			crystal.hp = crystal.max_hp
	return "적용 완료"


func _shake(v: float) -> void:
	if Save.settings.shake:
		shake = maxf(shake, v)


func beam_effect(a: Vector3, b: Vector3, col: Color) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	var ln := a.distance_to(b)
	bm.size = Vector3(0.14, 0.14, ln)
	mi.mesh = bm
	var m := _overlay(col)
	mi.material_override = m
	add_child(mi)
	mi.position = (a + b) / 2.0
	if ln > 0.01:
		mi.look_at(b, Vector3.UP)
	effects.append({"node": mi, "mat": m, "t": 0.0, "dur": 0.35, "s0": 1.0, "s1": 1.0, "a0": 1.0})
	sparks(b, col, 12, 4.0, 0.4)


func spawn_meteor(p: Vector3, d: float, delay: float) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.6
	sm.height = 1.2
	sm.radial_segments = 10
	sm.rings = 6
	mi.mesh = sm
	mi.material_override = _mat(Color(1.0, 0.55, 0.2), 0.5, 3.0)
	mi.position = p + Vector3(-6, 18, 0)
	mi.visible = false
	add_child(mi)
	var trail := _particles(Vector3.ZERO, Color(1.0, 0.6, 0.2), 30, 0.4, 0.5, Vector3.ZERO, false)
	remove_child(trail)
	mi.add_child(trail)
	meteors.append({"node": mi, "target": p, "t": -delay, "dmg": d, "start": mi.position, "snd": false})


func _update_meteors(delta: float) -> void:
	var keep: Array = []
	for mt in meteors:
		mt.t += delta
		var node: MeshInstance3D = mt.node
		if mt.t < 0.0:
			keep.append(mt)
			continue
		if not mt.snd:
			mt.snd = true
			Sfx.play("meteor", 0.6)
		node.visible = true
		var k: float = mt.t / 0.5
		node.position = mt.start.lerp(mt.target, minf(k, 1.0))
		if k >= 1.0:
			ring_effect(mt.target, Color(1.0, 0.55, 0.2), 0.3, 3.0, 0.4)
			sparks(mt.target + Vector3(0, 0.5, 0), Color(1.0, 0.6, 0.25), 30, 8.0, 0.6)
			_shake(0.25)
			for u in units:
				if u.team == 1 and not u.dead and u.position.distance_to(mt.target) < 2.8:
					u.take_damage(mt.dmg)
			node.queue_free()
		else:
			keep.append(mt)
	meteors = keep


func boss_summon(b: Unit) -> void:
	show_banner("어둠의 소환", "%s 이(가) 부하를 불러냅니다" % b.display_name, 1.8)
	Sfx.play("summon", 0.8, 0.0)
	for i in (5 if b.enraged else 3):
		var p := b.position + Vector3(randf_range(-3, 3), 0, randf_range(-3, 3))
		var u := spawn_unit("dark_mage" if b.enraged and i == 0 else "minion", p)
		ring_effect(p, Color(0.7, 0.3, 1.0), 0.3, 2.5, 0.6)
		u.face(Vector3(-1, 0, 0), true)


func boss_wave(b: Unit) -> void:
	var col := Color(0.7, 0.3, 1.0)
	if b.kind == "boss_golem" or b.kind == "boss_lich":
		col = Color(0.6, 0.9, 1.0)
	elif b.kind == "boss_general" or b.kind == "boss_rogue":
		col = Color(1.0, 0.35, 0.3)
	ring_effect(b.position, col, 0.5, 8.0, 0.7)
	sparks(b.position + Vector3(0, 1, 0), col, 50, 10.0, 0.7)
	Sfx.play("explode", 0.8)
	_shake(0.5)
	if b.kind == "boss_rogue" and hero and not hero.dead:
		# 그림자 도약: 대마법사 근처로 순간이동
		sparks(b.position + Vector3(0, 1.5, 0), Color(0.2, 0, 0.2), 40, 4.0, 0.6)
		b.position = hero.position + Vector3(randf_range(-3, 3), 0, randf_range(-3, 3))
	for u in units:
		if u.team == 0 and not u.dead and u.kind != "crystal" and u.position.distance_to(b.position) < 8.0:
			u.take_damage(35.0 * enemy_mult())
			var away: Vector3 = u.position - b.position
			away.y = 0
			u.knock = away.normalized() * 10.0
			if b.kind == "boss_golem" or b.kind == "boss_lich":
				u.slow_t = 2.0


func ring_effect(pos: Vector3, col: Color, s0: float, s1: float, dur: float) -> void:
	var mi := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.85
	tm.outer_radius = 1.0
	tm.rings = 32
	mi.mesh = tm
	var m := _overlay(col)
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
	var m := _overlay(col)
	mi.material_override = m
	mi.position = pos
	add_child(mi)
	effects.append({"node": mi, "mat": m, "t": 0.0, "dur": 0.25, "s0": 0.4, "s1": 1.6, "a0": 0.8})


func _separate() -> void:
	var n := units.size()
	for i in n:
		var a: Unit = units[i]
		if a.dead or not a.visible:
			continue
		for j in range(i + 1, n):
			var b: Unit = units[j]
			if b.dead or not b.visible:
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
		if not u.is_static and not u.scripted:
			u.position.x = clampf(u.position.x, -ARENA_X - 4, ARENA_X + 3)
			u.position.z = clampf(u.position.z, -ARENA_Z - 1, ARENA_Z + 1)
			u.position.y = 0.0 if not u.dead else u.position.y


# ---------------- 투사체 ----------------
func spawn_proj(src: Unit, tg: Unit, d: float, from: Vector3, dir: Vector3, crit := false) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = proj_mesh
	var key := "dark" if src.team == 1 else ("light" if src.is_hero else ("arrow" if src.kind == "archer" else "ally"))
	mi.material_override = proj_mats[key]
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if src.is_boss:
		mi.scale = Vector3.ONE * 2.2
	elif src.is_hero:
		mi.scale = Vector3.ONE * (1.8 if crit else 1.3)
	elif src.kind == "archer":
		mi.scale = Vector3(0.6, 0.6, 2.2)
	mi.position = from
	add_child(mi)
	dir.y = 0
	projs.append({"node": mi, "team": src.team, "target": tg, "dir": dir.normalized(), "dmg": d, "life": 1.6, "crit": crit,
		"speed": 24.0 if src.is_hero else (20.0 if src.kind == "archer" else 15.0), "col": proj_mats[key].albedo_color})


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
		if p.dir.length_squared() > 0.01:
			node.look_at(node.position + p.dir, Vector3.UP)
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
			hit.take_damage(p.dmg, null, p.crit)
			burst_effect(node.position, p.col)
			sparks(node.position, p.col, 8 if not p.crit else 20, 4.0, 0.35)
			node.queue_free()
		elif p.life <= 0.0 or absf(node.position.x) > 45.0:
			node.queue_free()
		else:
			keep.append(p)
	projs = keep


func _update_camera(delta: float, snap := false) -> void:
	var pos: Vector3
	var look: Vector3
	if state == "intro":
		var r := _intro_cam()
		pos = r[0]
		look = r[1]
		snap = true
	elif state == "title":
		var a := sin(t * 0.12) * 0.55
		look = Vector3(-17, 1.6, 0)
		pos = look + Vector3(sin(a) * 15.0, 6.5, cos(a) * 15.0)
	elif cam_focus_t > 0.0 and cam_focus != null and is_instance_valid(cam_focus):
		look = cam_focus.position + Vector3(0, 2.5, 0)
		pos = look + Vector3(-3, 6, 11)
	else:
		var focus := hero.position
		look = focus + Vector3(0, 0, 0)
		pos = focus + Vector3(0, 13, 15)
	if snap:
		cam.position = pos
	else:
		cam.position = cam.position.lerp(pos, minf(1.0, delta * 5.0))
	if shake > 0.0:
		cam.position += Vector3(randf() - 0.5, randf() - 0.5, 0) * shake
	if state == "play" and cam_focus_t <= 0.0:
		cam.look_at(cam.position + Vector3(0, -13, -15), Vector3.UP)
	else:
		cam.look_at(look, Vector3.UP)


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo:
		if state == "intro":
			end_intro()
			return
		match ev.physical_keycode:
			KEY_Q:
				use_slot(0)
			KEY_E:
				use_slot(1)
			KEY_R:
				use_slot(2)
			KEY_F:
				use_slot(3)
			KEY_SHIFT, KEY_K:
				dash()
			KEY_1:
				use_item("potion_hp")
			KEY_2:
				use_item("potion_mana")
			KEY_3:
				use_item("potion_crystal")
			KEY_ESCAPE, KEY_P:
				if state == "play":
					set_paused(not paused)


func set_paused(p: bool) -> void:
	paused = p
	touch_attack = false
	if menu:
		menu.page = "pause" if p else ""


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED:
		if state == "play" and not paused:
			set_paused(true)
		Save.save_data()
