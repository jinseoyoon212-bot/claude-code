extends Node3D
## Warbattle: match flow, rendering setup, player input and camera, combat, loot and zone.

const BOT_NAMES := ["Varga", "Okafor", "Lindqvist", "Moreau", "Tanaka", "Novak", "Haddad", "Silva", "Kowalski", "Brennan", "Ivanova", "Mbeki", "Castillo", "Ferreira", "Holm", "Rahimi", "Duarte", "Petrov", "Nakamura", "Quinn", "Achterberg", "Sato", "Vidal", "Kaur", "Reyes", "Bauer", "Osei", "Larsen", "Costa", "Yilmaz", "Abara", "Lund", "Marsh", "Ortega", "Pike", "Voss", "Wren", "Zane", "Ruiz", "Hale"]
const ZONE_PHASES := [
	{"delay": 150.0, "shrink": 80.0, "r": 430.0, "dps": 0.6}, {"delay": 75.0, "shrink": 55.0, "r": 250.0, "dps": 1.2},
	{"delay": 60.0, "shrink": 45.0, "r": 140.0, "dps": 2.5}, {"delay": 50.0, "shrink": 40.0, "r": 70.0, "dps": 5.0},
	{"delay": 40.0, "shrink": 30.0, "r": 30.0, "dps": 8.0}, {"delay": 30.0, "shrink": 30.0, "r": 0.0, "dps": 12.0},
]
const MODEL_NAMES := ["soldier", "fir_tree_01", "island_tree_02", "WoodenTable_03", "wooden_stool_01", "sofa_02", "drawer_cabinet", "steel_frame_shelves_01", "wooden_bookshelf_worn", "metal_office_desk", "plastic_monobloc_chair_01", "wooden_picnic_table", "metal_trash_can", "utility_box_01", "fire_hydrant", "old_bed_frame", "wooden_barrels_01", "Barrel_01", "ammo_box", "bolt_action_rifle_7_62", "boulder_01", "covered_car", "dead_tree_trunk", "fern_02", "medical_box", "metal_jerrycan_green", "namaqualand_boulder_02", "old_military_crate", "old_tyre", "rock_moss_set_01", "service_pistol", "shrub_01", "shrub_02", "shrub_03", "stick_grenade", "street_lamp_01", "tree_stump_01", "wooden_crate_01", "wooden_military_crate"]

var settings := {}
var models := {}
var world: World
var world_root: Node3D
var fx: Effects
var audio: Synth
var hud: Hud
var camera := Camera3D.new()
var sun := DirectionalLight3D.new()
var env := Environment.new()
var cam_attr := CameraAttributesPractical.new()
var use_dof := false
var plane: Node3D
var zone_mesh := MeshInstance3D.new()
var actors: Array = []
var player: Actor
var loot: Array = []
var bullets: Array = []
var grenades_live: Array = []
var zone := {}
var flight := {}
var plane_t := 0.0
var time := 0.0
var state := "menu"
var view_mode := "tpp"
var cam_yaw := 0.0
var cam_pitch := -0.3
var recoil_kick := 0.0
var bob := 0.0
var shake := 0.0
var damage_flash := 0.0
var near_item: Variant = null
var fire_held := false
var touch_move := Vector2.ZERO
var stick_id := -1
var look_id := -1
var look_last := Vector2.ZERO
var rng := RandomNumberGenerator.new()
var is_rd := false
var is_mobile := false
var ended := false


func _ready() -> void:
	is_rd = RenderingServer.get_rendering_device() != null
	is_mobile = OS.has_feature("mobile")
	audio = Synth.new()
	add_child(audio)
	hud = Hud.new()
	hud.game = self
	add_child(hud)
	hud.deploy.connect(_on_deploy)
	hud.again.connect(new_match)
	hud.touch_button.connect(_on_touch_button)
	camera.far = 3000.0
	camera.near = 0.05
	add_child(camera)
	var args := OS.get_cmdline_user_args()
	if "--autoplay" in args:
		var q := "low"
		for x in args:
			if x.begins_with("--quality="):
				q = x.split("=")[1]
		var s := hud.settings.duplicate()
		s.quality = q
		_on_deploy.call_deferred(s)
	for x in args:
		if x.begins_with("--shots="):
			var t = load("res://scripts/autotest.gd").new()
			t.game = self
			t.dir = x.split("=")[1]
			add_child(t)
			t.run.call_deferred()


func _on_deploy(s: Dictionary) -> void:
	settings = s.duplicate()
	view_mode = settings.view
	camera.fov = settings.fov
	audio.start_ambience()
	if world == null:
		hud.show_loading(0.02, "Loading models")
		await get_tree().process_frame
		await _load_and_build()
	new_match()


func _progress(p: float, text: String) -> void:
	hud.show_loading(p, text)


func _load_and_build() -> void:
	var i := 0
	for n in MODEL_NAMES:
		models[n] = load("res://assets/models/%s.glb" % n)
		i += 1
		if i % 5 == 0:
			_progress(0.02 + 0.3 * i / MODEL_NAMES.size(), "Loading models %d/%d" % [i, MODEL_NAMES.size()])
			await get_tree().process_frame
	_setup_environment()
	world_root = Node3D.new()
	add_child(world_root)
	world = World.new()
	world_root.add_child(world)
	_progress(0.35, "Building Kestrel Island")
	await get_tree().process_frame
	world.build(settings.quality, models, func(p): _progress(0.35 + p * 0.6, "Building Kestrel Island"))
	hud.map_tex = ImageTexture.create_from_image(world.map_image)
	fx = Effects.new()
	world_root.add_child(fx)
	plane = _make_plane()
	world_root.add_child(plane)
	var zm := CylinderMesh.new()
	zm.top_radius = 1.0
	zm.bottom_radius = 1.0
	zm.height = 700.0
	zm.radial_segments = 160
	zm.cap_top = false
	zm.cap_bottom = false
	zone_mesh.mesh = zm
	var zmat := ShaderMaterial.new()
	zmat.shader = load("res://scripts/zone.gdshader")
	zone_mesh.material_override = zmat
	zone_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world_root.add_child(zone_mesh)
	_progress(1.0, "Ready")


