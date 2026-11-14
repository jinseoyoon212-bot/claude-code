extends Node3D
class_name Unit
## 전장 위의 유닛 하나 (영웅, 아군, 적, 빛의 수정 모두 이 스크립트를 쓴다).

const LOOPS := ["Idle", "Idle_Combat", "Running_A", "Walking_A", "Spellcasting"]

var main
var kind := ""
var display_name := ""
var team := 0
var hp := 100.0
var max_hp := 100.0
var speed := 3.0
var attack_range := 1.5
var aggro := 10.0
var dmg := 10.0
var cd := 1.0
var ranged := false
var radius := 0.6
var bar_h := 2.6
var is_hero := false
var is_static := false
var is_boss := false
var elite := false
var enraged := false
var scripted := false   # 인트로 연출용: AI 대신 스크립트가 움직임

var cd_t := 0.0
var dead := false
var dead_t := 0.0
var target: Unit = null
var retarget_t := 0.0
var pending_t := -1.0
var pending_target: Unit = null
var lock_t := 0.0
var shield_t := 0.0
var flash_t := 0.0
var knock := Vector3.ZERO
var home := Vector3.ZERO
var form_off := Vector3.ZERO
var slow_t := 0.0
var power := 1.0
var special_t := 6.0
var summon_t := 10.0

var model: Node3D
var anim: AnimationPlayer
var cur_anim := ""
var anim_speed := 1.0
var meshes: Array = []
var base_overlay: Material = null
var run_anim := "Running_A"
var idle_anim := "Idle"
var attack_anim := "1H_Melee_Attack_Chop"


func setup(m, k: String, def: Dictionary) -> void:
	main = m
	kind = k
	display_name = def.get("name", "")
	team = def.team
	max_hp = def.hp
	hp = max_hp
	speed = def.get("speed", 0.0)
	attack_range = def.get("range", 1.5)
	aggro = def.get("aggro", 10.0)
	dmg = def.get("dmg", 0.0)
	cd = def.get("cd", 1.0)
	ranged = def.get("ranged", false)
	var sc: float = def.get("scale", 1.0)
	radius = def.get("radius", 0.55) * sc
	bar_h = 2.7 * sc
	cd_t = randf() * cd
	is_boss = def.get("boss", false)
	special_t = def.get("special_cd", 7.0)
	if kind == "crystal":
		is_static = true
		bar_h = 4.6
		_build_crystal()
		return
	model = main.scenes[def.model].instantiate()
	add_child(model)
	model.scale = Vector3.ONE * sc
	for n in def.get("hide", []):
		var nd: Node = model.find_child(n, true, false)
		if nd:
			nd.visible = false
	var skel_list := model.find_children("*", "Skeleton3D", true, false)
	if not skel_list.is_empty():
		for w in def.get("weapons", []):
			var ba := BoneAttachment3D.new()
			ba.bone_name = w[1]
			skel_list[0].add_child(ba)
			ba.add_child(main.scenes[w[0]].instantiate())
	anim = model.find_child("AnimationPlayer", true, false)
	if anim:
		for a in LOOPS:
			if anim.has_animation(a):
				anim.get_animation(a).loop_mode = Animation.LOOP_LINEAR
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		meshes.append(mi)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	if def.has("overlay"):
		base_overlay = def.overlay
		_set_overlay(base_overlay)
	idle_anim = def.get("idle", "Idle")
	run_anim = def.get("run", "Running_A")
	attack_anim = def.get("attack", "Spellcast_Shoot" if ranged else "1H_Melee_Attack_Chop")
	loop_anim(idle_anim)


