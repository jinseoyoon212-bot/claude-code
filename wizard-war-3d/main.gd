extends Node3D
## 빛과 어둠의 마법 전쟁 — 전장, 스테이지, 인트로, 웨이브, 영웅 조작, 효과를 관리한다.

const ARENA_X := 33.0
const ARENA_Z := 14.0
const PORTAL := Vector3(31, 0, 0)
const CRYSTAL_POS := Vector3(-29, 0, 0)
const GOLD := {"minion": 4, "warrior": 10, "dark_mage": 8, "rogue": 9,
	"boss_general": 200, "boss_lich": 250, "boss_rogue": 300, "boss_golem": 350, "boss": 500}
const MAX_ALLIES := 5           # 아군 병사(주인공·수정 제외)는 이 수까지만 나온다
const WAVE_MIN := 10          # 웨이브 한 번에 나오는 적의 최소 수
const MAX_CONCURRENT := 10     # 동시에 전장에 있는 적의 수 (보스는 제외하고 이 수가 차면 기다린다)
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

# 스테이지별 하늘·분위기 (사실적 하늘 셰이더용)
const SKYS := {
	"day": {"cover": 0.55, "lit": Color(1.0, 0.97, 0.92), "shade": Color(0.58, 0.64, 0.76), "stars": 0.0, "sun_col": Color(1.0, 0.92, 0.75), "sun_size": 0.0075, "sun_power": 1.0, "ray": Color(1.0, 0.88, 0.6)},
	"night": {"cover": 0.35, "lit": Color(0.42, 0.5, 0.72), "shade": Color(0.06, 0.08, 0.18), "stars": 1.0, "sun_col": Color(0.75, 0.85, 1.0), "sun_size": 0.014, "sun_power": 0.7, "ray": Color(0.55, 0.7, 1.0)},
	"fire": {"cover": 0.75, "lit": Color(1.0, 0.55, 0.25), "shade": Color(0.22, 0.07, 0.05), "stars": 0.0, "sun_col": Color(1.0, 0.55, 0.25), "sun_size": 0.011, "sun_power": 1.2, "ray": Color(1.0, 0.6, 0.3)},
	"ice": {"cover": 0.6, "lit": Color(0.96, 0.98, 1.0), "shade": Color(0.62, 0.72, 0.88), "stars": 0.0, "sun_col": Color(0.92, 0.96, 1.0), "sun_size": 0.007, "sun_power": 0.9, "ray": Color(0.85, 0.92, 1.0)},
	"dark": {"cover": 0.7, "lit": Color(0.72, 0.42, 0.88), "shade": Color(0.1, 0.05, 0.18), "stars": 0.5, "sun_col": Color(0.85, 0.6, 1.0), "sun_size": 0.012, "sun_power": 0.8, "ray": Color(0.7, 0.45, 0.95)},
}
var gfx := 2                     # 그래픽 품질 0 낮음 / 1 보통 / 2 높음 (Save.settings.gfx)
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
var cine_active := false          # 아스트라 유디키움 컷씬 진행 중
var judge: Judge = null
var env_cache := {}
var tint_mats := {}
var clouds: Array = []
var portal_disc: MeshInstance3D
var world_env: Environment


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
	cds["judge"] = 0.0
	cd_max["judge"] = 30.0   # 개발자 전용 스킬 아스트라 유디키움
	for i in 3:   # 시작 병사 5명: 기사 3, 견습 마법사 1, 궁수 1
		_ally("knight", Vector3(-15, 0, -6 + i * 6), Vector3(3.5, 0, -4.5 + i * 4.5))
	_ally("ally_mage", Vector3(-22, 0, -4), Vector3(-2.5, 0, -5.0))
	_ally("archer", Vector3(-21, 0, 3), Vector3(-2.0, 0, 1.8))

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

	if OS.has_feature("web") and not Save.audio_unlocked:
		# 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다: 터치 후 인트로 시작
		state = "gate"
	elif Save.next_action == "start":
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
	_warmup()
	if Save.dev_unlocked:
		Judge.prewarm(self)


func leave_gate() -> void:
	## 첫 터치/클릭/키 입력: 오디오가 켜졌으니 인트로(또는 타이틀)를 시작한다
	if state != "gate":
		return
	Save.audio_unlocked = true
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


func _warmup() -> void:
	## 처음 쓰는 이펙트는 셰이더 컴파일 때문에 순간적으로 멈춰서 소리가 끊긴다.
	## 대기 화면에서 미리 한 번씩 그려 둔다.
	if Save.warmed:
		return
	Save.warmed = true
	var p := Vector3(-17, 1.5, 4)
	sparks(p, Color.WHITE, 3, 1.0, 0.4)
	ring_effect(p, Color.WHITE, 0.3, 0.5, 0.4)
	burst_effect(p, Color.WHITE)
	beam_effect(p, p + Vector3(0.6, 0.2, 0), Color.WHITE)   # 수직이면 look_at이 실패하므로 비스듬히
	spawn_meteor(p + Vector3(0, 0, 0), 0.0, 0.0)