# ---------------------------------------------------------------- rendering
func _setup_environment() -> void:
	var q: String = settings.quality
	var hdr: Texture2D = load("res://assets/hdri/sky.hdr")
	var sky_mat := PanoramaSkyMaterial.new()
	sky_mat.panorama = hdr
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.glow_enabled = q != "low"
	env.glow_intensity = 0.35
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.72, 0.8, 0.88)
	env.fog_density = 0.00055
	env.fog_sky_affect = 0.15
	env.fog_sun_scatter = 0.25
	env.fog_aerial_perspective = 0.35
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 0.95
	if is_rd:
		env.ssao_enabled = q != "low" and not is_mobile
		env.ssao_radius = 1.4
		env.ssao_intensity = 2.2
		env.ssao_power = 1.4
		env.ssil_enabled = (q == "high" or q == "ultra") and not is_mobile
		env.ssil_radius = 6.0
		env.ssil_intensity = 0.8
		env.sdfgi_enabled = (q == "high" or q == "ultra") and not is_mobile
		env.sdfgi_use_occlusion = true
		env.sdfgi_cascades = 4 if q == "ultra" else 3
		env.sdfgi_min_cell_size = 0.4
		env.sdfgi_energy = 0.8
		env.volumetric_fog_enabled = (q == "high" or q == "ultra") and not is_mobile
		env.volumetric_fog_density = 0.0035
		env.volumetric_fog_albedo = Color(0.88, 0.9, 0.95)
		env.volumetric_fog_length = 160.0
		env.volumetric_fog_anisotropy = 0.6
		env.ssr_enabled = (q == "high" or q == "ultra") and not is_mobile
		env.ssr_max_steps = 48
		RenderingServer.directional_shadow_atlas_set_size(8192 if q == "ultra" else 4096, true)
		RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_HIGH if q == "ultra" else RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM)
	var we := WorldEnvironment.new()
	we.environment = env
	use_dof = is_rd and not is_mobile and q != "low"
	cam_attr.dof_blur_far_distance = 45.0
	cam_attr.dof_blur_far_transition = 60.0
	cam_attr.dof_blur_amount = 0.06
	we.camera_attributes = cam_attr
	add_child(we)
	# sun from the brightest pixel of the sky image
	var dir := Vector3(0.556, 0.741, 0.377)
	var img := hdr.get_image()
	if img:
		if img.is_compressed():
			img.decompress()
		img.resize(256, 128, Image.INTERPOLATE_BILINEAR)
		var best := -1.0
		var bx := 0
		var by := 0
		for y in 128:
			for x in 256:
				var c := img.get_pixel(x, y)
				var l := c.r * 0.3 + c.g * 0.6 + c.b * 0.1
				if l > best:
					best = l
					bx = x
					by = y
		var phi := float(bx) / 256.0 * TAU
		var elev := PI / 2.0 - float(by) / 128.0 * PI
		dir = Vector3(cos(elev) * -cos(phi), sin(elev), cos(elev) * -sin(phi)).normalized()
		if dir.y < 0.3:
			dir = Vector3(dir.x, 0.3, dir.z).normalized()
	sun.light_color = Color(1.0, 0.95, 0.86)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if q != "low" else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = {"low": 80.0, "medium": 160.0, "high": 300.0, "ultra": 450.0}[q]
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	sun.light_angular_distance = 0.5
	add_child(sun)
	sun.look_at_from_position(Vector3.ZERO, -dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.FORWARD)
	var vp := get_viewport()
	if is_rd and not is_mobile:
		vp.use_taa = q != "low"
		vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if q == "low" else Viewport.SCREEN_SPACE_AA_DISABLED
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2 if q == "medium" else Viewport.SCALING_3D_MODE_BILINEAR
		vp.scaling_3d_scale = 0.77 if q == "medium" else 1.0
	else:
		vp.msaa_3d = Viewport.MSAA_2X if q != "low" else Viewport.MSAA_DISABLED
		vp.scaling_3d_scale = 0.75 if (q == "low" and is_mobile) else 1.0


