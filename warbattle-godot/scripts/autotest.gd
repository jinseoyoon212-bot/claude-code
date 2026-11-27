extends Node
## Test harness: stages scenes after the match starts and saves screenshots (run with --shots=DIR).

var game: Node
var dir := ""


func run() -> void:
	var g := game
	while g.state != "playing":
		await get_tree().process_frame
	for i in 10:
		await get_tree().process_frame
	var p: Actor = g.player
	g.jump_actor(p)
	p.state = "ground"
	for a in g.actors:
		if a.ai:
			a.ai.jump_at = 1e9
	# open field next to a town: low forest density and no tree within 15 m
	var t: Dictionary = g.world.towns[2]
	var x: float = t.x + t.R + 15.0
	var z: float = t.z
	for k in 72:
		var ang := k / 72.0 * TAU
		var cx: float = t.x + cos(ang) * (t.R + 18.0)
		var cz: float = t.z + sin(ang) * (t.R + 18.0)
		if g.world.forest_mask(cx, cz) > 0.15 or g.world.get_height(cx, cz) < 3.0:
			continue
		var clear := true
		for tr in g.world.trees:
			if Vector2(tr.pos.x - cx, tr.pos.z - cz).length() < 15.0:
				clear = false
				break
		if clear:
			x = cx
			z = cz
			break
	p.global_position = Vector3(x, g.world.get_height(x, z) + 0.2, z)
	g.cam_yaw = atan2(-(t.x - x), -(t.z - z)) + 0.35
	g.cam_pitch = 0.02
	g.view_mode = "tpp"
	p.hp = 1e9   # keep the camera subject alive while scenes are staged
	g.pickup(p, {"kind": "weapon", "sub": "carbine", "mag": 30, "node": Node3D.new()})
	p.ammo["5.56"] = 120
	var fwd := Vector3(-sin(g.cam_yaw), 0, -cos(g.cam_yaw))
	var rt := Vector3(cos(g.cam_yaw), 0, -sin(g.cam_yaw))
	var at := func(f: float, r: float) -> Vector3:
		var q: Vector3 = p.global_position + fwd * f + rt * r
		q.y = g.world.get_height(q.x, q.z)
		return q
	var specs := [[14.0, -6.0, 0.9, "carbine"], [30.0, 3.0, -2.6, "smg"], [12.0, 9.0, 2.4, "pistol"]]
	for i in specs.size():
		var a: Actor = g.actors[i + 1]
		a.state = "ground"
		a.visible = true
		a.global_position = at.call(specs[i][0], specs[i][1]) + Vector3.UP * 0.2
		a.yaw = g.cam_yaw + specs[i][2]
		a.crouch = i == 0
		g.pickup(a, {"kind": "weapon", "sub": specs[i][3], "mag": 20, "node": Node3D.new()})
	for i in 30:
		await get_tree().physics_frame
	g.fx.explosion(at.call(26.0, -9.0))
	g.fx.smoke_grenade(at.call(20.0, 6.0))
	g.fx.smoke_grenade(at.call(24.0, 12.0))
	g.fire_held = true
	await _wait(3.5)
	await _shot("g_combat")
	g.fire_held = false
	g.view_mode = "fpp"
	await _wait(1.0)
	await _shot("g_fpp")
	# forest
	var best: Dictionary = g.world.trees[0]
	for tr in g.world.trees:
		if absf(tr.pos.x - 150) + absf(tr.pos.z + 100) < absf(best.pos.x - 150) + absf(best.pos.z + 100):
			best = tr
	p.global_position = best.pos + Vector3(8, 1, 0)
	g.cam_yaw = 1.4
	g.cam_pitch = 0.05
	g.view_mode = "tpp"
	await _wait(2.0)
	await _shot("g_forest")
	# interior
	for b in g.world.buildings:
		if b.type == "house" and not b.doors.is_empty():
			var d: Dictionary = b.doors[0]
			p.global_position = Vector3(d.in.x, b.y + 0.1, d.in.z)
			g.cam_yaw = atan2(-(b.x - d.in.x), -(b.z - d.in.z))
			g.cam_pitch = -0.15
			g.view_mode = "fpp"
			break
	await _wait(1.5)
	p.hp = 1e9
	await _shot("g_inside")
	# aerial over the island from the transport
	p.global_position = Vector3(0, 300, 0)
	p.state = "plane"
	g.cam_yaw = 0.8
	g.cam_pitch = 0.35
	await _wait(1.0)
	await _shot("g_aerial")
	get_tree().quit()


