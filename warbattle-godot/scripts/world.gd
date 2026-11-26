class_name World
extends Node3D
## Kestrel Island: terrain, roads, towns, buildings, forests, grass and props.

const MAP_SIZE := 1600.0
const HALF := 800.0
const N := 256
const CELL := MAP_SIZE / N
const TOWN_NAMES := ["Harrowgate", "Millbrook", "Stonereach", "Pike Landing", "Eastmoor", "Copper Quarry", "Fenwick", "Ridgeback Base", "Larkspur", "Old Saltworks"]

var quality := "high"
var heights := PackedFloat32Array()
var splat := PackedColorArray()
var rng := RandomNumberGenerator.new()
var n_coast := FastNoiseLite.new()
var n_hills := FastNoiseLite.new()
var n_ridge := FastNoiseLite.new()
var n_detail := FastNoiseLite.new()
var n_forest := FastNoiseLite.new()
var n_tint := FastNoiseLite.new()

var towns: Array = []
var roads: Array = []          # [Vector2 a, Vector2 b, float ha, float hb]
var buildings: Array = []
var loot_spots: Array = []     # {pos: Vector3, tier: int}
var furniture: Array = []
var trees: Array = []          # {pos: Vector3, s: float, r: float, v: int}
var map_image: Image
var models := {}
var grass_mat: ShaderMaterial

# building geometry buckets: material name -> {v, n, uv}
var _buckets := {}
var _col := {"stone": PackedVector3Array(), "wood": PackedVector3Array(), "metal": PackedVector3Array()}
var _road_d := PackedFloat32Array()
var _road_h := PackedFloat32Array()


func _init_noise(seed: int) -> void:
	for pair in [[n_coast, 0.0021, 4], [n_hills, 0.0024, 5], [n_ridge, 0.0019, 4], [n_detail, 0.02, 3], [n_forest, 0.0035, 4], [n_tint, 0.008, 3]]:
		var n: FastNoiseLite = pair[0]
		n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		n.fractal_type = FastNoiseLite.FRACTAL_FBM
		n.frequency = pair[1]
		n.fractal_octaves = pair[2]
		n.seed = seed
		seed += 101


static func sstep(e0: float, e1: float, x: float) -> float:
	var t := clampf((x - e0) / (e1 - e0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


func raw_height(x: float, z: float) -> float:
	var r := Vector2(x, z).length()
	var rn := r / 690.0 + n_coast.get_noise_2d(x + 40.0, z - 13.0) * 0.16
	var land := 1.0 - sstep(0.78, 1.02, rn)
	var hills := n_hills.get_noise_2d(x, z) * 0.5 + 0.5
	var h := 3.0 + hills * 34.0
	var ridge := 1.0 - absf(n_ridge.get_noise_2d(x, z))
	var m_mask := sstep(120.0, -320.0, z + x * 0.35) * sstep(0.85, 0.45, rn)
	h += pow(ridge, 3.0) * 95.0 * m_mask
	h += n_detail.get_noise_2d(x, z) * 1.6
	h = lerpf(-16.0, h, land)
	if h > -1.0 and h < 3.0:
		h = lerpf(h, 1.2, 0.35)
	return h


func forest_mask(x: float, z: float) -> float:
	return sstep(0.02, 0.28, n_forest.get_noise_2d(x + 100.0, z - 50.0))


func get_height(x: float, z: float) -> float:
	var fx := (x + HALF) / CELL
	var fz := (z + HALF) / CELL
	var i := clampi(int(floor(fx)), 0, N - 1)
	var j := clampi(int(floor(fz)), 0, N - 1)
	var u := clampf(fx - i, 0.0, 1.0)
	var v := clampf(fz - j, 0.0, 1.0)
	var S := N + 1
	var a := heights[j * S + i]
	var b := heights[j * S + i + 1]
	var c := heights[(j + 1) * S + i]
	var d := heights[(j + 1) * S + i + 1]
	if u + v <= 1.0:
		return a + (b - a) * u + (c - a) * v
	return d + (c - d) * (1.0 - u) + (b - d) * (1.0 - v)


func get_normal(x: float, z: float) -> Vector3:
	var e := 1.5
	return Vector3(get_height(x - e, z) - get_height(x + e, z), 2.0 * e, get_height(x, z - e) - get_height(x, z + e)).normalized()


func road_dist(x: float, z: float) -> float:
	var best := 1e9
	var p := Vector2(x, z)
	for r in roads:
		var a: Vector2 = r[0]
		var b: Vector2 = r[1]
		var ab := b - a
		var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
		best = minf(best, p.distance_to(a + ab * t))
	return best


func building_at(x: float, z: float, pad := 0.0) -> Dictionary:
	for b in buildings:
		if absf(x - b.x) < b.w / 2.0 + pad and absf(z - b.z) < b.d / 2.0 + pad:
			return b
	return {}


# ------------------------------------------------------------------ build
func build(p_quality: String, p_models: Dictionary, progress: Callable) -> void:
	quality = p_quality
	models = p_models
	rng.seed = 7319
	_init_noise(7319)
	_place_towns_and_roads(); progress.call(0.1)
	_build_heights(); progress.call(0.2)
	_build_terrain(); progress.call(0.3)
	_build_water()
	_build_buildings(); progress.call(0.45)
	_build_trees(); progress.call(0.6)
	_build_props(); progress.call(0.75)
	_build_grass(); progress.call(0.85)
	_build_map_image(); progress.call(1.0)


func _place_towns_and_roads() -> void:
	var tries := 0
	while towns.size() < TOWN_NAMES.size() and tries < 4000:
		tries += 1
		var x := rng.randf_range(-560, 560)
		var z := rng.randf_range(-560, 560)
		var h := raw_height(x, z)
		if h < 6.0 or h > 55.0:
			continue
		var slope := absf(raw_height(x + 20, z) - h) + absf(raw_height(x, z + 20) - h)
		if slope > 9.0:
			continue
		var ok := true
		for t in towns:
			if Vector2(t.x, t.z).distance_to(Vector2(x, z)) < 230.0:
				ok = false
				break
		if not ok:
			continue
		var name: String = TOWN_NAMES[towns.size()]
		var military := name == "Ridgeback Base"
		towns.append({"name": name, "x": x, "z": z, "h": h, "R": 70.0 if military else rng.randf_range(55, 85), "military": military})
	# minimum spanning chain plus a few extra links
	var used := {0: true}
	while used.size() < towns.size():
		var best := [-1, -1, 1e9]
		for i in used.keys():
			for j in towns.size():
				if used.has(j):
					continue
				var d: float = Vector2(towns[i].x, towns[i].z).distance_to(Vector2(towns[j].x, towns[j].z))
				if d < best[2]:
					best = [i, j, d]
		used[best[1]] = true
		_add_road(towns[best[0]], towns[best[1]])
	for k in 3:
		var a: Dictionary = towns[rng.randi() % towns.size()]
		var b: Dictionary = towns[rng.randi() % towns.size()]
		if a != b and Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z)) < 600.0:
			_add_road(a, b)