func _make_plane() -> Node3D:
	var g := Node3D.new()
	var paint := StandardMaterial3D.new()
	paint.albedo_color = Color(0.36, 0.4, 0.33)
	paint.metallic = 0.35
	paint.roughness = 0.55
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.14, 0.16, 0.16)
	dark.metallic = 0.5
	dark.roughness = 0.4
	var add := func(mesh: Mesh, m: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = m
		mi.position = pos
		mi.rotation = rot
		g.add_child(mi)
		return mi
	var fus := CylinderMesh.new()
	fus.top_radius = 2.4
	fus.bottom_radius = 2.4
	fus.height = 26.0
	add.call(fus, paint, Vector3.ZERO, Vector3(PI / 2, 0, 0))
	var nose := SphereMesh.new()
	nose.radius = 2.4
	nose.height = 6.0
	add.call(nose, paint, Vector3(0, 0, -13.5))
	var tail := CylinderMesh.new()
	tail.top_radius = 0.7
	tail.bottom_radius = 2.4
	tail.height = 9.0
	add.call(tail, paint, Vector3(0, 0.9, 17.4), Vector3(-PI / 2, 0, 0))
	var wing := BoxMesh.new()
	wing.size = Vector3(40, 0.45, 5.2)
	add.call(wing, paint, Vector3(0, 2.0, -2))
	var hs := BoxMesh.new()
	hs.size = Vector3(13, 0.3, 3)
	add.call(hs, paint, Vector3(0, 2.2, 20.5))
	var vs := BoxMesh.new()
	vs.size = Vector3(0.35, 7, 4.5)
	add.call(vs, paint, Vector3(0, 5.2, 20.5), Vector3(-0.3, 0, 0))
	var props := []
	for x in [-12, -6, 6, 12]:
		var nac := CylinderMesh.new()
		nac.top_radius = 0.85
		nac.bottom_radius = 0.75
		nac.height = 4.6
		add.call(nac, dark, Vector3(x, 1.5, -3.6), Vector3(PI / 2, 0, 0))
		var p := Node3D.new()
		p.position = Vector3(x, 1.5, -6.05)
		g.add_child(p)
		for b in 4:
			var bl := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(0.22, 3.6, 0.06)
			bl.mesh = bm
			bl.material_override = dark
			bl.rotation.z = b * PI / 2
			p.add_child(bl)
		props.append(p)
	g.set_meta("props", props)
	return g


# ---------------------------------------------------------------- match
func new_match() -> void:
	for a in actors:
		a.cleanup()
	for l in loot:
		l.node.queue_free()
	for g in grenades_live:
		g.node.queue_free()
	actors.clear()
	loot.clear()
	bullets.clear()
	grenades_live.clear()
	time = 0.0
	ended = false
	rng.randomize()
	for spot in world.loot_spots:
		var n := 1 if rng.randf() < 0.75 else 2
		for i in n:
			spawn_loot(roll_loot(spot.tier), spot.pos + Vector3(rng.randf_range(-0.8, 0.8), 0, rng.randf_range(-0.8, 0.8)))
	var ang := rng.randf() * TAU
	var off := rng.randf_range(-250, 250)
	var dir := Vector3(cos(ang), 0, sin(ang))
	var perp := Vector3(-dir.z, 0, dir.x)
	flight = {"a": perp * off - dir * 1050.0 + Vector3(0, 460, 0), "dir": dir, "speed": 72.0, "len": 2100.0}
	plane.visible = true
	plane_t = 0.0
	player = _make_actor(0, "You", true)
	for i in int(settings.bots):
		_make_actor(i + 1, BOT_NAMES[i % BOT_NAMES.size()], false)
	for a in actors:
		if not a.is_player:
			var t: Dictionary = world.towns[rng.randi() % world.towns.size()] if rng.randf() < 0.8 else {"x": rng.randf_range(-450, 450), "z": rng.randf_range(-450, 450), "R": 40.0}
			a.ai.drop = Vector3(t.x + rng.randf_range(-0.7, 0.7) * t.R, 0, t.z + rng.randf_range(-0.7, 0.7) * t.R)
			var rel: Vector3 = a.ai.drop - flight.a
			var along := clampf(rel.x * dir.x + rel.z * dir.z, 80.0, flight.len - 80.0)
			a.ai.jump_at = along / flight.speed + rng.randf_range(-3, 3)
	zone = {"phase": -1, "c": Vector2.ZERO, "r": 1150.0, "c0": Vector2.ZERO, "r0": 1150.0, "nc": null, "nr": 1150.0, "t": 0.0, "stage": "wait", "dps": 0.4, "shrink": 0.0, "P": {}}
	_next_zone()
	cam_yaw = 0.0
	cam_pitch = -0.3
	hud.menu.visible = false
	hud.loading.visible = false
	hud.endscreen.visible = false
	hud.hud.visible = true
	hud.touch.visible = is_mobile or DisplayServer.is_touchscreen_available()
	state = "playing"
	hud.show_toast("Board the transport. Press F to jump.")
	if not hud.touch.visible:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _make_actor(i: int, n: String, is_player: bool) -> Actor:
	var a := Actor.new()
	world_root.add_child(a)
	a.setup(self, i, n, is_player, models)
	if not is_player:
		a.ai = BotBrain.new(a, self)
	a.global_position = Vector3(0, 400, 0)
	a.process_mode = Node.PROCESS_MODE_INHERIT
	actors.append(a)
	return a


func roll_loot(tier: int) -> Dictionary:
	var r := rng.randf()
	var pool: Array = ["carbine", "carbine", "marksman", "smg"] if tier >= 2 else ["pistol", "smg", "carbine", "pistol", "marksman"]
	if r < 0.37:
		return {"kind": "weapon", "sub": pool[rng.randi() % pool.size()]}
	if r < 0.6:
		return {"kind": "ammo", "sub": ["5.56", "9mm", "7.62", "5.56", "9mm"][rng.randi() % 5]}
	if r < 0.72:
		return {"kind": "bandage" if rng.randf() < 0.7 else "medkit"}
	if r < 0.82:
		return {"kind": "vest", "lvl": 2 if (tier >= 2 and rng.randf() < 0.5) else 1}
	if r < 0.91:
		return {"kind": "helmet", "lvl": 2 if (tier >= 2 and rng.randf() < 0.5) else 1}
	return {"kind": "grenade"} if rng.randf() < 0.5 else {"kind": "smoke"}


func _loot_node(it: Dictionary) -> Node3D:
	var n: Node3D
	match it.kind:
		"weapon":
			n = Node3D.new()
			var w := Weapons.make(it.sub, models)
			w.rotation = Vector3(0, 0, PI / 2)
			w.position.y = 0.04
			n.add_child(w)
		"ammo":
			n = models.ammo_box.instantiate()
			n.scale = Vector3.ONE * 0.9
		"medkit":
			n = models.medical_box.instantiate()
			n.scale = Vector3.ONE * 0.8
		"grenade", "smoke":
			n = Node3D.new()
			var w := Weapons.make(it.kind, models)
			w.rotation.z = PI / 2
			w.position.y = 0.04
			n.add_child(w)
		_:
			n = Node3D.new()
			var mi := MeshInstance3D.new()
			var m := StandardMaterial3D.new()
			m.roughness = 0.8
			if it.kind == "vest":
				var bm := BoxMesh.new()
				bm.size = Vector3(0.42, 0.06, 0.5)
				mi.mesh = bm
				m.albedo_color = Color(0.14, 0.15, 0.17) if it.lvl >= 2 else Color(0.23, 0.24, 0.19)
				mi.position.y = 0.03
			elif it.kind == "helmet":
				var sm := SphereMesh.new()
				sm.radius = 0.15
				sm.height = 0.15
				sm.is_hemisphere = true
				mi.mesh = sm
				m.albedo_color = Color(0.18, 0.19, 0.2) if it.lvl >= 2 else Color(0.28, 0.31, 0.24)
				m.metallic = 0.3
			else:
				var cm := CylinderMesh.new()
				cm.top_radius = 0.04
				cm.bottom_radius = 0.04
				cm.height = 0.08
				mi.mesh = cm
				m.albedo_color = Color(0.91, 0.88, 0.82)
				mi.rotation.z = PI / 2
				mi.position.y = 0.04
			mi.material_override = m
			n.add_child(mi)
	return n


func spawn_loot(it: Dictionary, pos: Vector3) -> void:
	var g := world.get_height(pos.x, pos.z)
	pos.y = maxf(pos.y, g)
	it.node = _loot_node(it)
	world_root.add_child(it.node)
	it.node.global_position = pos
	it.node.rotation.y = rng.randf() * TAU
	it.pos = pos
	if it.kind == "weapon" and not it.has("mag"):
		it.mag = int(Weapons.DATA[it.sub].mag * rng.randf_range(0.3, 1.0))
	if it.kind == "ammo" and not it.has("amount"):
		it.amount = Weapons.AMMO_PACK[it.sub]
	loot.append(it)


func item_label(it: Dictionary) -> String:
	match it.kind:
		"weapon": return Weapons.DATA[it.sub].name
		"ammo": return "%s ammo ×%d" % [it.sub, it.amount]
		"bandage": return "Bandage"
		"medkit": return "Field medkit"
		"vest": return "Plate carrier L%d" % it.lvl
		"helmet": return "Combat helmet L%d" % it.lvl
		"grenade": return "Stick grenade"
		"smoke": return "Smoke canister"
	return ""


func pickup(a: Actor, it: Dictionary) -> bool:
	match it.kind:
		"weapon":
			var w := {"kind": it.sub, "mag": it.mag}
			var slot := 2
			if Weapons.DATA[it.sub].prim:
				slot = 0 if a.weapons[0] == null else (1 if a.weapons[1] == null else (1 if a.cur == 1 else 0))
			var old = a.weapons[slot]
			a.weapons[slot] = w
			if not a.is_player:
				a.ammo[Weapons.DATA[it.sub].ammo] += Weapons.DATA[it.sub].mag * 2
			if old:
				spawn_loot({"kind": "weapon", "sub": old.kind, "mag": old.mag}, a.global_position + Vector3(0.6, 0.2, 0.3))
			if a.cur < 0 or a.cur == slot or a.weapons[a.cur] == null:
				equip(a, slot)
		"ammo": a.ammo[it.sub] += it.amount
		"bandage": a.bandages += 3
		"medkit": a.medkits += 1
		"grenade": a.grenades += 1
		"smoke": a.smokes += 1
		"vest":
			if it.lvl < a.armor and a.armor_hp > 0:
				return false
			if a.armor:
				spawn_loot({"kind": "vest", "lvl": a.armor}, a.global_position + Vector3(-0.5, 0.2, 0.4))
			a.armor = it.lvl
			a.armor_hp = 220.0 if it.lvl == 2 else 160.0
		"helmet":
			if it.lvl < a.helmet and a.helmet_hp > 0:
				return false
			if a.helmet:
				spawn_loot({"kind": "helmet", "lvl": a.helmet}, a.global_position + Vector3(-0.5, 0.2, -0.4))
			a.helmet = it.lvl
			a.helmet_hp = 150.0 if it.lvl == 2 else 90.0
	it.node.queue_free()
	loot.erase(it)
	if a.is_player:
		audio.play2d("clunk", -6.0)
		hud.show_toast("Picked up " + item_label(it))
	return true


func equip(a: Actor, slot: int) -> void:
	if a.weapons[slot] == null:
		return
	a.cur = slot
	a.reload_t = 0.0
	a.bolt_t = 0.0
	a.set_weapon_model(a.weapons[slot].kind)


# ---------------------------------------------------------------- zone
func _next_zone() -> void:
	zone.phase += 1
	if zone.phase >= ZONE_PHASES.size():
		zone.stage = "final"
		return
	var P: Dictionary = ZONE_PHASES[zone.phase]
	var nc := Vector2.ZERO
	for i in 40:
		var ang := rng.randf() * TAU
		var d := rng.randf() * maxf(0.0, 300.0 if zone.phase == 0 else zone.r - P.r)
		nc = zone.c + Vector2(cos(ang), sin(ang)) * d
		if world.get_height(nc.x, nc.y) > 2.0:
			break
	zone.nc = nc
	zone.nr = P.r
	zone.stage = "wait"
	zone.t = P.delay
	zone.shrink = P.shrink
	zone.P = P
	zone.c0 = zone.c
	zone.r0 = zone.r


func _update_zone(delta: float) -> void:
	if zone.stage == "final":
		return
	zone.t -= delta
	if zone.stage == "wait" and zone.t <= 0.0:
		zone.stage = "shrink"
		zone.t = zone.P.shrink
		hud.show_toast("The firestorm is closing in")
	elif zone.stage == "shrink":
		var k: float = 1.0 - maxf(0.0, zone.t) / zone.P.shrink
		zone.c = (zone.c0 as Vector2).lerp(zone.nc, k)
		zone.r = lerpf(zone.r0, zone.nr, k)
		zone.dps = zone.P.dps
		if zone.t <= 0.0:
			_next_zone()
	zone_mesh.position = Vector3(zone.c.x, 300, zone.c.y)
	zone_mesh.scale = Vector3(maxf(zone.r, 0.1), 1, maxf(zone.r, 0.1))


func outside_zone(p: Vector3) -> bool:
	return Vector2(p.x - zone.c.x, p.z - zone.c.y).length() > zone.r


# ---------------------------------------------------------------- combat
func fire(a: Actor, dir: Vector3, origin: Vector3) -> bool:
	var w = a.weapon()
	if w == null:
		return false
	var W: Dictionary = Weapons.DATA[w.kind]
	if time - a.last_shot < 60.0 / W.rpm or a.reload_t > 0 or a.bolt_t > 0 or a.heal_t > 0:
		return false
	if w.mag <= 0:
		if a.is_player:
			audio.play2d("click", -8.0)
		return false
	w.mag -= 1
	a.last_shot = time
	if W.scope:
		a.bolt_t = 60.0 / W.rpm
	var moving := Vector2(a.velocity.x, a.velocity.z).length()
	var spread: float = (W.ads if a.ads else W.spread) * (1.0 + moving * 0.12) * (0.75 if a.crouch else 1.0)
	var d := (dir + Vector3(rng.randf() - 0.5, rng.randf() - 0.5, rng.randf() - 0.5) * 2.0 * spread).normalized()
	bullets.append({"p": origin, "v": d * W.vel, "owner": a, "dmg": W.dmg, "kind": w.kind, "life": 2.5, "trav": 0.0, "whiz": false, "tracer": a.is_player or rng.randf() < 0.45})
	var mz := a.muzzle_world()
	var dist := mz.distance_to(camera.global_position)
	if a.is_player:
		audio.play2d("shot_" + w.kind, -2.0)
	else:
		audio.play3d(("far_" if dist > 150.0 else "shot_") + w.kind, mz, 4.0)
	if dist < 140.0:
		fx.muzzle(mz, d, not (a.is_player and a.ads and W.scope))
		if dist < 45.0 and w.kind != "marksman" and a.gun:
			var b: Basis = a.gun.global_transform.basis
			fx.casing(mz - b.z * -0.55 + b.x * 0.04, b.x.normalized(), b.y.normalized())
	if a.is_player:
		recoil_kick += W.recoil
		cam_pitch += W.recoil * (0.55 if a.ads else 0.8) * (0.8 if a.crouch else 1.0)
		cam_yaw += (rng.randf() - 0.5) * W.recoil * 0.5
		if w.mag == 0 and ammo_for(a) > 0:
			get_tree().create_timer(0.25).timeout.connect(func(): reload(a))
	return true


func ammo_for(a: Actor) -> int:
	var w = a.weapon()
	return a.ammo[Weapons.DATA[w.kind].ammo] if w else 0


func reload(a: Actor) -> void:
	var w = a.weapon()
	if w == null or a.reload_t > 0:
		return
	var W: Dictionary = Weapons.DATA[w.kind]
	if w.mag >= W.mag or a.ammo[W.ammo] <= 0:
		return
	a.reload_t = W.reload
	a.heal_t = 0.0
	a.ads = false
	if a.is_player or a.global_position.distance_to(camera.global_position) < 30.0:
		audio.play3d("clunk", a.global_position + Vector3.UP, -6.0)


func _finish_reload(a: Actor) -> void:
	var w = a.weapon()
	if w == null:
		return
	var W: Dictionary = Weapons.DATA[w.kind]
	var take := mini(W.mag - w.mag, a.ammo[W.ammo])
	w.mag += take
	a.ammo[W.ammo] -= take


func start_heal(a: Actor) -> void:
	if a.heal_t > 0 or a.reload_t > 0:
		return
	if a.medkits > 0 and a.hp < 90:
		a.heal_kind = "medkit"
		a.heal_t = 6.0
	elif a.bandages > 0 and a.hp < 75:
		a.heal_kind = "bandage"
		a.heal_t = 3.5
	else:
		if a.is_player:
			hud.show_toast("Bandages only heal up to 75" if (a.hp >= 75 and a.bandages > 0) else "No medical supplies")
		return
	a.heal_max = a.heal_t
	a.ads = false


func _update_timers(a: Actor, delta: float) -> void:
	if a.reload_t > 0:
		a.reload_t -= delta
		if a.reload_t <= 0:
			a.reload_t = 0.0
			_finish_reload(a)
	if a.bolt_t > 0:
		a.bolt_t -= delta
	if a.heal_t > 0:
		a.heal_t -= delta
		if a.heal_t <= 0:
			a.heal_t = 0.0
			if a.heal_kind == "medkit":
				a.medkits -= 1
				a.hp = 100.0
			else:
				a.bandages -= 1
				a.hp = minf(75.0, a.hp + 15.0)


func throw_grenade(a: Actor, dir: Vector3, smoke := false) -> void:
	if a.state != "ground":
		return
	if smoke:
		if a.smokes <= 0:
			return
		a.smokes -= 1
	else:
		if a.grenades <= 0:
			return
		a.grenades -= 1
	var node := Weapons.make("smoke" if smoke else "grenade", models)
	world_root.add_child(node)
	var p := a.eye_pos() + dir * 0.6
	node.global_position = p
	grenades_live.append({"node": node, "p": p, "v": dir * 17.0 + Vector3(0, 4, 0) + a.velocity, "t": 1.8 if smoke else 4.2, "smoke": smoke, "owner": a, "spin": Vector3(randf() * 10, randf() * 10, 0)})


func _update_grenades(delta: float) -> void:
	for i in range(grenades_live.size() - 1, -1, -1):
		var g: Dictionary = grenades_live[i]
		g.t -= delta
		g.v.y -= 9.81 * delta
		var np: Vector3 = g.p + g.v * delta
		var hit := _ray(g.p, np, 1, [])
		if not hit.is_empty():
			var n: Vector3 = hit.normal
			g.v = (g.v as Vector3).bounce(n) * 0.38
			g.p = hit.position + n * 0.05
		else:
			g.p = np
		g.node.global_position = g.p
		g.node.rotation += g.spin * delta * minf(1.0, (g.v as Vector3).length() / 4.0)
		if g.t <= 0.0:
			g.node.queue_free()
			grenades_live.remove_at(i)
			if g.smoke:
				fx.smoke_grenade(g.p)
				audio.play3d("clunk", g.p)
			else:
				_explode(g.p, g.owner)


func _explode(p: Vector3, owner: Actor) -> void:
	fx.explosion(p)
	audio.play3d("explosion", p, 10.0)
	var d := p.distance_to(camera.global_position)
	if d < 40.0:
		shake = maxf(shake, (40.0 - d) / 40.0 * 1.2)
	for a in actors:
		if not a.alive or a.state != "ground":
			continue
		var c: Vector3 = a.global_position + Vector3.UP
		var dd := c.distance_to(p)
		if dd > 9.0:
			continue
		if not line_clear(p + Vector3.UP * 0.3, c, [a.get_rid()]):
			continue
		damage(a, roundf(130.0 * pow(1.0 - dd / 9.0, 1.4)), owner, "body", "Stick grenade", true)


func _ray(from: Vector3, to: Vector3, mask: int, exclude: Array) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, to, mask, exclude)
	q.hit_back_faces = false
	return get_world_3d().direct_space_state.intersect_ray(q)


