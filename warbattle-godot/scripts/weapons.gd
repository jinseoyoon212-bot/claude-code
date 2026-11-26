class_name Weapons
extends RefCounted
## Weapon stats and held-weapon models. Muzzle points along -Z; meta holds grip points for the hands.

const DATA := {
	"carbine": {"name": "KR-9 Carbine", "ammo": "5.56", "mag": 30, "rpm": 720, "dmg": 41.0, "vel": 870.0, "auto": true, "spread": 0.014, "ads": 0.0012, "recoil": 0.011, "reload": 2.4, "zoom": 1.4, "prim": true, "scope": false},
	"smg": {"name": "VX-45 SMG", "ammo": "9mm", "mag": 32, "rpm": 900, "dmg": 27.0, "vel": 380.0, "auto": true, "spread": 0.018, "ads": 0.004, "recoil": 0.007, "reload": 2.0, "zoom": 1.25, "prim": true, "scope": false},
	"marksman": {"name": "Halden M62", "ammo": "7.62", "mag": 5, "rpm": 42, "dmg": 88.0, "vel": 790.0, "auto": false, "spread": 0.025, "ads": 0.0002, "recoil": 0.045, "reload": 3.4, "zoom": 4.0, "prim": true, "scope": true},
	"pistol": {"name": "P-11 Sidearm", "ammo": "9mm", "mag": 15, "rpm": 420, "dmg": 31.0, "vel": 360.0, "auto": false, "spread": 0.016, "ads": 0.004, "recoil": 0.022, "reload": 1.6, "zoom": 1.15, "prim": false, "scope": false},
}
const AMMO_PACK := {"5.56": 30, "9mm": 30, "7.62": 10}

static var _mats := {}


static func mat(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"gunmetal": m.albedo_color = Color(0.17, 0.18, 0.19); m.metallic = 0.85; m.roughness = 0.38
		"polymer": m.albedo_color = Color(0.105, 0.11, 0.115); m.roughness = 0.62
		"tan": m.albedo_color = Color(0.54, 0.48, 0.36); m.roughness = 0.65
		"glass": m.albedo_color = Color(0.13, 0.2, 0.27); m.metallic = 0.9; m.roughness = 0.05
		"red": m.albedo_color = Color(1, 0.16, 0.1); m.emission_enabled = true; m.emission = Color(1, 0.1, 0.05); m.emission_energy_multiplier = 4.0; m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"canister": m.albedo_color = Color(0.3, 0.35, 0.27); m.metallic = 0.4; m.roughness = 0.55
		"band": m.albedo_color = Color(0.85, 0.84, 0.8); m.roughness = 0.6
	_mats[key] = m
	return m


static func _box(parent: Node3D, size: Vector3, m: String, pos: Vector3, rot := Vector3.ZERO, bevel := true) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat(m)
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)


static func _cyl(parent: Node3D, r: float, h: float, m: String, pos: Vector3, along_z := true) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = 14
	mi.mesh = cm
	mi.material_override = mat(m)
	mi.position = pos
	if along_z:
		mi.rotation.x = PI / 2
	parent.add_child(mi)


# Instance an imported model, centre it and lay its longest axis along Z at the given length.
static func normalized(scene: PackedScene, length: float, flip := false) -> Node3D:
	var inst: Node3D = scene.instantiate()
	var aabb := _aabb(inst)
	var wrap := Node3D.new()
	wrap.add_child(inst)
	inst.position = -aabb.get_center()
	var s := aabb.size
	if s.x >= s.y and s.x >= s.z:
		wrap.rotation.y = PI / 2
	elif s.y >= s.x and s.y >= s.z:
		wrap.rotation.x = PI / 2
	if flip:
		wrap.rotation.y += PI
	var outer := Node3D.new()
	outer.add_child(wrap)
	outer.scale = Vector3.ONE * (length / maxf(s.x, maxf(s.y, s.z)))
	return outer


static func _aabb(n: Node) -> AABB:
	var out := AABB()
	var first := true
	var stack := [[n, Transform3D()]]
	while not stack.is_empty():
		var e: Array = stack.pop_back()
		var c: Node = e[0]
		var xf: Transform3D = e[1]
		if c is Node3D and c != n:
			xf = xf * (c as Node3D).transform
		if c is MeshInstance3D and (c as MeshInstance3D).mesh:
			var a: AABB = xf * (c as MeshInstance3D).mesh.get_aabb()
			out = a if first else out.merge(a)
			first = false
		for k in c.get_children():
			stack.append([k, xf])
	return out