func _overlay(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = c
	return m


func ally_count() -> int:
	## 살아 있는 아군 병사 수 (주인공·수정 제외)
	var c := 0
	for u in units:
		if u.team == 0 and not u.dead and not u.is_hero and u != crystal and not u.scripted:
			c += 1
	return c


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


func _torch(pos: Vector3, col: Color) -> void:
	## 던전 팩의 횃불 모델 + 불빛 + 불꽃 입자
	place("dg/torch_lit.glb", pos + Vector3(0, 0.9, 0), 0.0, 2.2)
	var l := OmniLight3D.new()
	l.light_color = col
	l.light_energy = 1.4
	l.omni_range = 7.0
	l.position = pos + Vector3(0, 2.6, 0)
	add_child(l)
	var p := _particles(pos + Vector3(0, 2.5, 0), col, 12, 0.6, 0.2, Vector3(0, 1.2, 0), false)
	p.emission_sphere_radius = 0.08
	p.scale_amount_min = 0.5
	p.scale_amount_max = 0.9


# ---------------- 무료 3D 모델 배치 도구 ----------------
func env_scene(path: String) -> PackedScene:
	if not env_cache.has(path):
		env_cache[path] = load("res://models/env/%s" % path)
	return env_cache[path]


func _tint_mat(key: String) -> StandardMaterial3D:
	if not tint_mats.has(key):
		var tints := {"dark": Color(0.14, 0.05, 0.22, 0.55), "ice": Color(0.78, 0.9, 1.0, 0.38), "gloom": Color(0.12, 0.05, 0.2, 0.4),
			"fire": Color(1.0, 0.42, 0.1, 0.3), "burn": Color(1.0, 0.36, 0.05, 0.6), "night": Color(0.05, 0.08, 0.28, 0.3)}
		var c: Color = tints[key]
		tint_mats[key] = _overlay(c)
	return tint_mats[key]


func place(path: String, pos: Vector3, rot_deg := 0.0, scl := 1.0, tint := "") -> Node3D:
	## 모델 하나를 월드에 놓는다. tint 를 주면 반투명 색을 덧씌워 분위기를 바꾼다 (얼음/어둠/불꽃).
	var n: Node3D = env_scene(path).instantiate()
	n.position = pos
	n.rotation_degrees.y = rot_deg
	n.scale = Vector3.ONE * scl
	add_child(n)
	if gfx >= 1 and path.begins_with("qn/"):
		_apply_foliage(n, path.get_file().get_basename())
	if tint != "":
		var m := _tint_mat(tint)
		for mi in n.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = m
	return n


func _build_world() -> void:
	var E: Dictionary = ENVS[stage.env]
	gfx = clampi(int(Save.settings.gfx), 0, 2)
	var SK: Dictionary = SKYS[stage.env]
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	if gfx >= 1:
		# 사실적인 하늘: 태양 원반·빛무리, 흘러가는 구름, 밤의 별 (shaders/sky.gdshader)
		var ssm := ShaderMaterial.new()
		ssm.shader = load("res://shaders/sky.gdshader")
		ssm.set_shader_parameter("top_col", Vector3(E.top.r, E.top.g, E.top.b))
		ssm.set_shader_parameter("hor_col", Vector3(E.hor.r, E.hor.g, E.hor.b))
		var lw: Color = E.hor.darkened(0.3)
		ssm.set_shader_parameter("low_col", Vector3(lw.r, lw.g, lw.b))
		ssm.set_shader_parameter("sun_col", Vector3(SK.sun_col.r, SK.sun_col.g, SK.sun_col.b))
		ssm.set_shader_parameter("sun_size", SK.sun_size)
		ssm.set_shader_parameter("sun_power", SK.sun_power)
		ssm.set_shader_parameter("cloud_cover", SK.cover)
		ssm.set_shader_parameter("cloud_lit", Vector3(SK.lit.r, SK.lit.g, SK.lit.b))
		ssm.set_shader_parameter("cloud_shade", Vector3(SK.shade.r, SK.shade.g, SK.shade.b))
		ssm.set_shader_parameter("stars", SK.stars)
		sky.sky_material = ssm
		sky.radiance_size = Sky.RADIANCE_SIZE_32
	else:
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
	e.tonemap_mode = Environment.TONE_MAPPER_ACES if gfx >= 1 else Environment.TONE_MAPPER_FILMIC
	e.fog_enabled = true
	e.fog_light_color = E.fog
	e.fog_density = E.fog_d
	if gfx >= 1:
		e.fog_sky_affect = 0.0
		e.fog_height = 2.5            # 낮은 곳일수록 안개가 짙다 (땅안개)
		e.fog_height_density = 0.03
		e.adjustment_enabled = true   # 색 보정: 대비·채도를 살짝 올려 선명하게
		e.adjustment_contrast = 1.04
		e.adjustment_saturation = 1.04
		e.tonemap_exposure = 0.9
	e.glow_enabled = true
	e.glow_intensity = 0.55 if gfx >= 1 else 0.5
	e.glow_hdr_threshold = 1.0 if gfx >= 1 else 1.1
	if gfx >= 1:
		e.glow_bloom = 0.04           # 밝은 곳이 은은하게 번진다
	env.environment = e
	world_env = e
	add_child(env)

	sun = DirectionalLight3D.new()
	sun.light_color = E.sun
	sun.light_energy = E.sun_e
	sun.rotation_degrees = Vector3(-52, -35, 0) if gfx == 0 else Vector3(-40, -33, 0)   # 해를 낮춰 긴 그림자를 만든다
	sun.shadow_enabled = Save.settings.shadows
	sun.directional_shadow_max_distance = 55.0 if gfx == 0 else 85.0
	if gfx >= 1:
		sun.shadow_blur = 1.4
		sun.light_angular_distance = 0.4   # 그림자 가장자리가 멀수록 부드러워진다
		RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_HIGH)
		RenderingServer.directional_shadow_atlas_set_size(4096 if (gfx >= 2 and not Save.touch_device) else 2048, true)
		get_viewport().msaa_3d = Viewport.MSAA_4X if (gfx >= 2 and not Save.touch_device) else Viewport.MSAA_2X
	add_child(sun)
	if gfx >= 1:   # 반대편에서 오는 차갑고 약한 보조광: 그림자 쪽이 새까맣게 죽지 않고 윤곽이 산다
		var fill := DirectionalLight3D.new()
		fill.light_color = E.amb.lerp(Color(0.6, 0.75, 1.0), 0.5)
		fill.light_energy = 0.32
		fill.rotation_degrees = Vector3(-22, 150, 0)
		fill.shadow_enabled = false
		add_child(fill)

	if gfx >= 1:
		var gmat := ShaderMaterial.new()
		gmat.shader = load("res://shaders/ground.gdshader")
		gmat.set_shader_parameter("grass_a", Vector3(E.ground.r, E.ground.g, E.ground.b))
		var gb: Color = E.ground.lerp(E.leaf, 0.5).lightened(0.14)
		gmat.set_shader_parameter("grass_b", Vector3(gb.r, gb.g, gb.b))
		var dc: Color = E.path.darkened(0.25)
		gmat.set_shader_parameter("dirt_col", Vector3(dc.r, dc.g, dc.b))
		gmat.set_shader_parameter("path_col", Vector3(E.path.r, E.path.g, E.path.b))
		var bc: Color = E.ground.lerp(Color(0.2, 0.17, 0.24), 0.75).darkened(0.25)
		gmat.set_shader_parameter("blight_col", Vector3(bc.r, bc.g, bc.b))
		gmat.set_shader_parameter("snow", 1.0 if stage.env == "ice" else 0.0)
		gmat.set_shader_parameter("wet", 0.8 if stage.env in ["night", "dark"] else (0.3 if stage.env == "fire" else 0.0))
		gmat.set_shader_parameter("cracks", 1.0 if stage.env in ["dark", "fire"] else 0.3)
		var cc: Color = Color(0.65, 0.2, 0.95) if stage.env == "dark" else Color(1.0, 0.4, 0.1)
		gmat.set_shader_parameter("crack_col", Vector3(cc.r, cc.g, cc.b))
		var ground := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(320, 220)
		ground.position = Vector3(0, 0, -50)
		ground.mesh = pm
		ground.material_override = gmat
		add_child(ground)
	else:
		var ground := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(320, 220)
		ground.position = Vector3(0, 0, -50)
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

	_build_set()
	if gfx >= 2:
		_build_atmosphere(E, SK)

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