func _add_road(a: Dictionary, b: Dictionary) -> void:
	var A := Vector2(a.x, a.z)
	var B := Vector2(b.x, b.z)
	var segs := maxi(2, int(A.distance_to(B) / 60.0))
	var prev := A
	for s in range(1, segs + 1):
		var t := float(s) / segs
		var p := A.lerp(B, t)
		if s < segs:
			p += Vector2(n_detail.get_noise_2d(t * 300.0, a.x), n_detail.get_noise_2d(a.z, t * 300.0)) * 25.0
		roads.append([prev, p, raw_height(prev.x, prev.y), raw_height(p.x, p.y)])
		prev = p


func _build_heights() -> void:
	var S := N + 1
	heights.resize(S * S)
	_road_d.resize(S * S)
	_road_h.resize(S * S)
	_road_d.fill(1e9)
	# rasterise road distance only near each segment
	for r in roads:
		var a: Vector2 = r[0]
		var b: Vector2 = r[1]
		var ab := b - a
		var i0 := clampi(int((minf(a.x, b.x) - 16 + HALF) / CELL), 0, N)
		var i1 := clampi(int((maxf(a.x, b.x) + 16 + HALF) / CELL) + 1, 0, N)
		var j0 := clampi(int((minf(a.y, b.y) - 16 + HALF) / CELL), 0, N)
		var j1 := clampi(int((maxf(a.y, b.y) + 16 + HALF) / CELL) + 1, 0, N)
		for j in range(j0, j1 + 1):
			for i in range(i0, i1 + 1):
				var p := Vector2(-HALF + i * CELL, -HALF + j * CELL)
				var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
				var d := p.distance_to(a + ab * t)
				var k := j * S + i
				if d < _road_d[k]:
					_road_d[k] = d
					_road_h[k] = lerpf(r[2], r[3], t)
	for j in S:
		for i in S:
			var x := -HALF + i * CELL
			var z := -HALF + j * CELL
			var h := raw_height(x, z)
			for t in towns:
				var d: float = Vector2(x - t.x, z - t.z).length()
				h = lerpf(h, t.h, sstep(t.R + 60.0, t.R * 0.7, d))
			var k := j * S + i
			if _road_d[k] < 14.0 and h > 0.5:
				h = lerpf(h, maxf(_road_h[k], h - 2.5), sstep(14.0, 4.0, _road_d[k]) * 0.5)
			heights[k] = h


func _build_terrain() -> void:
	var S := N + 1
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var uv2 := PackedVector2Array()
	var idx := PackedInt32Array()
	verts.resize(S * S); norms.resize(S * S); cols.resize(S * S); uv2.resize(S * S)
	splat.resize(S * S)
	for j in S:
		for i in S:
			var k := j * S + i
			var x := -HALF + i * CELL
			var z := -HALF + j * CELL
			var h := heights[k]
			verts[k] = Vector3(x, h, z)
			var hx := heights[j * S + mini(i + 1, N)] - heights[j * S + maxi(i - 1, 0)]
			var hz := heights[mini(j + 1, N) * S + i] - heights[maxi(j - 1, 0) * S + i]
			norms[k] = Vector3(-hx, 2.0 * CELL, -hz).normalized()
			var slope := Vector2(hx, hz).length() / (2.0 * CELL)
			var rock := clampf(sstep(0.45, 0.85, slope) + sstep(70.0, 95.0, h) * 0.8, 0.0, 1.0)
			var dirt := sstep(5.5, 2.5, _road_d[k])
			for t in towns:
				dirt += sstep(t.R * 0.9, t.R * 0.3, Vector2(x - t.x, z - t.z).length()) * (0.55 + 0.45 * n_tint.get_noise_2d(x * 6, z * 6))
			if h < 2.2:
				dirt += sstep(2.2, 0.8, h)
			dirt = clampf(dirt, 0.0, 1.0)
			var forest := forest_mask(x, z) * (1.0 - rock)
			var grass := maxf(0.0, 1.0 - rock - forest)
			var sum := grass + forest + rock + dirt * 1.5 + 0.0001
			var c := Color(grass / sum, forest / sum, rock / sum, dirt * 1.5 / sum)
			cols[k] = c
			splat[k] = c
			uv2[k] = Vector2(n_tint.get_noise_2d(x, z), 0)
	for j in N:
		for i in N:
			var a := j * S + i
			var b := a + 1
			var c := a + S
			var d := c + 1
			idx.append_array([a, b, c, b, d, c])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_TEX_UV2] = uv2
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://scripts/terrain.gdshader")
	var layers := ["grass", "forest", "rock", "dirt"]
	for i in 4:
		mat.set_shader_parameter("albedo%d" % i, load("res://assets/tex/%s_diff.jpg" % layers[i]))
		mat.set_shader_parameter("normal%d" % i, load("res://assets/tex/%s_nor.jpg" % layers[i]))
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.name = "Terrain"
	add_child(mi)
	# collision: uniform scale so the heightmap stays exact
	var body := StaticBody3D.new()
	body.set_meta("mat", "ground")
	body.collision_layer = 1
	var shape := HeightMapShape3D.new()
	shape.map_width = S
	shape.map_depth = S
	var data := PackedFloat32Array()
	data.resize(S * S)
	for k in S * S:
		data[k] = heights[k] / CELL
	shape.map_data = data
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.scale = Vector3(CELL, CELL, CELL)
	body.add_child(cs)
	add_child(body)


func _build_water() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(9000, 9000)
	pm.subdivide_width = 4
	pm.subdivide_depth = 4
	mi.mesh = pm
	var mat := ShaderMaterial.new()
	mat.shader = load("res://scripts/water.gdshader")
	for i in 2:
		var nt := NoiseTexture2D.new()
		var fn := FastNoiseLite.new()
		fn.frequency = 0.02 + i * 0.03
		fn.seed = 50 + i
		nt.noise = fn
		nt.seamless = true
		nt.as_normal_map = true
		nt.bump_strength = 6.0
		nt.width = 512
		nt.height = 512
		mat.set_shader_parameter("normal%d" % i, nt)
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


# ------------------------------------------------------------------ buildings
func _mat(name: String) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var tex: String = {"brick": "brick", "plaster": "plaster", "paint": "plaster", "blue": "plaster", "concrete": "concrete", "wood": "wood", "darkwood": "wood", "roof": "roof"}[name]
	m.albedo_texture = load("res://assets/tex/%s_diff.jpg" % tex)
	m.normal_enabled = true
	m.normal_texture = load("res://assets/tex/%s_nor.jpg" % tex)
	m.roughness = 0.9
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	match name:
		"roof": m.metallic = 0.55; m.roughness = 0.55
		"paint": m.albedo_color = Color(0.79, 0.73, 0.63)
		"blue": m.albedo_color = Color(0.62, 0.7, 0.72)
		"darkwood": m.albedo_color = Color(0.45, 0.37, 0.3)
	return m