func _build_crystal() -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.55, 0.9, 1.0)
	mat.emission_enabled = true
	mat.emission = Color(0.4, 0.85, 1.0)
	mat.emission_energy_multiplier = 1.6
	var root := Node3D.new()
	root.name = "Gem"
	add_child(root)
	for up in [1, -1]:
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = 0.9
		cm.height = 1.6
		cm.radial_segments = 6
		mi.mesh = cm
		mi.material_override = mat
		mi.position.y = 0.8 * up
		if up == -1:
			mi.rotation.x = PI
		root.add_child(mi)
		meshes.append(mi)
	root.position.y = 3.0
	var ped := MeshInstance3D.new()
	var pm := CylinderMesh.new()
	pm.top_radius = 1.2
	pm.bottom_radius = 1.6
	pm.height = 1.2
	ped.mesh = pm
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(0.62, 0.6, 0.66)
	ped.material_override = sm
	ped.position.y = 0.6
	add_child(ped)
	var light := OmniLight3D.new()
	light.light_color = Color(0.5, 0.85, 1.0)
	light.light_energy = 2.5
	light.omni_range = 10.0
	light.position.y = 3.0
	add_child(light)
	radius = 1.6


func _set_overlay(m: Material) -> void:
	for mi in meshes:
		mi.material_overlay = m


func loop_anim(a: String) -> void:
	if anim == null or lock_t > 0.0 or cur_anim == a:
		return
	cur_anim = a
	anim.play(a, 0.18, anim_speed)


func play_once(a: String, lock: float, spd := 1.0) -> void:
	if anim == null or not anim.has_animation(a):
		return
	cur_anim = a
	lock_t = lock
	anim.play(a, 0.1, spd)
	anim.seek(0.0, true)


func face(dir: Vector3, instant := false) -> void:
	if dir.length_squared() < 0.0001:
		return
	var a := atan2(dir.x, dir.z)
	rotation.y = a if instant else lerp_angle(rotation.y, a, 0.35)


func forward() -> Vector3:
	return Vector3(sin(rotation.y), 0, cos(rotation.y))


func make_elite() -> void:
	elite = true
	max_hp *= 2.5
	hp = max_hp
	dmg *= 1.5
	display_name = "정예 " + display_name
	if model:
		model.scale *= 1.25
	radius *= 1.25
	bar_h *= 1.25
	base_overlay = main.elite_mat
	_set_overlay(base_overlay)


func take_damage(amount: float, _src = null, crit := false) -> void:
	if dead:
		return
	if team == 0 and Save.cheats.god and (is_hero or kind == "crystal"):
		return
	if team == 1 and Save.cheats.one_hit:
		amount = hp + 1.0
	if shield_t > 0.0:
		main.add_floater(position + Vector3(0, bar_h, 0), "막음", Color(0.5, 0.9, 1.0))
		return
	hp -= amount
	flash_t = 0.12
	_set_overlay(main.flash_mat)
	if Save.settings.numbers:
		if crit:
			main.add_floater(position + Vector3(0, bar_h + 0.3, 0), "치명타 %d" % int(round(amount)), Color(1.0, 0.95, 0.3), 1.4)
		else:
			main.add_floater(position + Vector3(0, bar_h, 0), str(int(round(amount))), Color(1, 0.85, 0.4) if team == 1 else Color(1, 0.45, 0.45))
	if team == 1:
		Sfx.play("hit", 0.6)
	if is_boss and not enraged and hp < max_hp * 0.4 and hp > 0.0:
		enraged = true
		speed *= 1.4
		cd *= 0.65
		main.on_boss_enrage(self)
	if hp <= 0.0:
		hp = 0.0
		die()
	elif lock_t <= 0.0 and not is_hero and randf() < 0.5:
		play_once("Hit_A", 0.3)


func die() -> void:
	dead = true
	dead_t = 0.0
	lock_t = 0.0
	target = null
	if anim and anim.has_animation("Death_A"):
		cur_anim = "Death_A"
		anim.play("Death_A", 0.1)
	if kind == "crystal":
		get_node("Gem").visible = false
	if team == 1:
		Sfx.play("bones", 0.8)
	main.on_death(self)


func heal(amount: float) -> void:
	if dead:
		return
	hp = minf(max_hp, hp + amount)


