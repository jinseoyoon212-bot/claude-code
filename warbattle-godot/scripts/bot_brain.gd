class_name BotBrain
extends RefCounted
## Bot decision making: drop target, looting, zone movement, door routing and combat.

var a: Actor
var game: Node
var drop := Vector3.ZERO
var jump_at := 0.0
var think := 0.0
var enemy: Actor
var sees := false
var react := 0.0
var err := 0.08
var skill := 0.6
var strafe := 1.0
var strafe_t := 0.0
var engaged := 0.0
var burst := 0
var wp: Variant = null
var wp_item: Variant = null
var route: Array = []
var stuck_t := 0.0
var stuck_n := 0
var last_pos := Vector3.ZERO
var last_seen: Variant = null
var urgent := false
var bad := {}


func _init(actor: Actor, g: Node) -> void:
	a = actor
	game = g
	skill = randf_range(0.4, 1.0)
	err = randf_range(0.06, 0.11)


func go_to(target: Vector3, item: Variant = null) -> void:
	var w: World = game.world
	route = []
	var tb := w.building_at(target.x, target.z, 0.2)
	var ab := w.building_at(a.global_position.x, a.global_position.z, 0.2)
	if not ab.is_empty() and ab != tb and not ab.doors.is_empty():
		var d: Dictionary = _nearest_door(ab)
		route.append(d.in)
		route.append(d.out)
	if not tb.is_empty() and tb != ab and not tb.doors.is_empty():
		var d: Dictionary = _nearest_door(tb)
		route.append(d.out)
		route.append(d.in)
	route.append(target)
	wp = route.pop_front()
	wp_item = item
	stuck_n = 0


func _nearest_door(b: Dictionary) -> Dictionary:
	var best: Dictionary = b.doors[0]
	for d in b.doors:
		if (d.out as Vector3).distance_squared_to(a.global_position) < (best.out as Vector3).distance_squared_to(a.global_position):
			best = d
	return best


