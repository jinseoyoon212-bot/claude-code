class_name Effects
extends Node3D
## Smoke, fire, dust, muzzle flashes, tracers, bullet holes and physical shell casings.

var puff_tex: ImageTexture
var smoke_mat: StandardMaterial3D
var fire_mat: StandardMaterial3D
var clouds: Array = []          # active smoke-grenade clouds {pos, r, t}
var casings: Array = []
var holes: Array = []
var hole_mesh := QuadMesh.new()
var hole_mat := StandardMaterial3D.new()
var tracer_mat := StandardMaterial3D.new()
var casing_mesh := CylinderMesh.new()
var casing_mat := StandardMaterial3D.new()
var casing_shape := CylinderShape3D.new()
var flash_light := OmniLight3D.new()
var expl_light := OmniLight3D.new()
var flash_sprite := Sprite3D.new()
var flash_t := 0.0


func _ready() -> void:
	puff_tex = ImageTexture.create_from_image(_puff_atlas())
	smoke_mat = _particle_mat(false)
	fire_mat = _particle_mat(true)
	hole_mesh.size = Vector2(0.07, 0.07)
	hole_mat.albedo_color = Color(0.08, 0.07, 0.06, 0.9)
	hole_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	hole_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hole_mat.albedo_texture = _dot_texture()
	tracer_mat.albedo_color = Color(1.0, 0.83, 0.54, 0.9)
	tracer_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tracer_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	tracer_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	casing_mesh.top_radius = 0.0055
	casing_mesh.bottom_radius = 0.0055
	casing_mesh.height = 0.045
	casing_mesh.radial_segments = 8
	casing_mat.albedo_color = Color(0.79, 0.63, 0.29)
	casing_mat.metallic = 1.0
	casing_mat.roughness = 0.28
	casing_shape.radius = 0.006
	casing_shape.height = 0.045
	for l in [flash_light, expl_light]:
		l.light_energy = 0.0
		l.shadow_enabled = false
		add_child(l)
	flash_light.light_color = Color(1, 0.69, 0.38)
	flash_light.omni_range = 14.0
	expl_light.light_color = Color(1, 0.54, 0.23)
	expl_light.omni_range = 45.0
	flash_sprite.texture = ImageTexture.create_from_image(_flash_image())
	flash_sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	flash_sprite.shaded = false
	flash_sprite.pixel_size = 0.004
	flash_sprite.modulate = Color(1, 0.8, 0.5)
	flash_sprite.visible = false
	add_child(flash_sprite)


func _particle_mat(additive: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = puff_tex
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.particles_anim_h_frames = 2
	m.particles_anim_v_frames = 2
	m.particles_anim_loop = false
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 1.0
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
		m.proximity_fade_enabled = true
		m.proximity_fade_distance = 1.2
	return m


# Four lumpy puffs with baked top-lighting in a 2x2 atlas.
func _puff_atlas() -> Image:
	var S := 128
	var img := Image.create(S * 2, S * 2, false, Image.FORMAT_RGBA8)
	for t in 4:
		var n := FastNoiseLite.new()
		n.seed = 17 + t * 31
		n.frequency = 0.035
		n.fractal_octaves = 5
		var ox := (t % 2) * S
		var oy := (t / 2) * S
		for y in S:
			for x in S:
				var u := float(x) / S * 2.0 - 1.0
				var v := float(y) / S * 2.0 - 1.0
				var f := n.get_noise_2d(x * 1.0, y * 1.0)
				var shape := 1.0 - Vector2(u, v).length() + f * 0.55
				var a := clampf((shape - 0.12) * 2.4, 0.0, 1.0)
				var lit := clampf(0.62 + 0.38 * clampf(-v * 0.7 - u * 0.25 + f * 1.1, -1.0, 1.0), 0.0, 1.0)
				img.set_pixel(ox + x, oy + y, Color(lit, lit, lit, a))
	return img


func _dot_texture() -> ImageTexture:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x - 15.5, y - 15.5).length() / 16.0
			img.set_pixel(x, y, Color(1, 1, 1, clampf(1.2 - d * 1.4, 0, 1)))
	return ImageTexture.create_from_image(img)