func line_clear(a: Vector3, b: Vector3, exclude: Array) -> bool:
	return _ray(a, b, 1, exclude).is_empty()


func _update_bullets(delta: float) -> void:
	for i in range(bullets.size() - 1, -1, -1):
		var b: Dictionary = bullets[i]
		var remaining := delta
		var dead := false
		var start: Vector3 = b.p
		while remaining > 0.0 and not dead:
			var h := minf(remaining, 1.0 / 90.0)
			remaining -= h
			var prev: Vector3 = b.p
			b.v.y -= 9.81 * h
			b.v *= 1.0 - 0.06 * h
			var nxt: Vector3 = prev + b.v * h
			var hit := _ray(prev, nxt, 1 | 2, [b.owner.get_rid()])
			if not hit.is_empty():
				var col: Object = hit.collider
				var pt: Vector3 = hit.position
				if col is Actor:
					var t: Actor = col
					var part := "head" if pt.y > t.global_position.y + t.height - 0.3 else "body"
					var falloff := clampf(1.0 - (b.trav - 120.0) / 900.0, 0.55, 1.0)
					damage(t, b.dmg * falloff, b.owner, part, Weapons.DATA[b.kind].name)
					fx.blood(pt, (b.v as Vector3).normalized())
				else:
					var mat: String = col.get_meta("mat", "stone") if col else "stone"
					var water: bool = pt.y < 0.05 and mat == "ground"
					if water:
						fx.burst(pt, {"n": 10, "life": 0.8, "v0": 4.0, "dir": Vector3.UP, "spread": 20.0, "size": 0.15, "grow": 2.0, "rise": -9.0, "c0": Color(0.8, 0.85, 0.88, 0.7), "c1": Color(0.8, 0.85, 0.88, 0)})
					else:
						fx.impact(pt, hit.normal, mat, mat != "ground")
					if pt.distance_to(camera.global_position) < 80.0:
						audio.play3d("impact_metal" if mat == "metal" else "impact", pt, -6.0)
				b.p = pt
				dead = true
			else:
				b.trav += prev.distance_to(nxt)
				b.p = nxt
				if not b.whiz and b.owner != player and player.alive:
					var c := player.global_position + Vector3.UP * 1.4
					if Geometry3D.get_closest_point_to_segment(c, prev, nxt).distance_to(c) < 2.5:
						b.whiz = true
						audio.play3d("whiz", c, 0.0)
		b.life -= delta
		if b.tracer:
			fx.tracer(start, b.p)
		if dead or b.life <= 0.0 or (b.p as Vector3).y < -20.0:
			bullets.remove_at(i)