# Returns movement input for this frame.
func update(delta: float) -> Dictionary:
	var inp := {"fx": 0.0, "fz": 0.0, "sprint": false, "jump": false}
	if a.state == "plane":
		if game.plane_t >= jump_at:
			game.jump_actor(a)
		return inp
	if a.state == "air" or a.state == "chute":
		var to := drop - a.global_position
		to.y = 0
		a.yaw = atan2(-to.x, -to.z)
		var d := to.length()
		inp.fz = 1.0 if d > 30.0 else 0.1
		if a.state == "air" and d < 220.0 and a.global_position.y - game.world.get_height(a.global_position.x, a.global_position.z) < 380.0:
			a.open_chute()
		return inp
	think -= delta
	var far := a.global_position.distance_to(game.camera.global_position) > 500.0
	if think <= 0.0:
		think = (0.7 if far else 0.3) + randf() * 0.15
		_think()
	var w = a.weapon()
	var e: Actor = enemy if enemy and enemy.alive else null
	if e and w and sees:
		var eye := a.eye_pos()
		var tgt := e.global_position + Vector3(0, (e.height if e.state == "ground" else 1.6) * (0.93 if randf() < 0.18 * skill else 0.6), 0)
		var dist := eye.distance_to(tgt)
		var W: Dictionary = Weapons.DATA[w.kind]
		var travel: float = dist / W.vel
		tgt += e.velocity * travel * 0.8
		tgt.y += 0.5 * 9.81 * travel * travel
		var dir := (tgt - eye).normalized()
		var want_yaw := atan2(-dir.x, -dir.z)
		var want_pitch := asin(clampf(dir.y, -1, 1))
		var turn := 1.0 - exp(-delta * (4.0 + skill * 6.0))
		a.yaw += wrapf(want_yaw - a.yaw, -PI, PI) * turn
		a.pitch = lerpf(a.pitch, want_pitch, turn)
		react -= delta
		strafe_t -= delta
		if strafe_t <= 0.0:
			strafe = -1.0 if randf() < 0.5 else 1.0
			strafe_t = randf_range(0.6, 2.0)
			if randf() < 0.25:
				a.crouch = not a.crouch
		inp.fx = strafe * (0.8 if dist > 12 else 1.0)
		inp.fz = 0.6 if dist > 90 else (-0.5 if dist < 8 else 0.0)
		a.ads = dist > 25.0
		if react <= 0.0 and absf(wrapf(want_yaw - a.yaw, -PI, PI)) < 0.12 and w.mag > 0 and a.reload_t == 0.0:
			var rng_max := 400.0 if w.kind == "marksman" else (220.0 if w.kind == "carbine" else 110.0)
			if dist < rng_max:
				var e2 := err * (1.0 - minf(0.6, engaged * 0.12)) * (0.6 if dist > 60 else 1.0) / (0.7 + skill * 0.6)
				var fd := a.aim_dir() + Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * e2
				if not W.auto or burst > 0:
					if game.fire(a, fd.normalized(), eye):
						burst -= 1
						engaged += 0.15
				elif randf() < delta * 3.0:
					burst = randi_range(3, 8)
		if w.mag == 0:
			if a.ammo[W.ammo] > 0:
				game.reload(a)
			else:
				for s in 3:
					if s != a.cur and a.weapons[s] and (a.weapons[s].mag > 0 or a.ammo[Weapons.DATA[a.weapons[s].kind].ammo] > 0):
						game.equip(a, s)
						break
	else:
		a.ads = false
		if a.crouch and randf() < delta:
			a.crouch = false
		if w and w.mag < Weapons.DATA[w.kind].mag * 0.5 and a.ammo[Weapons.DATA[w.kind].ammo] > 0:
			game.reload(a)
		if a.hp < 70 and (a.medkits > 0 or a.bandages > 0) and a.heal_t <= 0:
			game.start_heal(a)
		if wp != null:
			var to: Vector3 = (wp as Vector3) - a.global_position
			to.y = 0
			var d := to.length()
			if d < (1.0 if not route.is_empty() else 1.5):
				if not route.is_empty():
					wp = route.pop_front()
				else:
					if wp_item != null and game.loot.has(wp_item) and absf((wp_item.pos as Vector3).y - a.global_position.y) < 1.6:
						game.pickup(a, wp_item)
					wp = null
					wp_item = null
			else:
				var want_yaw := atan2(-to.x, -to.z)
				a.yaw += wrapf(want_yaw - a.yaw, -PI, PI) * (1.0 - exp(-delta * 6.0))
				a.pitch = lerpf(a.pitch, 0.0, delta * 3.0)
				inp.fz = 1.0 if absf(wrapf(want_yaw - a.yaw, -PI, PI)) < 0.8 else 0.3
				inp.sprint = d > 15.0 and a.heal_t <= 0
		stuck_t += delta
		if stuck_t > 1.6:
			if wp != null and a.global_position.distance_to(last_pos) < 0.8:
				stuck_n += 1
				if stuck_n > 4:
					if wp_item != null:
						bad[wp_item] = true
					wp = null
					wp_item = null
					route = []
					stuck_n = 0
				elif stuck_n == 1:
					inp.jump = true
				else:
					var to: Vector3 = ((wp as Vector3) - a.global_position)
					to.y = 0
					to = to.normalized()
					var side := Vector3(-to.z, 0, to.x) * ((-1.0 if randf() < 0.5 else 1.0) * (6.0 + stuck_n * 4.0))
					route.push_front(wp)
					wp = a.global_position + side - to * 2.0
			last_pos = a.global_position
			stuck_t = 0.0
	return inp