func _flash_image() -> Image:
	var S := 64
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var p := Vector2(x - 31.5, y - 31.5) / 32.0
			var a := atan2(p.y, p.x)
			var star := pow(absf(cos(a * 3.5)), 6.0) * (1.0 - p.length())
			var core := clampf(1.0 - p.length() * 2.2, 0, 1)
			var v := clampf(star * 1.5 + core, 0, 1)
			img.set_pixel(x, y, Color(1, 0.95, 0.8, v))
	return img


# Spawn a one-shot burst of billboard particles.
func burst(pos: Vector3, o: Dictionary) -> void:
	var p := CPUParticles3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	quad.material = fire_mat if o.get("add", false) else smoke_mat
	p.mesh = quad
	p.one_shot = true
	p.emitting = false
	p.amount = o.get("n", 10)
	p.lifetime = o.get("life", 2.0)
	p.explosiveness = o.get("burst", 0.95)
	p.randomness = 0.5
	p.direction = o.get("dir", Vector3.UP)
	p.spread = o.get("spread", 180.0)
	p.initial_velocity_min = o.get("v0", 1.0) * 0.5
	p.initial_velocity_max = o.get("v0", 1.0)
	p.gravity = Vector3(0, o.get("rise", 0.5), 0)
	p.damping_min = o.get("drag", 1.0)
	p.damping_max = o.get("drag", 1.0) * 1.5
	p.scale_amount_min = o.get("size", 1.0) * 0.7
	p.scale_amount_max = o.get("size", 1.0)
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.35))
	curve.add_point(Vector2(1, o.get("grow", 3.0)))
	curve.max_value = maxf(1.0, o.get("grow", 3.0))
	p.scale_amount_curve = curve
	p.angle_min = 0.0
	p.angle_max = 360.0
	p.angular_velocity_min = -20.0
	p.angular_velocity_max = 20.0
	p.anim_offset_max = 1.0
	var grad := Gradient.new()
	var c0: Color = o.get("c0", Color(0.5, 0.5, 0.5, 0.8))
	var c1: Color = o.get("c1", Color(0.6, 0.6, 0.6, 0.0))
	grad.set_color(0, Color(c0.r, c0.g, c0.b, 0.0))
	grad.set_color(1, Color(c1.r, c1.g, c1.b, 0.0))
	grad.add_point(0.06, c0)
	grad.add_point(0.55, c0.lerp(c1, 0.5))
	p.color_ramp = grad
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = o.get("radius", 0.1)
	p.local_coords = false
	add_child(p)
	p.global_position = pos
	p.emitting = true
	get_tree().create_timer(p.lifetime + 0.5).timeout.connect(p.queue_free)


func muzzle(pos: Vector3, dir: Vector3, show_flash: bool) -> void:
	flash_light.global_position = pos
	flash_light.light_energy = 6.0
	if show_flash:
		flash_sprite.global_position = pos
		flash_sprite.rotation.z = randf() * TAU
		flash_sprite.visible = true
		flash_t = 0.04
	burst(pos + dir * 0.15, {"n": 3, "life": 1.2, "v0": 1.6, "dir": dir, "spread": 25.0, "size": 0.25, "grow": 3.0, "rise": 0.4, "drag": 2.5, "c0": Color(0.85, 0.84, 0.8, 0.22), "c1": Color(0.8, 0.8, 0.78, 0)})