func _bucket(m: String) -> Dictionary:
	if not _buckets.has(m):
		_buckets[m] = {"v": PackedVector3Array(), "n": PackedVector3Array(), "uv": PackedVector2Array()}
	return _buckets[m]


# Box in building-local space; xf maps local to world. collide: material class or "".
func _box(xf: Transform3D, mat: String, size: Vector3, collide := "stone", tile := 2.5) -> void:
	var bk := _bucket(mat)
	var h := size / 2.0
	# faces: normal, u axis, v axis, (u size, v size)
	var faces := [
		[Vector3.RIGHT, Vector3.BACK, Vector3.UP, size.z, size.y], [Vector3.LEFT, Vector3.FORWARD, Vector3.UP, size.z, size.y],
		[Vector3.UP, Vector3.RIGHT, Vector3.BACK, size.x, size.z], [Vector3.DOWN, Vector3.RIGHT, Vector3.FORWARD, size.x, size.z],
		[Vector3.BACK, Vector3.LEFT, Vector3.UP, size.x, size.y], [Vector3.FORWARD, Vector3.RIGHT, Vector3.UP, size.x, size.y],
	]
	var basis := xf.basis
	var col: PackedVector3Array = _col[collide] if collide != "" else PackedVector3Array()
	for f in faces:
		var n: Vector3 = f[0]
		var u: Vector3 = f[1]
		var v: Vector3 = f[2]
		var c := n * h
		var hu := u * h
		var hv := v * h
		var p := [c - hu.abs() * u.sign().abs() * 0 - _absdot(u, h) * u - _absdot(v, h) * v, c + _absdot(u, h) * u - _absdot(v, h) * v, c + _absdot(u, h) * u + _absdot(v, h) * v, c - _absdot(u, h) * u + _absdot(v, h) * v]
		var uvs := [Vector2(0, f[4]), Vector2(f[3], f[4]), Vector2(f[3], 0), Vector2(0, 0)]
		var wn := (basis * n).normalized()
		for t in [[0, 1, 2], [0, 2, 3]]:   # clockwise = front face in Godot
			for q in t:
				var wp: Vector3 = xf * (p[q] as Vector3)
				bk.v.append(wp)
				bk.n.append(wn)
				bk.uv.append((uvs[q] as Vector2) / tile)
				if collide != "":
					col.append(wp)
	if collide != "":
		_col[collide] = col


func _absdot(axis: Vector3, h: Vector3) -> float:
	return absf(axis.x) * h.x + absf(axis.y) * h.y + absf(axis.z) * h.z


func _bxf(B: Dictionary, local: Vector3, extra := Basis()) -> Transform3D:
	var rot := Basis(Vector3.UP, -B.rot * PI / 2.0)
	return Transform3D(rot * extra, Vector3(B.x, B.y, B.z) + rot * local)


func bbox(B: Dictionary, mat: String, lx: float, ly: float, lz: float, sx: float, sy: float, sz: float, collide := "auto") -> void:
	var cl := collide
	if cl == "auto":
		cl = "metal" if mat == "roof" else ("wood" if mat in ["wood", "darkwood"] else "stone")
	_box(_bxf(B, Vector3(lx, ly, lz)), mat, Vector3(sx, sy, sz), cl, 2.0 if mat == "roof" else 2.5)


func wall_x(B: Dictionary, mat: String, x0: float, x1: float, z: float, y0: float, h: float, ops: Array, th := 0.25) -> void:
	var cur := x0
	ops.sort_custom(func(a, b): return a.c < b.c)
	for o in ops:
		var a: float = o.c - o.w / 2.0
		if a > cur:
			bbox(B, mat, (cur + a) / 2.0, y0 + h / 2.0, z, a - cur, h, th)
		if o.y0 > 0.01:
			bbox(B, mat, o.c, y0 + o.y0 / 2.0, z, o.w, o.y0, th)
		if o.y1 < h:
			bbox(B, mat, o.c, y0 + (o.y1 + h) / 2.0, z, o.w, h - o.y1, th)
		cur = o.c + o.w / 2.0
	if x1 > cur:
		bbox(B, mat, (cur + x1) / 2.0, y0 + h / 2.0, z, x1 - cur, h, th)


func wall_z(B: Dictionary, mat: String, z0: float, z1: float, x: float, y0: float, h: float, ops: Array, th := 0.25) -> void:
	var cur := z0
	ops.sort_custom(func(a, b): return a.c < b.c)
	for o in ops:
		var a: float = o.c - o.w / 2.0
		if a > cur:
			bbox(B, mat, x, y0 + h / 2.0, (cur + a) / 2.0, th, h, a - cur)
		if o.y0 > 0.01:
			bbox(B, mat, x, y0 + o.y0 / 2.0, o.c, th, o.y0, o.w)
		if o.y1 < h:
			bbox(B, mat, x, y0 + (o.y1 + h) / 2.0, o.c, th, h - o.y1, o.w)
		cur = o.c + o.w / 2.0
	if z1 > cur:
		bbox(B, mat, x, y0 + h / 2.0, (cur + z1) / 2.0, th, h, z1 - cur)


func _op(c: float, w: float, y0: float, y1: float) -> Dictionary:
	return {"c": c, "w": w, "y0": y0, "y1": y1}


func gable(B: Dictionary, W: float, D: float, y: float) -> void:
	var pitch := 0.5
	var half := D / 2.0 + 0.35
	var rise := half * tan(pitch)
	var length := half / cos(pitch)
	for s in [-1.0, 1.0]:
		var xf := _bxf(B, Vector3(0, y + rise / 2.0, s * half / 2.0), Basis(Vector3.RIGHT, s * pitch))
		_box(xf, "roof", Vector3(W + 0.7, 0.12, length), "metal", 2.0)
	# gable end walls as thin stacked boxes (stepped triangle)
	var steps := 6
	for side in [-1.0, 1.0]:
		for k in steps:
			var t0 := float(k) / steps
			var hgt := rise / steps
			var wid := D * (1.0 - (k + 0.5) / steps)
			bbox(B, "plaster", side * (W / 2.0 - 0.1), y + hgt * (k + 0.5), 0, 0.2, hgt, wid, "stone")
	B.roof_top = B.y + y + rise


func door(B: Dictionary, lx: float, lz: float) -> void:
	var rot := Basis(Vector3.UP, -B.rot * PI / 2.0)
	var o := Vector3(B.x, 0, B.z) + rot * Vector3(lx, 0, lz + 1.6)
	var inn := Vector3(B.x, 0, B.z) + rot * Vector3(lx, 0, lz - 1.4)
	B.doors.append({"out": o, "in": inn})
	var g := get_height(o.x, o.z)
	var rise: float = B.y - g
	if rise > 0.15:
		# ramp up to the threshold (collision) with a visible concrete step
		var run := maxf(1.2, rise * 2.2)
		var ang := atan2(rise, run)
		var len := sqrt(rise * rise + run * run)
		var xf := _bxf(B, Vector3(lx, -rise / 2.0 - 0.05, lz + 0.1 + run / 2.0), Basis(Vector3.RIGHT, ang))
		_box(xf, "concrete", Vector3(1.6, 0.12, len), "stone")