func _build_atmosphere(E: Dictionary, SK: Dictionary) -> void:
	## 빛줄기(햇살이 숲 사이로 새는 모습)와 땅 위에 깔리는 안개, 화면 마무리 효과 (그래픽 품질 높음)
	var rng := RandomNumberGenerator.new()
	rng.seed = 99 + stage_idx
	var to_sun := (-sun.global_transform.basis.z).normalized()   # 빛이 오는 쪽(위)
	var axis := Vector3.UP.cross(-to_sun)
	for i in 9:
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/star_beam.gdshader")
		var rc: Color = SK.ray
		m.set_shader_parameter("core_col", Vector3(rc.r, rc.g, rc.b))
		m.set_shader_parameter("edge_col", Vector3(rc.r * 0.8, rc.g * 0.8, rc.b * 0.9))
		m.set_shader_parameter("intensity", 0.5)
		m.set_shader_parameter("rings", 0.0)
		m.set_shader_parameter("top_y", 60.0)
		m.set_shader_parameter("fade", rng.randf_range(0.18, 0.4))
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 1.0
		cm.bottom_radius = 1.0
		cm.height = 1.0
		cm.radial_segments = 20
		cm.rings = 1
		cm.cap_top = false
		cm.cap_bottom = false
		mi.mesh = cm
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var foot := Vector3(rng.randf_range(-38.0, 40.0), 0.0, -rng.randf_range(6.0, 22.0))
		var len := 46.0
		var w := rng.randf_range(1.5, 3.8)
		mi.scale = Vector3(w, len, w)
		var up := to_sun
		var basis := Basis(Quaternion(Vector3.UP, up))
		mi.transform = Transform3D(basis.scaled(Vector3(w, len, w)), foot + up * len * 0.5)
		add_child(mi)
	for i in 6:
		var mm := ShaderMaterial.new()
		mm.shader = load("res://shaders/mist.gdshader")
		var fc: Color = E.fog.lightened(0.15)
		mm.set_shader_parameter("col", Vector3(fc.r, fc.g, fc.b))
		mm.set_shader_parameter("density", 0.2 if stage.env != "day" else 0.12)
		mm.set_shader_parameter("speed", rng.randf_range(0.02, 0.05))
		var mi2 := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(70, 22)
		mi2.mesh = pm
		mi2.material_override = mm
		mi2.position = Vector3(rng.randf_range(-40.0, 44.0), rng.randf_range(0.5, 1.4), -rng.randf_range(7.0, 20.0))
		mi2.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi2)
	# 화면 마무리(비네팅·색 분리·필름 그레인): UI 아래에 깔린다
	if not Save.touch_device:
		var pl := CanvasLayer.new()
		pl.layer = 0
		add_child(pl)
		var cr := ColorRect.new()
		cr.set_anchors_preset(Control.PRESET_FULL_RECT)
		cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pmat := ShaderMaterial.new()
		pmat.shader = load("res://shaders/post.gdshader")
		cr.material = pmat
		pl.add_child(cr)