func damage(t: Actor, dmg: float, src: Actor, part: String, weapon: String, explosive := false) -> void:
	if not t.alive:
		return
	var d := dmg
	if part == "head":
		d *= 2.3
		if t.helmet and t.helmet_hp > 0:
			var red := 0.45 if t.helmet == 2 else 0.32
			t.helmet_hp -= d * red
			d *= 1.0 - red
			if t.helmet_hp <= 0:
				t.helmet = 0
	elif not explosive and t.armor and t.armor_hp > 0:
		var red := 0.42 if t.armor == 2 else 0.3
		t.armor_hp -= d * red
		d *= 1.0 - red
		if t.armor_hp <= 0:
			t.armor = 0
	t.hp -= d
	t.heal_t = 0.0
	if src and src != t:
		src.dmg_dealt += minf(d, t.hp + d)
		if t.ai and t.ai.enemy == null:
			t.ai.enemy = src
			t.ai.react = 0.3
	if t.ai and t.smokes > 0 and t.hp < 45 and t.hp > 0 and src:
		var away := (src.global_position - t.global_position)
		away.y = 0
		throw_grenade(t, (away.normalized() + Vector3(0, 0.15, 0)).normalized(), true)
	if src == player:
		hud.hit_marker(part == "head", t.hp <= 0)
		audio.play2d("hit", -10.0)
	if t == player:
		damage_flash = minf(1.0, damage_flash + d / 40.0)
	if t.hp <= 0:
		_kill(t, src, weapon, part == "head")