func loot(B: Dictionary, lx: float, ly: float, lz: float, tier := 1) -> void:
	var rot := Basis(Vector3.UP, -B.rot * PI / 2.0)
	loot_spots.append({"pos": Vector3(B.x, B.y, B.z) + rot * Vector3(lx, ly, lz), "tier": tier})


func furn(B: Dictionary, name: String, lx: float, ly: float, lz: float, r := 0.0) -> void:
	var rot := Basis(Vector3.UP, -B.rot * PI / 2.0)
	furniture.append({"name": name, "pos": Vector3(B.x, B.y, B.z) + rot * Vector3(lx, ly, lz), "rot": r - B.rot * PI / 2.0})


func _build_buildings() -> void:
	for town in towns:
		var count: int = 9 if town.military else rng.randi_range(10, 17)
		var placed := 0
		var tries := 0
		while placed < count and tries < 400:
			tries += 1
			var ang := rng.randf() * TAU
			var dist := rng.randf_range(10, town.R)
			var x: float = town.x + cos(ang) * dist
			var z: float = town.z + sin(ang) * dist
			var type: String
			if town.military:
				type = "hangar" if rng.randf() < 0.45 else ("barracks" if rng.randf() < 0.5 else "tower")
			else:
				var r := rng.randf()
				type = "house" if r < 0.42 else ("twostory" if r < 0.67 else ("shed" if r < 0.82 else ("warehouse" if r < 0.93 else "ruin")))
			var dims: Array = {"house": [rng.randf_range(9, 12), rng.randf_range(7, 9)], "twostory": [10.0, 8.0], "shed": [5.0, 4.0], "warehouse": [20.0, 12.0], "ruin": [8.0, 7.0], "hangar": [22.0, 14.0], "barracks": [16.0, 7.0], "tower": [4.0, 4.0]}[type]
			var rot := rng.randi() % 4
			var w: float = dims[1] if rot % 2 else dims[0]
			var d: float = dims[0] if rot % 2 else dims[1]
			var rad := Vector2(w, d).length() / 2.0 + 3.0
			var clash := false
			for b in buildings:
				if Vector2(b.x - x, b.z - z).length() < b.rad + rad:
					clash = true
					break
			if clash or road_dist(x, z) < rad + 3.0 or get_height(x, z) < 3.0:
				continue
			buildings.append({"x": x, "z": z, "w": w, "d": d, "rot": rot, "rad": rad, "type": type, "town": town, "doors": []})
			placed += 1
	for k in 26:
		var x := rng.randf_range(-600, 600)
		var z := rng.randf_range(-600, 600)
		var h := get_height(x, z)
		if h < 4.0 or h > 70.0 or get_normal(x, z).y < 0.93:
			continue
		var clash := false
		for b in buildings:
			if Vector2(b.x - x, b.z - z).length() < 30.0:
				clash = true
				break
		if clash:
			continue
		var type := "shed" if rng.randf() < 0.6 else ("ruin" if rng.randf() < 0.5 else "house")
		var dims: Array = {"shed": [5.0, 4.0], "ruin": [8.0, 7.0], "house": [9.0, 7.0]}[type]
		var rot := rng.randi() % 4
		var w: float = dims[1] if rot % 2 else dims[0]
		var d: float = dims[0] if rot % 2 else dims[1]
		buildings.append({"x": x, "z": z, "w": w, "d": d, "rot": rot, "rad": Vector2(w, d).length() / 2.0 + 3.0, "type": type, "town": null, "doors": []})
	for B in buildings:
		_make_building(B)
	_perimeter_walls()
	# emit merged meshes
	for m in _buckets.keys():
		var bk: Dictionary = _buckets[m]
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = bk.v
		arr[Mesh.ARRAY_NORMAL] = bk.n
		arr[Mesh.ARRAY_TEX_UV] = bk.uv
		var st := SurfaceTool.new()
		st.create_from_arrays(arr)
		st.generate_tangents()
		var mesh := st.commit()
		mesh.surface_set_material(0, _mat(m))
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		add_child(mi)
	for cl in _col.keys():
		if _col[cl].is_empty():
			continue
		var body := StaticBody3D.new()
		body.set_meta("mat", cl)
		var sh := ConcavePolygonShape3D.new()
		sh.set_faces(_col[cl])
		sh.backface_collision = true
		var cs := CollisionShape3D.new()
		cs.shape = sh
		body.add_child(cs)
		add_child(body)
	_buckets.clear()