func impact(pos: Vector3, normal: Vector3, mat: String, decal: bool) -> void:
	var col: Color = {"wood": Color(0.48, 0.38, 0.27, 0.75), "metal": Color(0.55, 0.55, 0.55, 0.6), "ground": Color(0.52, 0.45, 0.33, 0.8)}.get(mat, Color(0.66, 0.63, 0.58, 0.75))
	burst(pos + normal * 0.05, {"n": 5, "life": 1.6, "v0": 2.2, "dir": normal, "spread": 40.0, "size": 0.35, "grow": 3.2, "rise": 0.2, "drag": 2.2, "c0": col, "c1": Color(col.r, col.g, col.b, 0)})
	if mat == "metal" or mat == "stone":
		burst(pos, {"add": true, "n": 6, "life": 0.25, "v0": 7.0, "dir": normal, "spread": 60.0, "size": 0.04, "grow": 1.0, "rise": -9.8, "drag": 0.0, "c0": Color(1.6, 1.1, 0.5, 1), "c1": Color(1, 0.5, 0.2, 0)})
	if decal:
		var h := MeshInstance3D.new()
		h.mesh = hole_mesh
		h.material_override = hole_mat
		h.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(h)
		h.global_position = pos + normal * 0.012
		if absf(normal.dot(Vector3.UP)) < 0.99:
			h.look_at(pos + normal * 2.0, Vector3.UP)
		else:
			h.look_at(pos + normal * 2.0, Vector3.FORWARD)
		h.rotate_object_local(Vector3.UP, PI)
		holes.append(h)
		if holes.size() > 160:
			holes.pop_front().queue_free()


func blood(pos: Vector3, dir: Vector3) -> void:
	burst(pos, {"n": 8, "life": 0.7, "v0": 3.0, "dir": dir, "spread": 35.0, "size": 0.12, "grow": 2.5, "rise": -6.0, "drag": 1.0, "c0": Color(0.38, 0.03, 0.02, 0.9), "c1": Color(0.3, 0.02, 0.02, 0)})


func explosion(pos: Vector3) -> void:
	burst(pos + Vector3.UP * 0.5, {"add": true, "n": 26, "life": 0.9, "v0": 9.0, "dir": Vector3.UP, "spread": 80.0, "size": 2.6, "grow": 3.0, "rise": 3.0, "drag": 3.2, "radius": 0.8, "c0": Color(1.6, 1.05, 0.45, 1), "c1": Color(0.9, 0.22, 0.05, 0)})
	burst(pos + Vector3.UP * 1.2, {"n": 34, "life": 8.0, "burst": 0.9, "v0": 5.0, "dir": Vector3.UP, "spread": 50.0, "size": 3.5, "grow": 4.0, "rise": 1.8, "drag": 0.9, "radius": 1.2, "c0": Color(0.16, 0.14, 0.13, 0.95), "c1": Color(0.32, 0.3, 0.28, 0)})
	burst(pos + Vector3.UP * 0.3, {"n": 20, "life": 3.5, "v0": 9.0, "dir": Vector3.UP, "spread": 88.0, "size": 1.6, "grow": 3.0, "rise": 0.3, "drag": 1.8, "c0": Color(0.55, 0.47, 0.36, 0.7), "c1": Color(0.6, 0.55, 0.47, 0)})
	burst(pos, {"add": true, "n": 24, "life": 1.4, "v0": 14.0, "dir": Vector3.UP, "spread": 70.0, "size": 0.06, "grow": 1.0, "rise": -12.0, "drag": 0.3, "c0": Color(1.5, 0.9, 0.4, 1), "c1": Color(0.6, 0.2, 0.05, 0)})
	expl_light.global_position = pos + Vector3.UP * 1.5
	expl_light.light_energy = 16.0