func _wait(secs: float) -> void:
	var t := 0.0
	while t < secs:
		await get_tree().process_frame
		t += get_process_delta_time()


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(dir + "/" + name + ".png")
	print("saved ", name, "  fps=", Engine.get_frames_per_second())


## --sim: play a whole match at 4x speed with an invulnerable player and report progress.
func sim() -> void:
	var g := game
	while g.state != "playing":
		await get_tree().process_frame
	Engine.time_scale = 4.0
	Engine.max_physics_steps_per_frame = 64
	get_viewport().disable_3d = true   # logic only; drawing the island is what makes software rendering slow
	var last := -30.0
	while true:
		await get_tree().process_frame
		if g.player:
			g.player.hp = 1e9
			if g.player.state == "plane" and g.plane_t > 8.0:
				g.jump_actor(g.player)
		if g.time - last >= 30.0:
			last = g.time
			var states := {}
			var armed := 0
			var alive := 0
			var kills := 0
			for a in g.actors:
				states[a.state] = states.get(a.state, 0) + 1
				if a.alive:
					alive += 1
					if a.weapon() != null:
						armed += 1
				kills += a.kills
			print("SIM t=%d alive=%d armed=%d kills=%d loot=%d bullets=%d zone=%d:%s:%d states=%s fps=%d" % [g.time, alive, armed, kills, g.loot.size(), g.bullets.size(), g.zone.phase, g.zone.stage, g.zone.r, str(states), Engine.get_frames_per_second()])
			if alive <= 1 or g.time > 900.0:
				print("SIM done")
				get_tree().quit()
				return


## --armcheck=DIR: first-person view plus an outside view of the same pose, to debug the arms.
func armcheck() -> void:
	var g := game
	while g.state != "playing":
		await get_tree().process_frame
	var p: Actor = g.player
	g.jump_actor(p)
	p.state = "ground"
	p.hp = 1e9
	for a in g.actors:
		if a.ai:
			a.ai.jump_at = 1e9
	var t: Dictionary = g.world.towns[0]
	p.global_position = Vector3(t.x, g.world.get_height(t.x, t.z) + 0.3, t.z)
	g.pickup(p, {"kind": "weapon", "sub": "carbine", "mag": 30, "node": Node3D.new()})
	g.view_mode = "fpp"
	g.cam_yaw = 0.0
	g.cam_pitch = -0.1
	await _wait(2.0)
	await _shot("a_fpp")
	# freeze the game camera logic and look at the player from the side
	g.set_process(false)
	var cam: Camera3D = g.camera
	cam.global_position = p.global_position + Vector3(2.2, 1.5, -0.6)
	cam.look_at(p.global_position + Vector3(0, 1.35, -0.3), Vector3.UP)
	await _wait(0.5)
	await _shot("a_side")
	var sk: Skeleton3D = p.skel
	for n in ["mixamorig_RightHand", "mixamorig_LeftHand", "mixamorig_RightArm", "mixamorig_Head"]:
		var i := sk.find_bone(n)
		print(n, " world=", sk.global_transform * sk.get_bone_global_pose(i).origin)
	print("cam=", g.camera.global_position, " gun=", p.gun_socket.global_position, " tgt_r=", p.tgt_r.global_position, " ik=", p.aim.ik, " body=", p.body.global_position)
	get_tree().quit()
