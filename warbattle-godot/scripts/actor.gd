class_name Actor
extends CharacterBody3D
## A fighter (player or bot): movement, inventory, animated body with IK hands on the weapon.

const AimMod := preload("res://scripts/aim_mod.gd")
const TINTS := [Color(1, 1, 1), Color(0.85, 0.82, 0.75), Color(0.77, 0.8, 0.71), Color(0.72, 0.72, 0.72), Color(0.84, 0.76, 0.65), Color(0.66, 0.7, 0.63)]

var game: Node
var id := 0
var actor_name := ""
var is_player := false
var hp := 100.0
var alive := true
var state := "plane"
var yaw := 0.0
var pitch := 0.0
var crouch := false
var ads := false
var lean := 0.0
var armor := 0
var armor_hp := 0.0
var helmet := 0
var helmet_hp := 0.0
var weapons: Array = [null, null, null]
var cur := -1
var ammo := {"5.56": 0, "9mm": 0, "7.62": 0}
var bandages := 0
var medkits := 0
var grenades := 0
var smokes := 0
var last_shot := -10.0
var reload_t := 0.0
var heal_t := 0.0
var heal_max := 1.0
var heal_kind := ""
var bolt_t := 0.0
var kills := 0
var dmg_dealt := 0.0
var height := 1.78
var free_t := 0.0
var step_acc := 0.0
var dead_t := 0.0
var ai: RefCounted
var chute: Node3D

var body: Node3D
var skel: Skeleton3D
var anim_tree: AnimationTree
var aim
var tgt_r := Marker3D.new()
var tgt_l := Marker3D.new()
var gun_socket := Node3D.new()
var gun: Node3D
var capsule := CapsuleShape3D.new()
var col_shape := CollisionShape3D.new()


func setup(p_game: Node, p_id: int, p_name: String, player: bool, models: Dictionary) -> void:
	game = p_game
	id = p_id
	actor_name = p_name
	is_player = player
	collision_layer = 2
	collision_mask = 1 | 2
	floor_snap_length = 0.6
	floor_max_angle = deg_to_rad(52)
	capsule.radius = 0.32
	capsule.height = 1.78
	col_shape.shape = capsule
	col_shape.position.y = 0.89
	add_child(col_shape)
	body = models.soldier.instantiate()
	add_child(body)
	var tint: Color = TINTS[0] if player else TINTS[p_id % TINTS.size()]
	for mi in body.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		m.extra_cull_margin = 2.0
		if tint != Color(1, 1, 1):
			for s in m.mesh.get_surface_count():
				var mat := m.mesh.surface_get_material(s)
				if mat is BaseMaterial3D:
					var d := (mat as BaseMaterial3D).duplicate() as BaseMaterial3D
					d.albedo_color = tint
					m.set_surface_override_material(s, d)
	skel = body.find_children("*", "Skeleton3D", true, false)[0]
	var ap: AnimationPlayer = body.find_children("*", "AnimationPlayer", true, false)[0]
	for a in ["Idle", "Walk", "Run"]:
		ap.get_animation(a).loop_mode = Animation.LOOP_LINEAR
	var bs := AnimationNodeBlendSpace1D.new()
	bs.min_space = 0.0
	bs.max_space = 7.0
	for pair in [["Idle", 0.0], ["Walk", 1.7], ["Run", 5.6]]:
		var an := AnimationNodeAnimation.new()
		an.animation = pair[0]
		bs.add_blend_point(an, pair[1])
	var bt := AnimationNodeBlendTree.new()
	bt.add_node("loco", bs)
	var tp := AnimationNodeAnimation.new()
	tp.animation = "TPose"
	bt.add_node("tpose", tp)
	bt.add_node("mix", AnimationNodeBlend2.new())
	bt.connect_node("mix", 0, "loco")
	bt.connect_node("mix", 1, "tpose")
	bt.connect_node("output", 0, "mix")
	anim_tree = AnimationTree.new()
	anim_tree.tree_root = bt
	body.add_child(anim_tree)
	anim_tree.anim_player = anim_tree.get_path_to(ap)
	anim_tree.active = true
	aim = AimMod.new()
	skel.add_child(aim)
	aim.setup(skel)
	game.world_root.add_child(gun_socket)
	gun_socket.add_child(tgt_r)
	gun_socket.add_child(tgt_l)
	visible = false
	gun_socket.visible = false


func cleanup() -> void:
	if is_instance_valid(gun_socket):
		gun_socket.queue_free()
	if chute and is_instance_valid(chute):
		chute.queue_free()
	queue_free()


func weapon() -> Variant:
	return weapons[cur] if cur >= 0 else null


func set_weapon_model(kind: String) -> void:
	if gun and is_instance_valid(gun):
		gun.queue_free()
	gun = null
	if kind == "":
		return
	gun = Weapons.make(kind, game.models)
	gun_socket.add_child(gun)
	tgt_r.position = gun.get_meta("grip")
	tgt_l.position = gun.get_meta("fore")


func muzzle_world() -> Vector3:
	if gun:
		return gun.global_transform * (gun.get_meta("muzzle") as Vector3)
	return global_position + Vector3(0, height - 0.3, 0)