func smoke_grenade(pos: Vector3) -> void:
	var p := CPUParticles3D.new()
	var quad := QuadMesh.new()
	quad.material = smoke_mat
	p.mesh = quad
	p.amount = 160
	p.lifetime = 11.0
	p.one_shot = false
	p.direction = Vector3.UP
	p.spread = 85.0
	p.initial_velocity_min = 0.6
	p.initial_velocity_max = 1.8
	p.gravity = Vector3(0, 0.12, 0)
	p.damping_min = 0.4
	p.damping_max = 0.7
	p.scale_amount_min = 3.0
	p.scale_amount_max = 5.0
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(1, 1.6))
	curve.max_value = 2.0
	p.scale_amount_curve = curve
	p.angle_max = 360.0
	p.angular_velocity_min = -8.0
	p.angular_velocity_max = 8.0
	p.anim_offset_max = 1.0
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 2.0
	var grad := Gradient.new()
	grad.set_color(0, Color(0.93, 0.93, 0.92, 0.0))
	grad.set_color(1, Color(0.9, 0.9, 0.9, 0.0))
	grad.add_point(0.1, Color(0.93, 0.93, 0.92, 0.85))
	grad.add_point(0.7, Color(0.9, 0.9, 0.9, 0.5))
	p.color_ramp = grad
	p.local_coords = false
	add_child(p)
	p.global_position = pos + Vector3.UP * 0.6
	p.emitting = true
	var cloud := {"pos": pos + Vector3.UP, "r": 0.0, "t": 0.0, "node": p}
	clouds.append(cloud)


func casing(pos: Vector3, right: Vector3, up: Vector3) -> void:
	var rb := RigidBody3D.new()
	rb.collision_layer = 0
	rb.collision_mask = 1
	rb.mass = 0.01
	rb.continuous_cd = true
	var cs := CollisionShape3D.new()
	cs.shape = casing_shape
	rb.add_child(cs)
	var mi := MeshInstance3D.new()
	mi.mesh = casing_mesh
	mi.material_override = casing_mat
	mi.rotation.z = PI / 2
	rb.add_child(mi)
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.35
	pm.friction = 0.8
	rb.physics_material_override = pm
	add_child(rb)
	rb.global_position = pos
	rb.linear_velocity = right * randf_range(2.2, 3.4) + up * randf_range(1.6, 2.8)
	rb.angular_velocity = Vector3(randf_range(-15, 15), randf_range(-15, 15), randf_range(-15, 15))
	casings.append(rb)
	if casings.size() > 50:
		casings.pop_front().queue_free()
	get_tree().create_timer(8.0).timeout.connect(func(): if is_instance_valid(rb): rb.freeze = true)


func tracer(from: Vector3, to: Vector3) -> void:
	var len := from.distance_to(to)
	if len < 0.5:
		return
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.018, 0.018, minf(len, 9.0))
	mi.mesh = bm
	mi.material_override = tracer_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var mid := to - (to - from).normalized() * minf(len, 9.0) / 2.0
	mi.global_position = mid
	mi.look_at(to, Vector3.UP if absf((to - from).normalized().y) < 0.99 else Vector3.FORWARD)
	get_tree().create_timer(0.04).timeout.connect(mi.queue_free)


# true when the segment a->b passes through an active smoke cloud
func blocks_view(a: Vector3, b: Vector3) -> bool:
	for c in clouds:
		if c.r < 1.5:
			continue
		var ab := b - a
		var t := clampf((c.pos - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
		if (a + ab * t).distance_to(c.pos) < c.r * 0.85:
			return true
	return false


func _process(delta: float) -> void:
	flash_light.light_energy = maxf(0.0, flash_light.light_energy - delta * 200.0)
	expl_light.light_energy = maxf(0.0, expl_light.light_energy - delta * 10.0)
	if flash_t > 0.0:
		flash_t -= delta
		if flash_t <= 0.0:
			flash_sprite.visible = false
	for i in range(clouds.size() - 1, -1, -1):
		var c: Dictionary = clouds[i]
		c.t += delta
		c.r = minf(7.0, c.t * 2.2) * (maxf(0.0, 1.0 - (c.t - 22.0) / 6.0) if c.t > 22.0 else 1.0)
		if c.t > 22.0 and c.node.emitting:
			c.node.emitting = false
		if c.t > 34.0:
			c.node.queue_free()
			clouds.remove_at(i)