var foliage_cache := {}


func _apply_foliage(n: Node3D, nm: String) -> void:
	## Quaternius 나무·풀의 잎 재질을 바람·투과광 셰이더로 바꾸고, 줄기 재질은 거칠기를 다듬는다.
	var wind := 1.0
	var sway := 0.06
	if nm.begins_with("Grass") or nm.begins_with("Flower") or nm.begins_with("Fern") or nm.begins_with("Plant"):
		wind = 14.0
		sway = 0.07
	elif nm.begins_with("Bush"):
		wind = 8.0
	elif nm.begins_with("Mushroom") or nm.begins_with("Rock"):
		wind = 0.0
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = mi.mesh
		if mesh == null:
			continue
		for i in mesh.get_surface_count():
			var src := mesh.surface_get_material(i)
			if not (src is StandardMaterial3D):
				continue
			var sm: StandardMaterial3D = src
			if sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and sm.albedo_texture != null:
				var key := "%s|%.1f" % [sm.albedo_texture.resource_path, wind]
				if not foliage_cache.has(key):
					var fm := ShaderMaterial.new()
					fm.shader = load("res://shaders/foliage.gdshader")
					fm.set_shader_parameter("albedo_tex", sm.albedo_texture)
					fm.set_shader_parameter("wind", wind)
					fm.set_shader_parameter("sway_h", sway)
					foliage_cache[key] = fm
				mi.set_surface_override_material(i, foliage_cache[key])
			else:
				sm.roughness = 0.92