func aim_dir() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))


func eye_pos() -> Vector3:
	return global_position + Vector3(0, (height if state == "ground" else 1.7) - 0.12, 0)


# Weapon placement: first person hangs it off the camera; otherwise it sits at the chest.
func place_gun(delta: float, cam: Camera3D, fpp: bool, recoil: float, bob: float) -> void:
	var w = weapon()
	gun_socket.visible = w != null and state == "ground" and alive and heal_t <= 0.0 and visible
	if not gun_socket.visible:
		return
	if fpp:
		var off := Vector3(0, -(gun.get_meta("sight_y") as float), -0.36) if ads else Vector3(0.15, -0.19, -0.34)
		if reload_t > 0.0:
			off.y -= 0.1
		off.z += recoil * 2.2
		off.y += sin(bob * 2.0) * 0.008
		var t := cam.global_transform
		gun_socket.global_transform = Transform3D(t.basis * Basis(Vector3.RIGHT, recoil * 3.0 + (-0.35 if reload_t > 0 else 0.0)), t * off)
		if ads and Weapons.DATA[w.kind].scope:
			gun_socket.visible = false
	else:
		var right := Vector3(cos(yaw), 0, -sin(yaw))
		var pos := global_position + Vector3(0, height - 0.42, 0) + right * 0.13 + aim_dir() * 0.32
		gun_socket.global_transform = Transform3D(Basis.from_euler(Vector3(pitch, yaw, 0), EULER_ORDER_YXZ), pos)


func animate(delta: float, fpp_body: bool) -> void:
	var sp := Vector2(velocity.x, velocity.z).length()
	rotation.y = yaw
	if not alive:
		dead_t = minf(1.0, dead_t + delta * 1.8)
		body.rotation.x = -PI / 2.0 * dead_t * dead_t
		body.position.y = 0.15 * dead_t
		aim.dead = dead_t
		aim.pitch = 0.0
		anim_tree.set("parameters/loco/blend_position", 0.0)
		aim.ik = 0.0
		if dead_t >= 1.0:
			anim_tree.active = false
		return
	body.rotation.x = 0.0
	body.position = Vector3.ZERO
	if fpp_body:
		body.position = Vector3(0, 0, 0.1)   # keep the torso just behind the eye
	var freefall := state == "air"
	anim_tree.set("parameters/mix/blend_amount", 1.0 if freefall else 0.0)
	anim_tree.set("parameters/loco/blend_position", 0.0 if state != "ground" else (sp * (1.4 if crouch else 1.0)))
	if freefall:
		body.rotation.x = PI * 0.42
		body.position.y = 0.9
	aim.pitch = 0.0 if (fpp_body or state != "ground") else pitch
	aim.crouch = lerpf(aim.crouch, 1.0 if (crouch and state == "ground") else 0.0, 1.0 - exp(-delta * 10.0))
	aim.hide_head = fpp_body
	var armed := gun_socket.visible
	if state == "chute":
		# hands up on the risers
		var up := global_position + Vector3(0, 2.15, 0)
		var right := Vector3(cos(yaw), 0, -sin(yaw))
		tgt_r.global_position = up + right * 0.22
		tgt_l.global_position = up - right * 0.22
		aim.ik = 1.0
	else:
		if gun:
			tgt_r.position = gun.get_meta("grip")
			tgt_l.position = gun.get_meta("fore")
		aim.ik = lerpf(aim.ik, 1.0 if armed else 0.0, 1.0 - exp(-delta * 12.0))
	var to_skel := skel.global_transform.affine_inverse()
	aim.r_target = to_skel * tgt_r.global_position
	aim.l_target = to_skel * tgt_l.global_position