func tick(delta: float, active: bool) -> void:
	if flash_t > 0.0:
		flash_t -= delta
		if flash_t <= 0.0:
			_set_overlay(base_overlay)
	if dead:
		dead_t += delta
		if dead_t > 1.8:
			position.y -= delta * 0.6
		return
	if kind == "crystal":
		var g: Node3D = get_node("Gem")
		g.rotation.y += delta * 0.8
		g.position.y = 3.0 + sin(main.t * 2.0) * 0.2
		return
	lock_t = maxf(0.0, lock_t - delta)
	cd_t -= delta
	shield_t = maxf(0.0, shield_t - delta)
	slow_t = maxf(0.0, slow_t - delta)
	if knock.length_squared() > 0.01:
		position += knock * delta
		knock = knock.lerp(Vector3.ZERO, minf(1.0, delta * 6.0))
	if pending_t >= 0.0:
		pending_t -= delta
		if pending_t < 0.0:
			_release_attack()
	if is_hero or scripted or not active:
		if not active and not is_hero and not scripted:
			loop_anim(idle_anim)
		return
	_ai(delta)


func _ai(delta: float) -> void:
	retarget_t -= delta
	if retarget_t <= 0.0 or target == null or target.dead:
		retarget_t = 0.35 + randf() * 0.3
		target = main.nearest_enemy(self, aggro)
	if is_boss:
		_boss_specials(delta)
	var moving := false
	if target:
		var d: Vector3 = target.position - position
		d.y = 0
		var dist := d.length() - target.radius - radius
		if dist > attack_range:
			_move(d.normalized(), delta)
			moving = true
		else:
			face(d)
			if cd_t <= 0.0 and lock_t <= 0.0:
				_start_attack()
	elif team == 1:
		var to_c: Vector3 = main.CRYSTAL_POS - position
		to_c.y = 0
		_move(to_c.normalized(), delta)
		moving = true
	else:
		var dest := home
		var h: Unit = main.hero
		if h != null and not h.dead:
			dest = h.position + form_off
		var to_h := dest - position
		to_h.y = 0
		if to_h.length() > 1.2:
			_move(to_h.normalized(), delta, minf(1.6, 0.6 + to_h.length() * 0.15))
			moving = true
		else:
			face(Vector3(1, 0, 0))
	if lock_t <= 0.0:
		loop_anim(run_anim if moving else idle_anim)


func _move(dir: Vector3, delta: float, mult := 1.0) -> void:
	position += dir * speed * mult * delta * (0.35 if lock_t > 0.0 else 1.0) * (0.4 if slow_t > 0.0 else 1.0)
	face(dir)


func _start_attack() -> void:
	cd_t = cd * (0.85 + randf() * 0.3) * (1.6 if slow_t > 0.0 else 1.0)
	pending_target = target
	if ranged:
		play_once(attack_anim, 0.6)
		pending_t = 0.3
	else:
		play_once(attack_anim, 0.75)
		pending_t = 0.35


func _release_attack() -> void:
	var tg := pending_target
	pending_target = null
	if tg == null or tg.dead or dead:
		return
	if ranged:
		var dir: Vector3 = tg.position - position
		main.spawn_proj(self, tg, dmg * power, position + Vector3(0, 1.3 * (2.0 if is_boss else 1.0), 0) + dir.normalized() * 0.6, dir)
	else:
		var dist := position.distance_to(tg.position) - tg.radius - radius
		if dist <= attack_range + 0.8:
			tg.take_damage(dmg * power * (0.85 + randf() * 0.3), self)


func _boss_specials(delta: float) -> void:
	special_t -= delta
	summon_t -= delta
	if summon_t <= 0.0 and lock_t <= 0.0:
		summon_t = 9.0 if enraged else 13.0
		play_once("Spellcast_Summon", 1.2)
		main.boss_summon(self)
	elif special_t <= 0.0 and lock_t <= 0.0 and target:
		special_t = 4.5 if enraged else 7.0
		play_once("Spellcast_Long" if anim and anim.has_animation("Spellcast_Long") else attack_anim, 1.0)
		main.boss_wave(self)