func _kill(t: Actor, src: Actor, weapon: String, head: bool) -> void:
	t.die()
	if src and src != t:
		src.kills += 1
	var alive := 0
	for a in actors:
		if a.alive:
			alive += 1
	var txt := ("%s  ›  %s  %s" % [src.actor_name, weapon, t.actor_name]) if (src and src != t) else ("%s  ·  %s" % [t.actor_name, weapon])
	hud.add_feed(txt, src == player or t == player)
	if src == player:
		hud.show_toast("Eliminated %s%s · %d left" % [t.actor_name, " (headshot)" if head else "", alive])
	var drops := []
	for w in t.weapons:
		if w:
			drops.append({"kind": "weapon", "sub": w.kind, "mag": w.mag})
	for k in t.ammo.keys():
		if t.ammo[k] > 0:
			drops.append({"kind": "ammo", "sub": k, "amount": t.ammo[k]})
	if t.medkits: drops.append({"kind": "medkit"})
	if t.bandages: drops.append({"kind": "bandage"})
	if t.armor: drops.append({"kind": "vest", "lvl": t.armor})
	if t.helmet: drops.append({"kind": "helmet", "lvl": t.helmet})
	if t.grenades: drops.append({"kind": "grenade"})
	if t.smokes: drops.append({"kind": "smoke"})
	for i in drops.size():
		var ang := float(i) / drops.size() * TAU
		spawn_loot(drops[i], t.global_position + Vector3(cos(ang) * 0.9, 0.3, sin(ang) * 0.9))
	if t == player:
		get_tree().create_timer(1.8).timeout.connect(func(): _end_match(false))
	elif alive == 1 and player.alive:
		get_tree().create_timer(1.5).timeout.connect(func(): _end_match(true))


func _end_match(win: bool) -> void:
	if ended:
		return
	ended = true
	state = "ended"
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var alive := 0
	for a in actors:
		if a.alive:
			alive += 1
	hud.show_end(win, 1 if win else alive + 1, actors.size(), player.kills, player.dmg_dealt, time)


func jump_actor(a: Actor) -> void:
	if a.state != "plane":
		return
	a.jump_from_plane(plane_pos() + Vector3(0, -4, 0) + flight.dir * 14.0, flight.dir * flight.speed * 0.5)
	if a.is_player:
		hud.show_toast("Freefall: W to dive, F to open the canopy")


func on_landed(a: Actor) -> void:
	if a.is_player:
		hud.show_toast("Landed. Find a weapon.")


func footstep(a: Actor) -> void:
	var d := a.global_position.distance_to(camera.global_position)
	if d < 45.0:
		var on_wood: bool = a.global_position.y > world.get_height(a.global_position.x, a.global_position.z) + 0.15
		audio.play3d("step_wood" if on_wood else "step", a.global_position, -12.0 if a.is_player else -4.0)


func plane_pos() -> Vector3:
	return flight.a + flight.dir * plane_t * flight.speed


func plane_visible() -> bool:
	return plane.visible


func view_center() -> Vector3:
	return plane_pos() if player.state == "plane" else player.global_position