func _make_building(B: Dictionary) -> void:
	var W: float = B.d if B.rot % 2 else B.w
	var D: float = B.w if B.rot % 2 else B.d
	var gmin := 1e9
	var gmax := -1e9
	for c in [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]:
		var g := get_height(B.x + c[0] * B.w / 2.0, B.z + c[1] * B.d / 2.0)
		gmin = minf(gmin, g)
		gmax = maxf(gmax, g)
	B.y = gmax + 0.3
	var fh: float = B.y - gmin + 0.6
	var t: String = B.type
	var wall_mat: String
	if t == "warehouse" or t == "hangar":
		wall_mat = "roof"
	elif t == "shed":
		wall_mat = "darkwood"
	elif t == "barracks" or t == "tower":
		wall_mat = "concrete"
	else:
		wall_mat = ["brick", "plaster", "paint", "blue"][rng.randi() % 4]
	bbox(B, "concrete", 0, -fh / 2.0, 0, W + 0.3, fh, D + 0.3)
	var tier := 2 if (B.town != null and B.town.military) else 1
	var win := func(c: float) -> Dictionary: return _op(c, 1.3, 0.95, 2.15)
	match t:
		"house", "barracks":
			var H := 3.1
			wall_x(B, wall_mat, -W / 2, W / 2, D / 2, 0, H, [_op(0, 1.15, 0, 2.2), win.call(-W / 3.2), win.call(W / 3.2)])
			door(B, 0, D / 2)
			wall_x(B, wall_mat, -W / 2, W / 2, -D / 2, 0, H, [win.call(-W / 4), win.call(W / 4), _op(W / 2 - 1.2, 1.0, 0, 2.15)])
			wall_z(B, wall_mat, -D / 2 + 0.125, D / 2 - 0.125, -W / 2, 0, H, [win.call(0)])
			wall_z(B, wall_mat, -D / 2 + 0.125, D / 2 - 0.125, W / 2, 0, H, [win.call(0)])
			wall_z(B, "plaster", -D / 2 + 0.125, D / 2 - 0.125, -W / 6, 0, H, [_op(D / 4, 1.0, 0, 2.15)], 0.15)
			bbox(B, "plaster", 0, H + 0.08, 0, W, 0.16, D)
			if t == "barracks":
				bbox(B, "concrete", 0, H + 0.4, 0, W + 0.4, 0.5, D + 0.4)
				for i in 3:
					furn(B, "old_bed_frame", -W / 2 + 1.6 + i * 2.6, 0, -D / 2 + 1.1)
				furn(B, "metal_office_desk", W / 2 - 1.2, 0, 0, -PI / 2)
			else:
				gable(B, W, D, H + 0.16)
				furn(B, "old_bed_frame", -W / 2 + 1.1, 0, -D / 2 + 1.2, PI / 2)
				furn(B, "drawer_cabinet", -W / 2 + 0.4, 0, D / 2 - 1.2, PI / 2)
				furn(B, "WoodenTable_03", W / 6, 0, -D / 6)
				furn(B, "wooden_stool_01", W / 6 + 0.9, 0, -D / 6)
				furn(B, "sofa_02", W / 2 - 0.6, 0, D / 6, -PI / 2)
				furn(B, "wooden_bookshelf_worn", W / 4, 0, -D / 2 + 0.35)
			loot(B, -W / 3, 0.02, -D / 5, tier); loot(B, W / 4, 0.02, D / 6, tier); loot(B, W / 5, 0.02, -D / 4, tier)
		"twostory":
			var H := 3.0
			for f in 2:
				var y0 := f * (H + 0.2)
				if f == 0:
					wall_x(B, wall_mat, -W / 2, W / 2, D / 2, y0, H, [_op(1, 1.15, 0, 2.2), _op(-3, 1.2, 0.95, 2.1)])
					door(B, 1, D / 2)
				else:
					wall_x(B, wall_mat, -W / 2, W / 2, D / 2, y0, H, [_op(-2.5, 1.2, 0.95, 2.1), _op(2.5, 1.2, 0.95, 2.1)])
				wall_x(B, wall_mat, -W / 2, W / 2, -D / 2, y0, H, [_op(-2.5, 1.2, 0.95, 2.1), _op(2.5, 1.2, 0.95, 2.1)])
				wall_z(B, wall_mat, -D / 2 + 0.125, D / 2 - 0.125, -W / 2, y0, H, [_op(1, 1.2, 0.95, 2.1)])
				wall_z(B, wall_mat, -D / 2 + 0.125, D / 2 - 0.125, W / 2, y0, H, [] if f == 0 else [_op(0, 1.2, 0.95, 2.1)])
			# stair: visible steps, ramp collision
			var steps := 16
			var x := W / 2 - 0.75
			for s in steps:
				var top := (s + 1) * (H + 0.2) / steps
				bbox(B, "wood", x, top / 2.0, D / 2 - 1.0 - s * 0.32, 1.1, top, 0.32, "")
			var run := steps * 0.32
			var ang := atan2(H + 0.2, run)
			_box(_bxf(B, Vector3(x, (H + 0.2) / 2.0, D / 2 - 1.16 - run / 2.0 + 0.16), Basis(Vector3.RIGHT, -ang)), "wood", Vector3(1.1, 0.05, sqrt(run * run + (H + 0.2) * (H + 0.2))), "wood")
			var hx := W / 2 - 1.4
			bbox(B, "concrete", (-W / 2 + hx) / 2.0, H + 0.1, 0, hx + W / 2, 0.2, D)
			bbox(B, "concrete", (hx + W / 2) / 2.0, H + 0.1, -D / 2 + 0.5, W / 2 - hx, 0.2, 1.0)
			bbox(B, "plaster", 0, 2 * H + 0.3, 0, W, 0.16, D)
			gable(B, W, D, 2 * H + 0.38)
			furn(B, "sofa_02", -W / 2 + 0.6, 0, 0, PI / 2)
			furn(B, "WoodenTable_03", -1, 0, -D / 4 + 0.6)
			furn(B, "old_bed_frame", -W / 2 + 1.2, H + 0.2, -D / 2 + 1.2, PI / 2)
			furn(B, "drawer_cabinet", 0, H + 0.2, -D / 2 + 0.4)
			loot(B, -W / 3, 0.02, 0, tier); loot(B, 0, 0.02, -D / 4, tier)
			loot(B, -W / 3, H + 0.22, D / 5, tier); loot(B, 0, H + 0.22, -D / 4, tier)
		"shed":
			var H := 2.6
			wall_x(B, wall_mat, -W / 2, W / 2, D / 2, 0, H, [_op(0, 1.1, 0, 2.1)], 0.12)
			door(B, 0, D / 2)
			wall_x(B, wall_mat, -W / 2, W / 2, -D / 2, 0, H, [_op(0, 0.9, 1.0, 1.8)], 0.12)
			wall_z(B, wall_mat, -D / 2, D / 2, -W / 2, 0, H, [], 0.12)
			wall_z(B, wall_mat, -D / 2, D / 2, W / 2, 0, H, [], 0.12)
			bbox(B, "roof", 0, H + 0.1, 0, W + 0.6, 0.1, D + 0.6)
			furn(B, "wooden_barrels_01", -W / 2 + 0.9, 0, -D / 2 + 0.9)
			loot(B, 0, 0.02, -D / 6, tier)
		"warehouse", "hangar":
			var H := 8.0 if t == "hangar" else 6.5
			wall_x(B, "roof", -W / 2, W / 2, D / 2, 0, H, [_op(0, 8.0 if t == "hangar" else 5.0, 0, 6.0 if t == "hangar" else 4.5)], 0.15)
			door(B, 0, D / 2)
			wall_x(B, "roof", -W / 2, W / 2, -D / 2, 0, H, [_op(-W / 4, 1.2, 0, 2.2)], 0.15)
			wall_z(B, "roof", -D / 2, D / 2, -W / 2, 0, H, [_op(0, 1.2, 0, 2.2)], 0.15)
			wall_z(B, "roof", -D / 2, D / 2, W / 2, 0, H, [], 0.15)
			bbox(B, "roof", 0, H + 0.1, 0, W + 0.4, 0.15, D + 0.4)
			for i in [-1, 1]:
				bbox(B, "wood", i * W / 4, 1.1, -D / 2 + 1.2, W / 3, 2.2, 1.2)
			for i in 4:
				furn(B, "steel_frame_shelves_01", -W / 2 + 0.45, 0, -D / 2 + 1.5 + i * 2.2, PI / 2)
			furn(B, "wooden_barrels_01", -W / 4, 0, D / 2 - 1.5)
			loot(B, -W / 4, 2.21, -D / 2 + 1.2, tier + 1); loot(B, W / 4, 2.21, -D / 2 + 1.2, tier)
			loot(B, 0, 0.02, 0, tier); loot(B, -W / 3, 0.02, D / 4, tier)
		"ruin":
			var H := rng.randf_range(1.2, 3.2)
			wall_x(B, "brick", -W / 2, W / 2 * 0.3, D / 2, 0, H, [_op(-1, 1.2, 0, 2.2)], 0.3)
			wall_z(B, "brick", -D / 2, D / 2, -W / 2, 0, H + 0.8, [_op(0, 1.2, 0.9, 2.0)], 0.3)
			wall_x(B, "brick", -W / 2 * 0.2, W / 2, -D / 2, 0, H * 0.7, [], 0.3)
			loot(B, 0, 0.02, 0, tier)
		"tower":
			var H := 7.0
			for sx in [-1, 1]:
				for sz in [-1, 1]:
					bbox(B, "concrete", sx * 1.6, H / 2, sz * 1.6, 0.4, H, 0.4)
			bbox(B, "concrete", 0, H, 0, 4, 0.25, 4)
			wall_x(B, "concrete", -2, 2, 2, H + 0.12, 1.1, [], 0.15)
			wall_x(B, "concrete", -2, 2, -2, H + 0.12, 1.1, [], 0.15)
			wall_z(B, "concrete", -2, 2, 2, H + 0.12, 1.1, [], 0.15)
			bbox(B, "roof", 0, H + 2.6, 0, 4.6, 0.1, 4.6, "")
			# ramp up the open side
			var ang := atan2(H, 9.0)
			_box(_bxf(B, Vector3(-3.6, H / 2.0, 0), Basis(Vector3.UP, PI / 2) * Basis(Vector3.RIGHT, -ang)), "wood", Vector3(1.2, 0.15, sqrt(81.0 + H * H)), "wood")
			loot(B, 0, H + 0.13, 0, 3)