func _build_set() -> void:
	## 전장의 모든 사물: KayKit(CC0) 모델로 배치. 스테이지마다 나무·색조가 달라진다.
	var rng := RandomNumberGenerator.new()
	rng.seed = 7 + stage_idx
	var envn: String = stage.env
	var tint := ""
	match envn:
		"ice": tint = "ice"
		"dark": tint = "dark"
		"fire": tint = "fire"

	# ===== 빛의 진영 (왼쪽): 성벽·탑·성 =====
	for z in [-24.0, -16.0, -8.0, 8.0, 16.0, 24.0]:
		place("hex/wall_straight.gltf", Vector3(-40, 0, z), 90, 4.0, "ice" if envn == "ice" else "")
	place("hex/wall_straight_gate.gltf", Vector3(-40, 0, 0), 90, 4.0, "ice" if envn == "ice" else "")
	for z in [-28.0, -12.0, 12.0, 28.0]:
		place("hex/building_tower_A_blue.gltf", Vector3(-40, 0, z), 90, 5.0, "ice" if envn == "ice" else "")
	place("hex/building_castle_blue.gltf", Vector3(-54, 0, 0), -90, 5.5, "ice" if envn == "ice" else "")
	for z in [-5.5, 5.5]:
		place("hex/flag_blue.gltf", Vector3(-36.8, 0, z), 90, 9.0)
		_torch(Vector3(-34, 0, z), Color(1.0, 0.7, 0.3))
	# 진영 건물과 야영 도구
	place("hex/building_barracks_blue.gltf", Vector3(-31, 0, -22), 0, 5.0)
	place("hex/building_archeryrange_blue.gltf", Vector3(-23, 0, -26), 0, 5.0)
	place("hex/building_blacksmith_blue.gltf", Vector3(-35, 0, -19.5), 0, 4.5)
	place("hex/building_market_blue.gltf", Vector3(-31, 0, 21), 0, 5.0)
	var camp := [["tent", -33.0, -9.5, 20.0, 6.0], ["weaponrack", -31.5, -7.5, 0.0, 8.0], ["target", -29.0, 9.0, 200.0, 8.0],
		["barrel", -34.0, 9.5, 0.0, 8.0], ["crate_A_big", -34.0, -12.0, 30.0, 8.0], ["bucket_arrows", -31.0, 10.5, 0.0, 9.0],
		["sack", -33.0, 12.0, 0.0, 8.0], ["wheelbarrow", -28.5, -10.5, 60.0, 8.0], ["resource_lumber", -35.0, 13.0, 0.0, 8.0], ["resource_stone", -29.5, 12.5, 0.0, 8.0]]
	for c in camp:
		place("hex/%s.gltf" % c[0], Vector3(c[1], 0, c[2]), c[3], c[4], "ice" if envn == "ice" else "")

	# ===== 어둠의 진영 (오른쪽): 문·납골당·묘지·울타리 =====
	place("hw/arch_gate.gltf", Vector3(35.6, 0, 0), 90, 1.9, "gloom")
	place("hw/crypt.gltf", Vector3(47, 0, 0), -90, 1.8, "gloom")
	place("hex/building_castle_red.gltf", Vector3(66, 0, 0), -90, 6.5, "dark")
	for z in [-18.0, 18.0]:
		place("hex/building_tower_A_red.gltf", Vector3(56, 0, z), 0, 6.0, "dark")
	for z in [-27.0, -21.0, -15.0, -9.0, 9.0, 15.0, 21.0, 27.0]:
		place("hw/fence.gltf", Vector3(39, 0, z), 90, 1.5, "gloom")
	for z in [-5.6, 5.6]:
		place("hw/post_skull.gltf", Vector3(36.8, 1.29 * 1.0, z), 0, 1.0, "gloom")
		place("hw/lantern_standing.gltf", Vector3(32.5, 0, z * 1.3), 0, 2.0)
		_torch(Vector3(31.5, 0, z * 1.7), Color(0.7, 0.3, 1.0))
	var grave := ["gravestone", "grave_A", "grave_B", "gravemarker_A", "gravemarker_B", "coffin"]
	for i in 16:
		var gz := rng.randf_range(8.5, 17.0) * (1.0 if rng.randf() < 0.5 else -1.0)
		place("hw/%s.gltf" % grave[i % grave.size()], Vector3(rng.randf_range(24, 36.5), 0, gz), rng.randf_range(0, 360), rng.randf_range(1.2, 1.7), "gloom")
	# 해골·뼈는 길 밖(|z| 5.5 이상)에 작게
	for nm in ["skull", "ribcage", "bone_A", "bone_B", "skull", "bone_A", "ribcage", "bone_B"]:
		var bz := rng.randf_range(5.8, 9.0) * (1.0 if rng.randf() < 0.5 else -1.0)
		place("hw/%s.gltf" % nm, Vector3(rng.randf_range(22, 34), 0.0, bz), rng.randf_range(0, 360), rng.randf_range(0.8, 1.2))

	# ===== 숲: Quaternius Stylized Nature MegaKit (CC0) 나무·덤불·풀·꽃·바위. 스테이지마다 나무 종류와 색조가 달라진다 =====
	var commons := ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5"]
	var pines := ["Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5"]
	var twisted := ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3"]
	var deads := ["DeadTree_1", "DeadTree_2", "DeadTree_3", "DeadTree_4"]
	var qtint := tint if tint != "dark" else "gloom"
	for i in 44:   # 뒤쪽(-z)의 숲
		var x := lerpf(-62.0, 62.0, i / 43.0) + rng.randf_range(-2.0, 2.0)
		if absf(x) > 52.0:
			continue
		var z := -rng.randf_range(15.0, 26.0)
		var nm := ""
		var sc := rng.randf_range(1.0, 1.5)
		match envn:
			"dark":
				nm = deads[i % deads.size()]
			"fire":
				nm = deads[i % deads.size()] if i % 3 == 0 else pines[i % pines.size()]
			"ice":
				nm = pines[i % pines.size()]
			_:
				nm = commons[i % commons.size()] if i % 3 != 0 else pines[i % pines.size()]
		if i % 11 == 5 and envn != "dark":   # 군데군데 거대한 뒤틀린 고목
			nm = twisted[(i / 11) % twisted.size()]
			sc = rng.randf_range(0.55, 0.75)
		place("qn/%s.gltf" % nm, Vector3(x, 0, z), rng.randf_range(0, 360), sc, qtint)
	for i in 18:   # 카메라 반대편(+z) 가장자리와 길가 외톨이 나무
		var x2 := rng.randf_range(-33, 33)
		var z2 := rng.randf_range(12.5, 16.0) * (1.0 if rng.randf() < 0.35 else -1.0)
		var nm2: String = deads[i % deads.size()] if envn == "dark" else (pines[i % pines.size()] if (i % 2 == 0 or envn == "ice") else commons[i % commons.size()])
		place("qn/%s.gltf" % nm2, Vector3(x2, 0, z2), rng.randf_range(0, 360), rng.randf_range(0.7, 1.1), qtint)
	for i in 22:   # 바위
		var rk := "Rock_Medium_%d" % (1 + i % 3)
		place("qn/%s.gltf" % rk, Vector3(rng.randf_range(-32, 32), 0, rng.randf_range(9.5, 16.5) * (1.0 if rng.randf() < 0.4 else -1.0)), rng.randf_range(0, 360), rng.randf_range(0.9, 1.8), tint)
	for i in 26:   # 덤불
		var bn := "Bush_Common_Flowers" if (i % 3 == 0 and (envn == "day" or envn == "night")) else "Bush_Common"
		place("qn/%s.gltf" % bn, Vector3(rng.randf_range(-36, 30), 0, rng.randf_range(7.5, 17.0) * (1.0 if rng.randf() < 0.3 else -1.0)), rng.randf_range(0, 360), rng.randf_range(1.0, 1.7), qtint)
	var tufts := ["Grass_Common_Tall", "Grass_Common_Short", "Grass_Wispy_Tall"]
	for i in 70:   # 길 가장자리 풀
		var gz := rng.randf_range(6.2, 15.0) * (1.0 if rng.randf() < 0.4 else -1.0)
		place("qn/%s.gltf" % tufts[i % tufts.size()], Vector3(rng.randf_range(-38, 30), 0, gz), rng.randf_range(0, 360), rng.randf_range(1.0, 1.7), qtint)
	if envn == "day" or envn == "night" or envn == "ice":   # 꽃과 버섯
		for i in 26:
			var fn := "Flower_3_Group" if i % 2 == 0 else "Flower_4_Group"
			place("qn/%s.gltf" % fn, Vector3(rng.randf_range(-36, 28), 0, rng.randf_range(6.5, 14.0) * (1.0 if rng.randf() < 0.4 else -1.0)), rng.randf_range(0, 360), rng.randf_range(0.9, 1.5), qtint)
	for i in 10:
		var mn2 := "Mushroom_Common" if i % 2 == 0 else "Mushroom_Laetiporus"
		place("qn/%s.gltf" % mn2, Vector3(rng.randf_range(-34, 30), 0, rng.randf_range(6.5, 12.0) * (1.0 if rng.randf() < 0.5 else -1.0)), rng.randf_range(0, 360), rng.randf_range(1.2, 2.2), qtint)

	# ===== 먼 배경: 언덕과 산, 구름 =====
	var hills := ["hills_A", "hills_B", "hills_C", "hills_A_trees"]
	for i in 12:
		var hx := lerpf(-90.0, 90.0, i / 11.0) + rng.randf_range(-4, 4)
		place("hex/%s.gltf" % hills[i % hills.size()], Vector3(hx, 0, -rng.randf_range(38.0, 46.0)), rng.randf_range(0, 360), rng.randf_range(9.0, 12.0), tint)
	var mts := ["mountain_A_grass_trees", "mountain_B_grass_trees", "mountain_C_grass_trees"]
	for i in 9:
		var mx := lerpf(-100.0, 100.0, i / 8.0) + rng.randf_range(-5, 5)
		place("hex/%s.gltf" % mts[i % mts.size()], Vector3(mx, 0, -rng.randf_range(58.0, 70.0)), rng.randf_range(0, 360), rng.randf_range(13.0, 17.0), tint)
	clouds.clear()
	for i in 9:
		var cn := "cloud_big" if i % 3 != 2 else "cloud_small"
		var cl := place("hex/%s.gltf" % cn, Vector3(rng.randf_range(-100, 100), rng.randf_range(28, 42), -rng.randf_range(20, 70)), 0, rng.randf_range(6.0, 10.0), "dark" if envn == "dark" else ("fire" if envn == "fire" else ""))
		cl.set_meta("speed", rng.randf_range(0.5, 1.4))
		clouds.append(cl)

	# 불꽃 스테이지: 곳곳에 타오르는 불
	if envn == "fire":
		for i in 10:
			var p := Vector3(rng.randf_range(-25, 28), 0, rng.randf_range(11, 16) * (1 if rng.randf() < 0.5 else -1))
			var f := _particles(p, Color(1.0, 0.5, 0.15), 24, 1.0, 0.4, Vector3(0, 2.5, 0), false)
			f.scale_amount_min = 1.5
			f.scale_amount_max = 3.0

	# 포탈: 어둠의 문 안쪽에 소용돌이 원판과 입자
	portal_disc = MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 2.9
	cm.bottom_radius = 2.9
	cm.height = 0.1
	portal_disc.mesh = cm
	portal_disc.material_override = _overlay(Color(0.45, 0.06, 0.65, 0.75))
	portal_disc.position = Vector3(35.0, 3.6, 0)
	portal_disc.rotation_degrees = Vector3(0, 0, 90)
	add_child(portal_disc)
	var pl := OmniLight3D.new()
	pl.light_color = Color(0.7, 0.3, 1.0)
	pl.light_energy = 3.0
	pl.omni_range = 14.0
	pl.position = Vector3(33, 3, 0)
	add_child(pl)
	var pp2 := _particles(Vector3(34.6, 3.6, 0), Color(0.75, 0.35, 1.0), 60, 1.4, 2.6, Vector3(-1.5, 0, 0), false)
	pp2.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	pp2.emission_ring_axis = Vector3(1, 0, 0)
	pp2.emission_ring_radius = 2.9
	pp2.emission_ring_inner_radius = 2.5
	pp2.emission_ring_height = 0.1


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
		# 위치(Vector3)는 32비트라 정지 위치로 맞춰도 아주 조금 커질 수 있다.
		# 오차 없이 비교하면 일부 병사가 도착한 뒤에도 "이동 중"으로 남아 제자리에서 계속 달린다.
		if u.position.x > sx + 0.02:
			u.position.x = maxf(sx, u.position.x - 7.0 * delta)
			var dz: float = float(u.get_meta("slot_z")) - u.position.z
			u.position.z += clampf(dz, -2.2 * delta, 2.2 * delta)
			u.loop_anim(u.run_anim)
		else:
			u.position.x = sx
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
	while q.size() < WAVE_MIN:   # 웨이브마다 최소 WAVE_MIN 명은 나오게 (한 번에 10명 안팎이 몰려온다)
		q.append("minion")
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
	## 쓰러진 병사를 보충한다 (병사는 MAX_ALLIES 명까지만)
	var order := ["knight", "knight", "archer" if wave % 2 == 0 else "ally_mage", "knight", "archer"]
	var need := mini(MAX_ALLIES - ally_count(), 3)
	for i in need:
		_ally(order[i], Vector3(-27, 0, -3 + i * 3), Vector3(randf_range(2.0, 5.0), 0, randf_range(-6.0, 6.0)))
	hero.heal(hero.max_hp * 0.35)
	crystal.heal(120)
	if need > 0:
		show_banner("증원군 도착", "병사 %d명 보충 (병사 최대 %d명) · 체력 회복" % [need, MAX_ALLIES], 2.4)
	else:
		show_banner("병사 정원 가득", "병사 %d명 모두 무사 · 체력 회복" % MAX_ALLIES, 2.4)
	Sfx.play("levelup", 0.6)