func prompt_text() -> String:
	var key := "USE" if hud.touch.visible else "F"
	if player.state == "plane":
		return "[%s] Jump from the transport" % key
	if player.state == "ground" and near_item != null and player.alive:
		return "[%s] %s" % [key, item_label(near_item)]
	if player.state == "air" and player.free_t > 1.0:
		return "[%s] Open canopy · %d m" % [key, int(player.global_position.y - world.get_height(player.global_position.x, player.global_position.z))]
	if player.state == "chute":
		return "Altitude %d m" % int(player.global_position.y - world.get_height(player.global_position.x, player.global_position.z))
	return ""


# ---------------------------------------------------------------- input
func _unhandled_input(e: InputEvent) -> void:
	if state != "playing":
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_look(e.relative)
	elif e is InputEventMouseButton:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not hud.touch.visible:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		if e.button_index == MOUSE_BUTTON_LEFT:
			fire_held = e.pressed
		elif e.button_index == MOUSE_BUTTON_RIGHT and e.pressed:
			_toggle_ads()
		elif e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if e.pressed:
				_cycle_weapon(1 if e.button_index == MOUSE_BUTTON_WHEEL_DOWN else -1)
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.physical_keycode:
			KEY_F: _interact()
			KEY_R: reload(player)
			KEY_C, KEY_CTRL: player.crouch = not player.crouch
			KEY_V: view_mode = "fpp" if view_mode == "tpp" else "tpp"
			KEY_1: equip(player, 0)
			KEY_2: equip(player, 1)
			KEY_3: equip(player, 2)
			KEY_G: throw_grenade(player, _aim_dir())
			KEY_T: throw_grenade(player, _aim_dir(), true)
			KEY_H: start_heal(player)
			KEY_M: hud.bigmap.visible = not hud.bigmap.visible
			KEY_ESCAPE: Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif e is InputEventScreenTouch:
		var half := get_viewport().get_visible_rect().size.x * 0.45
		if e.pressed:
			if e.position.x < half and stick_id < 0:
				stick_id = e.index
				look_last = e.position
				set_meta("stick_origin", e.position)
			elif look_id < 0:
				look_id = e.index
				look_last = e.position
		else:
			if e.index == stick_id:
				stick_id = -1
				touch_move = Vector2.ZERO
				hud.set_stick(Vector2.ZERO)
			if e.index == look_id:
				look_id = -1
	elif e is InputEventScreenDrag:
		if e.index == stick_id:
			var o: Vector2 = get_meta("stick_origin")
			var v: Vector2 = (e.position - o) / 60.0
			if v.length() > 1.0:
				v = v.normalized()
			touch_move = v
			hud.set_stick(v)
		elif e.index == look_id:
			_look(e.relative * 1.6)


func _look(rel: Vector2) -> void:
	var w = player.weapon() if player else null
	var s: float = settings.sens * 0.0022 * ((1.0 / Weapons.DATA[w.kind].zoom) if (player.ads and w) else 1.0)
	cam_yaw -= rel.x * s
	cam_pitch = clampf(cam_pitch - rel.y * s, -1.45, 1.45)


func _on_touch_button(n: String) -> void:
	if state != "playing":
		return
	match n:
		"FIRE": fire_held = true
		"FIRE_UP": fire_held = false
		"AIM": _toggle_ads()
		"JUMP":
			if player.state == "ground":
				set_meta("touch_jump", 0.15)
			else:
				_interact()
		"DUCK": player.crouch = not player.crouch
		"RLD": reload(player)
		"USE": _interact()
		"HEAL": start_heal(player)
		"NADE": throw_grenade(player, _aim_dir())
		"SMOKE": throw_grenade(player, _aim_dir(), true)
		"VIEW": view_mode = "fpp" if view_mode == "tpp" else "tpp"
		"MAP": hud.bigmap.visible = not hud.bigmap.visible
		"SWAP": _cycle_weapon(1)


func _toggle_ads() -> void:
	if player.state != "ground" or player.weapon() == null or player.reload_t > 0 or player.heal_t > 0:
		player.ads = false
		return
	player.ads = not player.ads


func _cycle_weapon(d: int) -> void:
	var slots := []
	for s in 3:
		if player.weapons[s]:
			slots.append(s)
	if slots.is_empty():
		return
	var i := slots.find(player.cur)
	equip(player, slots[posmod(i + d, slots.size())])


func _interact() -> void:
	if player.state == "plane":
		jump_actor(player)
	elif player.state == "air" and player.free_t > 1.0:
		player.open_chute()
	elif player.state == "ground" and near_item != null:
		pickup(player, near_item)


func _aim_dir() -> Vector3:
	return -camera.global_transform.basis.z


# ---------------------------------------------------------------- loop
func _physics_process(delta: float) -> void:
	if state != "playing" and state != "ended":
		return
	if state == "playing":
		time += delta
	# transport
	if plane.visible:
		plane_t += delta
		plane.global_position = plane_pos()
		plane.rotation.y = atan2(-flight.dir.x, -flight.dir.z)
		for p in plane.get_meta("props"):
			p.rotation.z += delta * 40.0
		var pd := plane_pos().distance_to(camera.global_position)
		audio.engine.volume_db = -6.0 if player.state == "plane" else linear_to_db(maxf(0.0001, 0.5 - pd / 3000.0))
		if plane_t * flight.speed > flight.len:
			for a in actors:
				if a.state == "plane":
					jump_actor(a)
			if plane_t * flight.speed > flight.len + 600.0:
				plane.visible = false
				audio.engine.volume_db = -80.0
	if state != "playing":
		return
	_update_zone(delta)
	_update_player(delta)
	for a in actors:
		if a.is_player or not a.alive:
			continue
		var inp: Dictionary = a.ai.update(delta)
		if a.state == "ground":
			_update_timers(a, delta)
			if outside_zone(a.global_position):
				a.hp -= zone.dps * delta
				if a.hp <= 0:
					_kill(a, null, "the firestorm", false)
		if a.state != "plane" and a.alive:
			a.move_actor(delta, inp)
		elif a.state == "plane":
			a.global_position = plane_pos()
	_update_bullets(delta)
	_update_grenades(delta)