func _think() -> void:
	var w: World = game.world
	var eye := a.eye_pos()
	sees = false
	var cands := []
	for o in game.actors:
		if o == a or not o.alive or o.state == "plane":
			continue
		var d: float = o.global_position.distance_to(a.global_position)
		var rng_v := 250.0 if o.state != "ground" else (110.0 if o.crouch else 190.0) * (0.7 if w.forest_mask(o.global_position.x, o.global_position.z) > 0.5 else 1.0)
		if d < rng_v:
			cands.append([o, d])
	cands.sort_custom(func(x, y): return x[1] < y[1])
	if enemy and enemy.alive:
		var found := false
		for c in cands:
			if c[0] == enemy:
				found = true
		if not found and enemy.global_position.distance_to(a.global_position) < 220.0:
			cands.push_front([enemy, enemy.global_position.distance_to(a.global_position)])
	for c in cands.slice(0, 2):
		var o: Actor = c[0]
		var tp := o.global_position + Vector3(0, (o.height if o.state == "ground" else 1.6) * 0.75, 0)
		var to := (tp - eye).normalized()
		var facing := -sin(a.yaw) * to.x - cos(a.yaw) * to.z
		if facing < -0.2 and c[1] > 18.0 and o != enemy:
			continue
		if game.line_clear(eye, tp, [a.get_rid(), o.get_rid()]) and not game.fx.blocks_view(eye, tp):
			if enemy != o:
				enemy = o
				react = 0.35 + (1.0 - skill) * 0.7 + c[1] / 400.0
				engaged = 0.0
			sees = true
			last_seen = o.global_position
			break
	if sees and a.weapon() == null:
		sees = false
	if sees:
		return
	if enemy and (not enemy.alive or enemy.global_position.distance_to(a.global_position) > 260.0):
		enemy = null
	var z: Dictionary = game.zone
	var nc: Vector2 = z.nc if z.nc != null else z.c
	var nr: float = z.nr
	var dist_in := Vector2(a.global_position.x - nc.x, a.global_position.z - nc.y).length() - nr * 0.8
	var time_left: float = (z.t + z.shrink * 0.5) if z.stage == "wait" else z.t * 0.5
	var is_urgent: bool = game.outside_zone(a.global_position) or (dist_in > 0.0 and dist_in / 5.2 > time_left - 25.0)
	if not is_urgent:
		urgent = false
	if is_urgent:
		if wp == null or not urgent or wp_item != null:
			var ang := randf() * TAU
			var rr := randf() * nr * 0.6
			go_to(Vector3(nc.x + cos(ang) * rr, 0, nc.y + sin(ang) * rr))
			urgent = true
		return
	if last_seen != null and enemy and a.weapon() != null:
		go_to(last_seen)
		last_seen = null
		return
	if wp == null or wp_item == null:
		var armed := a.weapon() != null
		var best: Variant = null
		var bd := 50.0 if armed else 400.0
		for it in game.loot:
			if bad.has(it) or absf((it.pos as Vector3).y - a.global_position.y) > 1.6:
				continue
			if not armed and it.kind != "weapon":
				continue
			var d: float = absf(it.pos.x - a.global_position.x) + absf(it.pos.z - a.global_position.z)
			if d < bd and _needs(it):
				bd = d
				best = it
		if best != null:
			go_to(best.pos, best)
			return
	if wp == null:
		var bs: Array = w.buildings
		var b: Dictionary = bs[randi() % bs.size()]
		if Vector2(b.x - nc.x, b.z - nc.y).length() < nr and Vector2(b.x - a.global_position.x, b.z - a.global_position.z).length() < 350.0:
			go_to(Vector3(b.x, 0, b.z))
		else:
			var ang := randf() * TAU
			go_to(a.global_position + Vector3(cos(ang) * 40.0, 0, sin(ang) * 40.0))


func _needs(it: Dictionary) -> bool:
	match it.kind:
		"weapon":
			return a.weapons[0] == null or (a.weapons[1] == null and Weapons.DATA[it.sub].prim) or (a.weapons[2] == null and it.sub == "pistol")
		"ammo":
			for w in a.weapons:
				if w and Weapons.DATA[w.kind].ammo == it.sub:
					return a.ammo[it.sub] < 90
			return false
		"vest": return it.lvl > a.armor
		"helmet": return it.lvl > a.helmet
		"medkit": return a.medkits < 2
		"bandage": return a.bandages < 6
		"grenade": return a.grenades < 2
		"smoke": return a.smokes < 2
	return false