# inp: {fx, fz, sprint, jump}
func move_actor(delta: float, inp: Dictionary) -> void:
	var w: World = game.world
	if state == "air" or state == "chute":
		var para := state == "chute"
		var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
		var right := Vector3(cos(yaw), 0, -sin(yaw))
		var fz: float = inp.fz
		var hs := lerpf(8, 17, maxf(0, fz)) if para else lerpf(18, 42, maxf(0, fz))
		var want: Vector3 = fwd * ((maxf(0.35, fz) if para else fz) * hs) + right * (inp.fx * (6.0 if para else 14.0))
		var k := 1.0 - exp(-delta * (1.5 if para else 0.8))
		velocity.x = lerpf(velocity.x, want.x, k)
		velocity.z = lerpf(velocity.z, want.z, k)
		var term := (-7.5 if fz > 0.3 else -5.0) if para else (-70.0 if fz > 0.3 else -52.0)
		velocity.y = lerpf(velocity.y, term, 1.0 - exp(-delta * (2.0 if para else 0.5)))
		free_t += delta
		var g := w.get_height(global_position.x, global_position.z)
		if state == "air" and global_position.y - g < 140.0:
			open_chute()
		move_and_slide()
		global_position.x = clampf(global_position.x, -World.HALF + 5, World.HALF - 5)
		global_position.z = clampf(global_position.z, -World.HALF + 5, World.HALF - 5)
		if is_on_floor() or global_position.y <= g + 0.05:
			global_position.y = maxf(global_position.y, g)
			state = "ground"
			velocity = Vector3.ZERO
			if chute:
				chute.queue_free()
				chute = null
			game.on_landed(self)
		if chute:
			chute.global_position = global_position
			chute.rotation = Vector3(0, yaw, -inp.fx * 0.25)
		return
	if state != "ground":
		return
	var target_h := 1.25 if crouch else 1.78
	height = lerpf(height, target_h, 1.0 - exp(-delta * 12.0))
	capsule.height = height
	col_shape.position.y = height / 2.0
	var swim := global_position.y < -1.2
	var speed := 2.6 if swim else (2.3 if crouch else (6.4 if inp.sprint and inp.fz > 0.5 and not ads else 4.7))
	if ads:
		speed *= 0.65
	if heal_t > 0:
		speed = minf(speed, 1.8)
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var wish: Vector3 = fwd * inp.fz + right * inp.fx
	if wish.length() > 1.0:
		wish = wish.normalized()
	wish *= speed
	var k := 1.0 - exp(-delta * (11.0 if is_on_floor() else 1.5))
	velocity.x = lerpf(velocity.x, wish.x, k)
	velocity.z = lerpf(velocity.z, wish.z, k)
	if is_on_floor():
		if inp.jump and not swim:
			velocity.y = 5.3
			crouch = false
	else:
		velocity.y -= 18.0 * delta
	if swim:
		velocity.y = maxf(velocity.y, (-1.25 - global_position.y) * 6.0)
	var before := global_position
	move_and_slide()
	global_position.x = clampf(global_position.x, -World.HALF + 5, World.HALF - 5)
	global_position.z = clampf(global_position.z, -World.HALF + 5, World.HALF - 5)
	# safety net: never fall through the terrain
	var g := w.get_height(global_position.x, global_position.z)
	if global_position.y < g - 0.5 and g > -1.0:
		global_position.y = g
		velocity.y = 0
	var moved := Vector2(global_position.x - before.x, global_position.z - before.z).length()
	if is_on_floor() and moved > 0.001:
		step_acc += moved
		var stride := 0.9 if crouch else (1.6 if speed > 5.5 else 1.3)
		if step_acc > stride:
			step_acc = 0.0
			if not crouch:
				game.footstep(self)


func jump_from_plane(pos: Vector3, vel: Vector3) -> void:
	state = "air"
	free_t = 0.0
	global_position = pos
	velocity = vel
	visible = true


func open_chute() -> void:
	if state != "air":
		return
	state = "chute"
	chute = _make_chute()
	game.world_root.add_child(chute)
	velocity.y = maxf(velocity.y, -12.0)


func _make_chute() -> Node3D:
	var g := Node3D.new()
	var cols: Array = [[Color(0.42, 0.48, 0.31), Color(0.79, 0.76, 0.66)], [Color(0.54, 0.35, 0.23), Color(0.85, 0.81, 0.71)], [Color(0.24, 0.35, 0.43), Color(0.82, 0.84, 0.82)]][id % 3]
	var segs := 14
	for i in segs:
		var sm := SphereMesh.new()
		sm.radius = 4.2
		sm.height = 8.4
		sm.radial_segments = 4
		sm.rings = 8
		sm.is_hemisphere = true
		var mi := MeshInstance3D.new()
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		# one gore of the canopy
		var a0 := float(i) / segs * TAU
		var a1 := float(i + 1) / segs * TAU
		for r in 6:
			var t0 := float(r) / 6.0 * 0.55
			var t1 := float(r + 1) / 6.0 * 0.55
			var p := func(a: float, t: float) -> Vector3: return Vector3(sin(t * PI / 1.1) * cos(a) * 5.2, 5.4 - (1.0 - cos(t * PI / 1.1)) * 2.4, sin(t * PI / 1.1) * sin(a) * 3.6)
			var q := [p.call(a0, t0), p.call(a1, t0), p.call(a1, t1), p.call(a0, t1)]
			for k in [0, 1, 2, 0, 2, 3]:
				st.add_vertex(q[k])
		st.generate_normals()
		mi.mesh = st.commit()
		var m := StandardMaterial3D.new()
		m.albedo_color = cols[i % 2]
		m.roughness = 0.85
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		mi.material_override = m
		g.add_child(mi)
	var lines := ImmediateMesh.new()
	lines.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in 10:
		var a := float(i) / 10.0 * TAU
		lines.surface_add_vertex(Vector3(0, 1.5, 0))
		lines.surface_add_vertex(Vector3(cos(a) * 4.8, 4.1, sin(a) * 3.3))
	lines.surface_end()
	var lm := MeshInstance3D.new()
	lm.mesh = lines
	var lmat := StandardMaterial3D.new()
	lmat.albedo_color = Color(0.13, 0.13, 0.13)
	lmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.material_override = lmat
	g.add_child(lm)
	return g


func die() -> void:
	alive = false
	state = "dead"
	hp = 0.0
	collision_layer = 0
	velocity = Vector3.ZERO
	gun_socket.visible = false