func _perimeter_walls() -> void:
	for t in towns:
		if not t.military:
			continue
		var R: float = t.R + 12.0
		var segs := 28
		for i in segs:
			if i % 7 == 0:
				continue
			var a0 := float(i) / segs * TAU
			var a1 := float(i + 1) / segs * TAU
			var p0 := Vector2(t.x + cos(a0) * R, t.z + sin(a0) * R)
			var p1 := Vector2(t.x + cos(a1) * R, t.z + sin(a1) * R)
			var c := (p0 + p1) / 2.0
			var g := get_height(c.x, c.y)
			var xf := Transform3D(Basis(Vector3.UP, -atan2(p1.y - p0.y, p1.x - p0.x)), Vector3(c.x, g + 0.05, c.y))
			_box(xf, "concrete", Vector3(p0.distance_to(p1) + 0.3, 5.5, 0.4), "stone", 3.0)


# ------------------------------------------------------------------ vegetation
# Split an imported model into variants: one per top-level mesh node, re-based at its foot.
func variants_of(scene: PackedScene, scale := 1.0) -> Array:
	var out := []
	var root := scene.instantiate()
	var nodes := []
	for c in root.get_children():
		nodes.append(c)
	if nodes.is_empty():
		nodes.append(root)
	for node in nodes:
		var meshes: Array = []
		_collect_meshes(node, Transform3D(), meshes)
		if meshes.is_empty():
			continue
		var st_mesh := ArrayMesh.new()
		var miny := 1e9
		var foot := Vector3.ZERO
		var fn := 0
		var all := []
		for m in meshes:
			var mesh: Mesh = m[0]
			var xf: Transform3D = m[1]
			for s in mesh.get_surface_count():
				var arr := mesh.surface_get_arrays(s)
				var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
				for i in v.size():
					v[i] = xf * v[i]
					miny = minf(miny, v[i].y)
				arr[Mesh.ARRAY_VERTEX] = v
				if arr[Mesh.ARRAY_NORMAL] != null:
					var nn: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
					for i in nn.size():
						nn[i] = (xf.basis * nn[i]).normalized()
					arr[Mesh.ARRAY_NORMAL] = nn
				arr[Mesh.ARRAY_TANGENT] = null
				all.append([arr, mesh.surface_get_material(s)])
		for a in all:
			var v: PackedVector3Array = a[0][Mesh.ARRAY_VERTEX]
			for p in v:
				if p.y < miny + 0.5:
					foot += p
					fn += 1
		foot /= maxf(1.0, fn)
		var height := 0.0
		var radius := 0.0
		for a in all:
			var v: PackedVector3Array = a[0][Mesh.ARRAY_VERTEX]
			for i in v.size():
				v[i] = (v[i] - Vector3(foot.x, miny, foot.z)) * scale
				height = maxf(height, v[i].y)
				radius = maxf(radius, Vector2(v[i].x, v[i].z).length())
			a[0][Mesh.ARRAY_VERTEX] = v
			var st := SurfaceTool.new()
			st.create_from_arrays(a[0])
			if a[0][Mesh.ARRAY_TEX_UV] != null:
				st.generate_tangents()
			var sm := st.commit()
			var arr2 := sm.surface_get_arrays(0)
			st_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr2)
			var mat: Material = a[1]
			if mat is BaseMaterial3D and (mat as BaseMaterial3D).transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
				var bm := (mat as BaseMaterial3D).duplicate() as BaseMaterial3D
				bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				bm.alpha_scissor_threshold = 0.35
				bm.cull_mode = BaseMaterial3D.CULL_DISABLED
				mat = bm
			st_mesh.surface_set_material(st_mesh.get_surface_count() - 1, mat)
		out.append({"mesh": st_mesh, "height": height, "radius": radius})
	root.queue_free()
	return out


func _collect_meshes(n: Node, parent_xf: Transform3D, out: Array) -> void:
	var xf := parent_xf
	if n is Node3D:
		xf = parent_xf * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out.append([(n as MeshInstance3D).mesh, xf])
	for c in n.get_children():
		_collect_meshes(c, xf, out)


func _build_trees() -> void:
	var fir := variants_of(models.fir_tree_01, 1.0)
	var broad := variants_of(models.island_tree_02, 2.6)
	var variants := []
	for v in fir:
		v.kind = "fir"; variants.append(v)
	for v in broad:
		v.kind = "broad"; variants.append(v)
	var target: int = {"low": 2200, "medium": 4000, "high": 6000, "ultra": 8500}[quality]
	var CH := 8
	var chunk := MAP_SIZE / CH
	var lists := {}
	var n := 0
	var tries := 0
	while n < target and tries < target * 12:
		tries += 1
		var x := rng.randf_range(-HALF * 0.92, HALF * 0.92)
		var z := rng.randf_range(-HALF * 0.92, HALF * 0.92)
		var h := get_height(x, z)
		if h < 2.5 or h > 92.0:
			continue
		if rng.randf() > forest_mask(x, z) * 0.95 + 0.035:
			continue
		if get_normal(x, z).y < 0.8 or road_dist(x, z) < 7.0 or not building_at(x, z, 3).is_empty():
			continue
		var in_town := false
		for t in towns:
			if Vector2(t.x - x, t.z - z).length() < t.R * 0.85:
				in_town = true
				break
		if in_town:
			continue
		var pool := []
		for i in variants.size():
			if (variants[i].kind == "fir") == (rng.randf() < (0.85 if h > 30 else 0.6)):
				pool.append(i)
		if pool.is_empty():
			pool = [0]
		var vi: int = pool[rng.randi() % pool.size()]
		var s := rng.randf_range(0.8, 1.25)
		var tr := {"pos": Vector3(x, h - 0.15, z), "s": s, "r": rng.randf() * TAU, "v": vi}
		trees.append(tr)
		var key := "%d_%d_%d" % [vi, clampi(int((x + HALF) / chunk), 0, CH - 1), clampi(int((z + HALF) / chunk), 0, CH - 1)]
		if not lists.has(key):
			lists[key] = []
		lists[key].append(tr)
		n += 1
	var vis_end: float = {"low": 380.0, "medium": 550.0, "high": 800.0, "ultra": 1200.0}[quality]
	for key in lists.keys():
		var vi := int(key.split("_")[0])
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = variants[vi].mesh
		mm.instance_count = lists[key].size()
		var i := 0
		for t in lists[key]:
			mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, t.r).scaled(Vector3.ONE * t.s), t.pos))
			i += 1
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.visibility_range_end = vis_end
		mmi.visibility_range_end_margin = 40.0
		mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		add_child(mmi)
	# trunk collision: one static body with a cylinder per tree
	var body := StaticBody3D.new()
	body.set_meta("mat", "wood")
	add_child(body)
	var cyl := CylinderShape3D.new()
	cyl.radius = 0.32
	cyl.height = 9.0
	var owner_id := body.create_shape_owner(body)
	for t in trees:
		body.shape_owner_add_shape(owner_id, cyl)
	var k := 0
	for t in trees:
		pass
	# shape owners share one transform, so use one owner per tree instead
	body.remove_shape_owner(owner_id)
	for t in trees:
		var cs := CollisionShape3D.new()
		cs.shape = cyl
		cs.position = t.pos + Vector3(0, 4.5, 0)
		body.add_child(cs)