func _process(delta: float) -> void:
	# 시간 배율: 치트 속도 × 슬로모션
	var ts := float(Save.cheats.speed) if (state == "play" and not cine_active) else 1.0
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
	var active := state == "play" and not cine_active
	if state == "intro":
		_update_intro(delta)
	elif cine_active:
		if judge:
			judge.update(delta)
	elif active:
		_update_hero(delta)
		_update_waves(delta)
	elif state == "win" or state == "lose":
		end_t += delta
		hero.loop_anim("Idle")
	elif state == "title" or state == "gate":
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
	if portal_disc:
		portal_disc.scale = Vector3.ONE * (1.0 + 0.06 * sin(t * 3.0))
	for c in clouds:
		c.position.x += float(c.get_meta("speed")) * delta
		if c.position.x > 110.0:
			c.position.x = -110.0
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
			var nxt: String = spawn_queue[0]
			var is_bossk := nxt.begins_with("boss")
			if not is_bossk:
				var alive := 0
				for e in units:
					if e.team == 1 and not e.dead and not e.is_boss and not e.scripted:
						alive += 1
				if alive >= MAX_CONCURRENT:
					spawn_t = 0.25   # 자리가 날 때까지 기다린다
					return
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
			spawn_t = maxf(0.25, 0.55 - wave * 0.03)
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
	if state != "play" or hero.dead or cds.dash > 0.0 or paused or cine_active:
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
	if cine_active:
		return
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