static func make(kind: String, models: Dictionary) -> Node3D:
	var g := Node3D.new()
	match kind:
		"carbine", "smg":
			var L := 1.0 if kind == "carbine" else 0.74
			var furn := "tan" if kind == "carbine" else "polymer"
			_box(g, Vector3(0.058, 0.07, 0.34 * L), "gunmetal", Vector3(0, 0.045, -0.06))
			_box(g, Vector3(0.054, 0.05, 0.22 * L), "gunmetal", Vector3(0, -0.005, -0.04))
			_box(g, Vector3(0.026, 0.012, 0.48 * L), "gunmetal", Vector3(0, 0.087, -0.16))
			for i in int(22 * L):
				_box(g, Vector3(0.03, 0.006, 0.008), "gunmetal", Vector3(0, 0.096, 0.07 - i * 0.021))
			var hgL := 0.32 * L
			var hgZ := -0.23 - hgL / 2.0
			_box(g, Vector3(0.066, 0.068, hgL), furn, Vector3(0, 0.04, hgZ))
			for i in 5:
				for sx in [-1, 1]:
					_box(g, Vector3(0.004, 0.016, 0.03), "polymer", Vector3(sx * 0.033, 0.04, hgZ - hgL / 2.0 + 0.04 + i * hgL / 5.5))
			_cyl(g, 0.011, 0.22 * L + 0.06, "gunmetal", Vector3(0, 0.04, hgZ - hgL / 2.0 - 0.08 * L))
			var mzZ := hgZ - hgL / 2.0 - 0.2 * L
			_cyl(g, 0.018, 0.07, "polymer", Vector3(0, 0.04, mzZ))
			var magH := 0.2 if kind == "smg" else 0.18
			_box(g, Vector3(0.036, magH, 0.075), "polymer" if kind == "carbine" else "gunmetal", Vector3(0, -0.03 - magH / 2.0, -0.1), Vector3(0.05 if kind == "smg" else 0.28, 0, 0))
			_box(g, Vector3(0.036, 0.11, 0.05), furn, Vector3(0, -0.07, 0.07), Vector3(-0.32, 0, 0))
			_cyl(g, 0.016, 0.16, "gunmetal", Vector3(0, 0.04, 0.19))
			_box(g, Vector3(0.05, 0.09, 0.17), furn, Vector3(0, 0.02, 0.27))
			_box(g, Vector3(0.054, 0.12, 0.025), "polymer", Vector3(0, 0.0, 0.36))
			_box(g, Vector3(0.036, 0.028, 0.07), "polymer", Vector3(0, 0.108, -0.04))
			_cyl(g, 0.022, 0.05, "polymer", Vector3(0, 0.14, -0.05))
			_box(g, Vector3(0.03, 0.03, 0.002), "glass", Vector3(0, 0.14, -0.06))
			_box(g, Vector3(0.004, 0.004, 0.001), "red", Vector3(0, 0.14, -0.058))
			if kind == "carbine":
				_cyl(g, 0.015, 0.08, "polymer", Vector3(0, -0.02, hgZ - 0.03), false)
			g.set_meta("muzzle", Vector3(0, 0.04, mzZ - 0.04))
			g.set_meta("sight_y", 0.14)
			g.set_meta("grip", Vector3(0, -0.07, 0.08))
			g.set_meta("fore", Vector3(0, 0.0, hgZ))
		"marksman":
			var m := normalized(models.bolt_action_rifle_7_62, 1.12)
			m.position.z = -0.2
			g.add_child(m)
			_cyl(g, 0.022, 0.3, "gunmetal", Vector3(0, 0.1, -0.12))
			_cyl(g, 0.03, 0.06, "gunmetal", Vector3(0, 0.1, -0.29))
			g.set_meta("muzzle", Vector3(0, 0.03, -0.78))
			g.set_meta("sight_y", 0.1)
			g.set_meta("grip", Vector3(0, -0.04, 0.12))
			g.set_meta("fore", Vector3(0, -0.01, -0.32))
		"pistol":
			g.add_child(normalized(models.service_pistol, 0.2))
			g.set_meta("muzzle", Vector3(0, 0.03, -0.12))
			g.set_meta("sight_y", 0.06)
			g.set_meta("grip", Vector3(0, -0.05, 0.04))
			g.set_meta("fore", Vector3(-0.02, -0.06, 0.03))
		"grenade":
			var m := normalized(models.stick_grenade, 0.35)
			m.rotation.x = -0.6
			g.add_child(m)
			g.set_meta("muzzle", Vector3(0, 0, -0.2))
			g.set_meta("sight_y", 0.05)
			g.set_meta("grip", Vector3(0, 0, 0.05))
			g.set_meta("fore", Vector3(-0.1, -0.05, 0.05))
		"smoke":
			_cyl(g, 0.032, 0.13, "canister", Vector3.ZERO, false)
			_cyl(g, 0.033, 0.02, "band", Vector3(0, 0.03, 0), false)
			_cyl(g, 0.022, 0.02, "gunmetal", Vector3(0, 0.075, 0), false)
			_box(g, Vector3(0.012, 0.09, 0.008), "gunmetal", Vector3(0.034, 0.03, 0))
			g.set_meta("muzzle", Vector3(0, 0, -0.1))
			g.set_meta("sight_y", 0.05)
			g.set_meta("grip", Vector3(0, 0, 0.03))
			g.set_meta("fore", Vector3(-0.08, -0.04, 0.03))
	_shadows(g)
	return g


static func _shadows(n: Node) -> void:
	if n is GeometryInstance3D:
		(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for c in n.get_children():
		_shadows(c)