func _build_grass() -> void:
	# GPU grass: a clump mesh instanced in chunks across grassland, faded by distance
	var count: int = {"low": 9000, "medium": 22000, "high": 42000, "ultra": 65000}[quality]
	var clump := _grass_clump_mesh()
	grass_mat = ShaderMaterial.new()
	grass_mat.shader = load("res://scripts/grass.gdshader")
	clump.surface_set_material(0, grass_mat)
	var CH := 32.0
	var chunks := {}
	var placed := 0
	var tries := 0
	var S := N + 1
	while placed < count and tries < count * 6:
		tries += 1
		var x := rng.randf_range(-700, 700)
		var z := rng.randf_range(-700, 700)
		var h := get_height(x, z)
		if h < 1.8:
			continue
		var i := clampi(int(round((x + HALF) / CELL)), 0, N)
		var j := clampi(int(round((z + HALF) / CELL)), 0, N)
		var sp: Color = splat[j * S + i]
		var dens := sp.r * 1.1 + sp.g * 0.45 - sp.a * 1.2
		if rng.randf() > dens:
			continue
		if not building_at(x, z, 0.5).is_empty():
			continue
		var key := Vector2i(int(floor((x + HALF) / CH)), int(floor((z + HALF) / CH)))
		if not chunks.has(key):
			chunks[key] = []
		# a tuft of 3-6 clumps around the sample point
		for k in rng.randi_range(3, 6):
			var px := x + rng.randf_range(-0.8, 0.8)
			var pz := z + rng.randf_range(-0.8, 0.8)
			chunks[key].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(1, rng.randf_range(0.6, 1.35), 1)), Vector3(px, get_height(px, pz) - 0.03, pz)))
		placed += 1
	var vis: float = {"low": 35.0, "medium": 55.0, "high": 75.0, "ultra": 95.0}[quality]
	for key in chunks.keys():
		var list: Array = chunks[key]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = clump
		mm.instance_count = list.size()
		for i in list.size():
			mm.set_instance_transform(i, list[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.visibility_range_end = vis
		mmi.visibility_range_end_margin = 10.0
		mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		add_child(mmi)


func _grass_clump_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var r := RandomNumberGenerator.new()
	r.seed = 5
	for b in 14:
		var a := r.randf() * TAU
		var off := Vector3(r.randf_range(-0.18, 0.18), 0, r.randf_range(-0.18, 0.18))
		var hgt := r.randf_range(0.45, 1.05)
		var w := r.randf_range(0.03, 0.06)
		var lean := Vector3(cos(a + 1.3), 0, sin(a + 1.3)) * r.randf_range(0.05, 0.3)
		var side := Vector3(cos(a), 0, sin(a)) * w
		var segs := 4
		var tint := r.randf()
		for s in segs:
			var t0 := float(s) / segs
			var t1 := float(s + 1) / segs
			var p0 := off + Vector3(0, t0 * hgt, 0) + lean * t0 * t0
			var p1 := off + Vector3(0, t1 * hgt, 0) + lean * t1 * t1
			var w0 := 1.0 - t0 * 0.9
			var w1 := 1.0 - t1 * 0.9
			var q := [p0 - side * w0, p0 + side * w0, p1 + side * w1, p1 - side * w1]
			var uvs := [Vector2(0, t0), Vector2(1, t0), Vector2(1, t1), Vector2(0, t1)]
			for k in [0, 1, 2, 0, 2, 3]:
				st.set_color(Color(tint, r.randf(), 0, 1))
				st.set_uv(uvs[k])
				st.set_normal(Vector3(-sin(a), 0.6, cos(a)).normalized())
				st.add_vertex(q[k])
	return st.commit()


func _build_props() -> void:
	var scale_fix := {"steel_frame_shelves_01": 0.1}
	var pick_one := ["wooden_barrels_01", "metal_trash_can"]
	var place := func(name: String, pos: Vector3, rot: float, s: float, collide: String, sink := 0.0) -> void:
		if not models.has(name):
			return
		var inst: Node3D
		if name in pick_one:
			var vars := variants_of(models[name], 1.0).filter(func(v): return v.height > 0.5)
			if vars.is_empty():
				return
			var mi := MeshInstance3D.new()
			mi.mesh = vars[rng.randi() % vars.size()].mesh
			inst = mi
		else:
			inst = models[name].instantiate()
		inst.scale = Vector3.ONE * s * scale_fix.get(name, 1.0)
		inst.rotation.y = rot
		inst.position = pos - Vector3(0, sink, 0)
		add_child(inst)
		if collide != "":
			var aabb := _node_aabb(inst)
			if aabb.size.x > 0.25 and aabb.size.y > 0.25:
				var body := StaticBody3D.new()
				body.set_meta("mat", collide)
				var bs := BoxShape3D.new()
				var shrink := 0.78 if ("boulder" in name or "rock" in name) else 0.95
				bs.size = aabb.size * shrink
				var cs := CollisionShape3D.new()
				cs.shape = bs
				cs.position = aabb.get_center()
				body.add_child(cs)
				add_child(body)
	for f in furniture:
		var big: bool = f.name in ["steel_frame_shelves_01", "wooden_bookshelf_worn", "old_bed_frame", "sofa_02", "metal_office_desk", "drawer_cabinet", "wooden_barrels_01", "WoodenTable_03"]
		place.call(f.name, f.pos, f.rot, 1.0, ("metal" if f.name.begins_with("steel") or f.name.begins_with("metal") else "wood") if big else "")
	for t in towns:
		var n: int = 40 if t.military else 18
		for i in n:
			var a := rng.randf() * TAU
			var d: float = rng.randf() * t.R * 1.1
			var x: float = t.x + cos(a) * d
			var z: float = t.z + sin(a) * d
			if not building_at(x, z, 1.5).is_empty() or road_dist(x, z) < 4.0:
				continue
			var pool: Array = ["old_military_crate", "wooden_military_crate", "metal_jerrycan_green", "Barrel_01", "old_tyre", "ammo_box"] if t.military else ["wooden_crate_01", "Barrel_01", "old_tyre", "metal_jerrycan_green", "wooden_picnic_table", "metal_trash_can", "fire_hydrant", "utility_box_01"]
			var name: String = pool[rng.randi() % pool.size()]
			var s := 1.6 if "military_crate" in name else (1.3 if name == "wooden_crate_01" else 1.0)
			place.call(name, Vector3(x, get_height(x, z), z), rng.randf() * TAU, s, "metal" if (name == "Barrel_01" or "jerry" in name or name.begins_with("metal") or name.begins_with("fire") or name.begins_with("utility")) else "wood")
			if t.military and rng.randf() < 0.3:
				loot_spots.append({"pos": Vector3(x + 1.5, get_height(x + 1.5, z), z), "tier": 2})
		for i in 3:
			var a := rng.randf() * TAU
			var d: float = rng.randf_range(10, t.R)
			var x: float = t.x + cos(a) * d
			var z: float = t.z + sin(a) * d
			if road_dist(x, z) > 20.0 or not building_at(x, z, 2).is_empty():
				continue
			place.call("covered_car", Vector3(x, get_height(x, z), z), rng.randf() * TAU, 1.0, "metal")
		for i in 5:
			var a := rng.randf() * TAU
			var d: float = rng.randf_range(8, t.R * 0.8)
			var x: float = t.x + cos(a) * d
			var z: float = t.z + sin(a) * d
			if not building_at(x, z, 1).is_empty():
				continue
			place.call("street_lamp_01", Vector3(x, get_height(x, z), z), 0.0, 1.0, "metal")
	var n_rocks: int = {"low": 120, "medium": 220, "high": 320, "ultra": 420}[quality]
	for i in n_rocks:
		var x := rng.randf_range(-680, 680)
		var z := rng.randf_range(-680, 680)
		var h := get_height(x, z)
		if h < 0.5 or road_dist(x, z) < 6.0:
			continue
		var near_town := false
		for t in towns:
			if Vector2(t.x - x, t.z - z).length() < t.R + 10:
				near_town = true
		if near_town:
			continue
		var p := rng.randf()
		var pos := Vector3(x, h, z)
		if p < 0.35:
			place.call("boulder_01" if rng.randf() < 0.5 else "namaqualand_boulder_02", pos, rng.randf() * TAU, rng.randf_range(0.8, 3.4), "stone", 0.4)
		elif p < 0.55:
			place.call("rock_moss_set_01", pos, rng.randf() * TAU, rng.randf_range(1, 2.5), "stone", 0.2)
		elif p < 0.7:
			place.call("dead_tree_trunk", pos, rng.randf() * TAU, rng.randf_range(1, 1.4), "wood", 0.1)
		elif p < 0.82:
			place.call("tree_stump_01", pos, rng.randf() * TAU, rng.randf_range(1, 2), "wood")
		else:
			place.call(["shrub_01", "shrub_02", "shrub_03"][rng.randi() % 3], pos, rng.randf() * TAU, rng.randf_range(0.8, 1.6), "")
	var n_ferns: int = {"low": 150, "medium": 500, "high": 900, "ultra": 1400}[quality]
	var placed := 0
	var tries := 0
	while placed < n_ferns and tries < n_ferns * 10:
		tries += 1
		var x := rng.randf_range(-680, 680)
		var z := rng.randf_range(-680, 680)
		if forest_mask(x, z) < 0.5 or get_height(x, z) < 2.0:
			continue
		place.call("fern_02" if rng.randf() < 0.7 else "shrub_02", Vector3(x, get_height(x, z), z), rng.randf() * TAU, rng.randf_range(0.9, 1.8), "")
		placed += 1


func _node_aabb(n: Node3D) -> AABB:
	var out := AABB()
	var first := true
	var stack := [n]
	while not stack.is_empty():
		var c: Node = stack.pop_back()
		if c is MeshInstance3D and (c as MeshInstance3D).mesh:
			var mi := c as MeshInstance3D
			var a := (n.global_transform.affine_inverse() * mi.global_transform) * mi.mesh.get_aabb() if n.is_inside_tree() else mi.mesh.get_aabb()
			a = Transform3D(n.basis, Vector3.ZERO) * a
			if first:
				out = a
				first = false
			else:
				out = out.merge(a)
		for k in c.get_children():
			stack.append(k)
	out.position += n.position
	return out


# ------------------------------------------------------------------ map image
func _build_map_image() -> void:
	var R := 512
	map_image = Image.create(R, R, false, Image.FORMAT_RGB8)
	for py in R:
		for px in R:
			var x := -HALF + (px + 0.5) / R * MAP_SIZE
			var z := -HALF + (py + 0.5) / R * MAP_SIZE
			var h := get_height(x, z)
			var col: Color
			if h < 0.0:
				var d := clampf(-h / 15.0, 0, 1)
				col = Color(lerpf(0.27, 0.11, d), lerpf(0.47, 0.25, d), lerpf(0.52, 0.35, d))
			else:
				var f := forest_mask(x, z)
				var base := Color(0.77, 0.71, 0.55) if h < 2.2 else (Color(0.59, 0.57, 0.53) if h > 75 else Color(lerpf(0.52, 0.36, f), lerpf(0.59, 0.46, f), lerpf(0.36, 0.27, f)))
				var nrm := get_normal(x, z)
				var shade := clampf(0.65 + (-nrm.x * 0.6 - nrm.z * 0.5 + nrm.y * 0.6) * 0.55, 0.45, 1.25)
				col = Color(base.r * shade, base.g * shade, base.b * shade)
			map_image.set_pixel(px, py, col)
	var sc := R / MAP_SIZE
	for r in roads:
		var a: Vector2 = r[0]
		var b: Vector2 = r[1]
		var steps := int(a.distance_to(b) * sc) + 1
		for s in steps + 1:
			var p := a.lerp(b, float(s) / steps)
			var ix := int((p.x + HALF) * sc)
			var iy := int((p.y + HALF) * sc)
			for dx in [-1, 0, 1]:
				for dy in [-1, 0, 1]:
					if ix + dx >= 0 and ix + dx < R and iy + dy >= 0 and iy + dy < R:
						map_image.set_pixel(ix + dx, iy + dy, Color(0.84, 0.77, 0.63))
	for b in buildings:
		var x0 := int((b.x - b.w / 2 + HALF) * sc)
		var y0 := int((b.z - b.d / 2 + HALF) * sc)
		map_image.fill_rect(Rect2i(x0, y0, maxi(1, int(b.w * sc)), maxi(1, int(b.d * sc))), Color(0.16, 0.15, 0.14))