func use_judge() -> void:
	## 아스트라 유디키움: 개발자 전용 (개발자 모드를 켠 뒤에만 쓸 수 있다). 컷씬 후 모든 적에게 9999 피해.
	if not Save.dev_unlocked or state != "play" or paused or cine_active or hero.dead or cds["judge"] > 0.0:
		return
	cds["judge"] = cd_max["judge"]
	judge = Judge.new()
	add_child(judge)
	judge.start(self, hero)


func use_slot(i: int) -> void:
	if i < Save.equipped.size():
		use_skill(Save.equipped[i])


func use_skill(s: String) -> void:
	if state != "play" or paused or cine_active or hero.dead or not cds.has(s) or cds[s] > 0.0 or Save.skills.get(s, 0) <= 0:
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
			var slots := mini(int(v.count), MAX_ALLIES - ally_count())
			if slots <= 0:   # 병사가 가득 차 있으면 쓰지 않은 것으로 하고 대기시간을 되돌린다
				cds[s] = 0.0
				Sfx.play("error", 0.6)
				show_banner("병사가 가득 찼습니다", "병사는 최대 %d명까지만 나옵니다" % MAX_ALLIES, 1.6)
				return
			hero.play_once("Spellcast_Raise", 0.6)
			Sfx.play("summon")
			for i in slots:
				var p := hero.position + Vector3(1.5, 0, -1.8 * (slots - 1) / 2.0 + i * 1.8)
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
	if state != "play" or paused or cine_active or hero.dead or Save.items.get(id, 0) <= 0:
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
		"spawn_allies":
			set_paused(false)
			if menu:
				menu.page = ""
			var akinds := ["knight", "knight", "knight", "archer", "ally_mage"]
			for i in 5:
				var ap := Vector3(-24.0 + (i % 2) * 3.0, 0.0, -6.0 + i * 3.0)
				_ally(akinds[i], ap, Vector3(randf_range(0.0, 6.0), 0, randf_range(-5.0, 5.0)))
				sparks(ap + Vector3(0, 1.5, 0), Color(0.6, 0.8, 1.0), 14, 4.0, 0.5)
			Sfx.play("summon", 0.8)
			return "아군 병사 5명 소환"
		"heal":
			hero.hp = hero.max_hp
			crystal.hp = crystal.max_hp
		"judge":
			set_paused(false)
			if menu:
				menu.page = ""
			cds["judge"] = 0.0
			use_judge()
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
	elif cine_active and judge:
		var cr: Array = judge.camera()
		pos = cr[0]
		look = cr[1]
	elif state == "title" or state == "gate":
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
	elif cine_active:
		cam.position = cam.position.lerp(pos, minf(1.0, delta * 14.0))   # 컷씬은 더 빠르게 따라간다
	else:
		cam.position = cam.position.lerp(pos, minf(1.0, delta * 5.0))
	if shake > 0.0:
		cam.position += Vector3(randf() - 0.5, randf() - 0.5, 0) * shake
	if state == "play" and cam_focus_t <= 0.0 and not cine_active:
		cam.look_at(cam.position + Vector3(0, -13, -15), Vector3.UP)
	else:
		cam.look_at(look, Vector3.UP)


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo:
		if cine_active:
			if judge:
				judge.skip()
			return
		if state == "gate":
			leave_gate()
			return
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
			KEY_T:
				use_judge()
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
	if cine_active:
		return
	paused = p
	touch_attack = false
	if menu:
		menu.page = "pause" if p else ""


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED:
		if state == "play" and not paused:
			set_paused(true)
		Save.save_data()