func _update_player(delta: float) -> void:
	var p := player
	if recoil_kick > 0.0:
		var r := minf(recoil_kick, delta * 0.08)
		cam_pitch -= r * 0.5
		recoil_kick -= r
	var fz := 0.0
	var fx_in := 0.0
	if Input.is_physical_key_pressed(KEY_W): fz += 1.0
	if Input.is_physical_key_pressed(KEY_S): fz -= 1.0
	if Input.is_physical_key_pressed(KEY_D): fx_in += 1.0
	if Input.is_physical_key_pressed(KEY_A): fx_in -= 1.0
	fz = clampf(fz - touch_move.y, -1, 1)
	fx_in = clampf(fx_in + touch_move.x, -1, 1)
	var sprint := Input.is_physical_key_pressed(KEY_SHIFT) or touch_move.y < -0.95
	var tj: float = get_meta("touch_jump", 0.0)
	if tj > 0.0:
		set_meta("touch_jump", tj - delta)
	var jump := Input.is_physical_key_pressed(KEY_SPACE) or tj > 0.0
	if p.state == "plane":
		p.global_position = plane_pos()
		return
	if not p.alive:
		return
	p.yaw = cam_yaw
	p.pitch = cam_pitch
	var lean_in := 0.0
	if p.state == "ground":
		lean_in = (1.0 if Input.is_physical_key_pressed(KEY_E) else 0.0) - (1.0 if Input.is_physical_key_pressed(KEY_Q) else 0.0)
	p.lean = lerpf(p.lean, lean_in, 1.0 - exp(-delta * 10.0))
	p.move_actor(delta, {"fx": fx_in, "fz": fz, "sprint": sprint, "jump": jump})
	_update_timers(p, delta)
	var w = p.weapon()
	if fire_held and w and p.state == "ground" and not hud.bigmap.visible:
		var ok := fire(p, _aim_dir(), camera.global_position if (view_mode == "fpp" or p.ads) else p.eye_pos())
		if ok and not Weapons.DATA[w.kind].auto:
			fire_held = false
	if p.ads and (p.state != "ground" or (sprint and fz > 0.5)):
		p.ads = false
	near_item = null
	if p.state == "ground":
		var best := 6.0
		var ad := _aim_dir()
		for it in loot:
			var dv: Vector3 = it.pos - p.global_position
			if absf(dv.y) > 1.6:
				continue
			var d2 := dv.x * dv.x + dv.z * dv.z + dv.y * dv.y * 0.5
			if d2 > 6.0:
				continue
			var score := d2 - (dv.x * ad.x + dv.z * ad.z) * 0.8
			if score < best:
				best = score
				near_item = it
		if outside_zone(p.global_position):
			p.hp -= zone.dps * delta
			if p.hp <= 0:
				_kill(p, null, "the firestorm", false)


func _process(delta: float) -> void:
	if state != "playing" and state != "ended":
		return
	_update_camera(delta)
	for a in actors:
		if a.state == "plane":
			a.gun_socket.visible = false
			continue
		var far: float = a.global_position.distance_to(camera.global_position)
		if not a.is_player:
			a.visible = far < 700.0
		var fpp_body: bool = a.is_player and view_mode == "fpp" and a.state == "ground" and a.alive
		a.place_gun(delta, camera, a.is_player and (view_mode == "fpp" or a.ads), recoil_kick, bob)
		a.animate(delta, fpp_body)
	if world.grass_mat:
		world.grass_mat.set_shader_parameter("player_pos", view_center())
	damage_flash = maxf(0.0, damage_flash - delta * 1.4)
	if state == "playing":
		hud.update_hud(delta, player)
	# keep the shadow cascades centred on the camera (directional light only needs a direction)
	sun.global_position = camera.global_position


func _update_camera(delta: float) -> void:
	var p := player
	var fov: float = settings.fov
	if p.state == "plane":
		var pp := plane_pos()
		var off := Vector3(sin(cam_yaw) * cos(cam_pitch), -sin(cam_pitch) + 0.15, cos(cam_yaw) * cos(cam_pitch)) * 48.0
		camera.global_position = pp + off
		camera.look_at(pp, Vector3.UP)
	elif not p.alive:
		var tgt := p.global_position + Vector3.UP * 0.6
		set_meta("death_cam", get_meta("death_cam", 0.0) + delta * 0.2)
		var dc: float = get_meta("death_cam")
		camera.global_position = tgt + Vector3(sin(dc) * 6.0, 3.5, cos(dc) * 6.0)
		camera.look_at(tgt, Vector3.UP)
	else:
		var fpp := view_mode == "fpp" or p.ads
		var right := Vector3(cos(p.yaw), 0, -sin(p.yaw))
		var basis := Basis.from_euler(Vector3(cam_pitch, cam_yaw, -p.lean * 0.14), EULER_ORDER_YXZ)
		if fpp and p.state == "ground":
			var sp := Vector2(p.velocity.x, p.velocity.z).length()
			bob += delta * sp * 1.9
			var eye := p.global_position + Vector3(0, p.height - 0.1, 0) + right * p.lean * 0.38
			eye.y += sin(bob * 2.0) * 0.025 * minf(1.0, sp / 5.0) * (0.3 if p.ads else 1.0) - absf(p.lean) * 0.08
			camera.global_transform = Transform3D(basis, eye)
		else:
			var back := basis.z
			var air := p.state != "ground"
			var piv := p.global_position + Vector3(0, (p.height if p.state == "ground" else 1.7) + 0.05, 0)
			var want := piv + right * (0.0 if air else 0.62) + back * ((9.0 if p.state == "chute" else 6.0) if air else 2.1) + Vector3(0, 1.0 if air else -0.05, 0)
			var hit := _ray(piv, want, 1, [p.get_rid()])
			if not hit.is_empty():
				want = piv.lerp(hit.position, maxf(0.0, (piv.distance_to(hit.position) - 0.3) / piv.distance_to(want)))
			camera.global_transform = Transform3D(basis, want)
		var w = p.weapon()
		if p.ads and w:
			fov = settings.fov / Weapons.DATA[w.kind].zoom
	if shake > 0.0:
		camera.global_position += Vector3(randf() - 0.5, randf() - 0.5, 0) * shake * 0.2
		shake -= delta * 1.5
	camera.fov = lerpf(camera.fov, fov, 1.0 - exp(-delta * 14.0))
	if use_dof:
		var w2 = p.weapon()
		cam_attr.dof_blur_far_enabled = p.alive and p.ads and w2 != null and not Weapons.DATA[w2.kind].scope
