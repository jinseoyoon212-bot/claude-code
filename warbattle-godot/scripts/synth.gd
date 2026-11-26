class_name Synth
extends Node
## Procedurally synthesised sound effects (no sample files) and a pool of 3D players.

const RATE := 22050
var sounds := {}
var pool: Array[AudioStreamPlayer3D] = []
var ui_player := AudioStreamPlayer.new()
var wind := AudioStreamPlayer.new()
var engine := AudioStreamPlayer.new()
var rng := RandomNumberGenerator.new()


func _ready() -> void:
	rng.seed = 3
	_setup_buses()
	for k in ["carbine", "smg", "marksman", "pistol"]:
		sounds["shot_" + k] = _gunshot(k, false)
		sounds["far_" + k] = _gunshot(k, true)
	sounds.explosion = _explosion()
	sounds.step = _burst(0.12, 900.0, 0.5, 18.0)
	sounds.step_wood = _burst(0.12, 550.0, 0.5, 18.0)
	sounds.impact = _burst(0.1, 1500.0, 0.9, 30.0)
	sounds.impact_metal = _ring(0.25, 3400.0)
	sounds.click = _burst(0.04, 2600.0, 0.6, 80.0)
	sounds.clunk = _burst(0.07, 1000.0, 0.7, 50.0)
	sounds.hit = _ring(0.06, 3000.0)
	sounds.whiz = _whiz()
	for i in 24:
		var p := AudioStreamPlayer3D.new()
		p.bus = "World"
		p.unit_size = 8.0
		p.max_distance = 1200.0
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.panning_strength = 1.0
		add_child(p)
		pool.append(p)
	add_child(ui_player)
	wind.stream = _wind_loop()
	wind.volume_db = -20.0
	add_child(wind)
	engine.stream = _engine_loop()
	engine.volume_db = -80.0
	add_child(engine)


func _setup_buses() -> void:
	if AudioServer.get_bus_index("World") >= 0:
		return
	AudioServer.add_bus()
	var i := AudioServer.bus_count - 1
	AudioServer.set_bus_name(i, "World")
	AudioServer.set_bus_send(i, "Master")
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.55
	rev.damping = 0.6
	rev.wet = 0.18
	rev.dry = 1.0
	rev.predelay_msec = 60.0
	AudioServer.add_bus_effect(i, rev)
	var lim := AudioEffectLimiter.new()
	AudioServer.add_bus_effect(0, lim)


func start_ambience() -> void:
	if not wind.playing:
		wind.play()
	if not engine.playing:
		engine.play()


func play3d(key: String, pos: Vector3, vol_db := 0.0, pitch := 1.0) -> void:
	if not sounds.has(key):
		return
	var p: AudioStreamPlayer3D = null
	for q in pool:
		if not q.playing:
			p = q
			break
	if p == null:
		p = pool[rng.randi() % pool.size()]
	p.stream = sounds[key]
	p.global_position = pos
	p.volume_db = vol_db
	p.pitch_scale = pitch * rng.randf_range(0.95, 1.05)
	p.play()


func play2d(key: String, vol_db := 0.0) -> void:
	if not sounds.has(key):
		return
	var p := AudioStreamPlayer.new()
	p.stream = sounds[key]
	p.volume_db = vol_db
	add_child(p)
	p.play()
	p.finished.connect(p.queue_free)


# ---------------------------------------------------------------- generators
func _wav(s: PackedFloat32Array, loop := false) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(s.size() * 2)
	for i in s.size():
		data.encode_s16(i * 2, int(clampf(s[i], -1.0, 1.0) * 32000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.data = data
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = s.size()
	return w


func _noise() -> float:
	return rng.randf() * 2.0 - 1.0


# one-pole low-pass coefficient for a cutoff frequency
func _a(fc: float) -> float:
	return 1.0 - exp(-TAU * fc / RATE)


func _gunshot(kind: String, far: bool) -> AudioStreamWAV:
	var pa: Array = {"carbine": [1.0, 0.09, 140.0], "smg": [0.8, 0.07, 170.0], "marksman": [1.4, 0.16, 90.0], "pistol": [0.75, 0.07, 190.0]}[kind]
	var p0: float = pa[0]
	var p1: float = pa[1]
	var p2: float = pa[2]
	var dur := 1.4 if far else 0.9
	var n := int(dur * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp1 := 0.0
	var lp2 := 0.0
	var lpf := 0.0
	var a_body := _a(1400.0)
	var a_hp := _a(900.0)
	var a_out := _a(1100.0 if far else 9000.0)
	var ph := 0.0
	for i in n:
		var t := float(i) / RATE
		var nz := _noise()
		lp1 += (nz - lp1) * a_hp
		var crack := (nz - lp1) * p0 * 1.3 * exp(-t / (p1 * 0.35))
		lp2 += (nz - lp2) * a_body
		var body := lp2 * p0 * 2.2 * exp(-t / (p1 * 1.4))
		var f := lerpf(p2, 38.0, clampf(t / 0.18, 0, 1))
		ph += TAU * f / RATE
		var thump := sin(ph) * p0 * 0.9 * exp(-t / 0.07)
		# late slapback tail
		var tail := lp2 * 0.35 * p0 * exp(-maxf(0.0, t - 0.12) / 0.35) * (1.0 if t > 0.12 else 0.0)
		var v := crack + body + thump + tail
		lpf += (v - lpf) * a_out
		s[i] = lpf * (0.8 if far else 0.65)
	return _wav(s)


func _explosion() -> AudioStreamWAV:
	var n := int(2.2 * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	var lp2 := 0.0
	var ph := 0.0
	for i in n:
		var t := float(i) / RATE
		lp += (_noise() - lp) * _a(lerpf(2500.0, 300.0, clampf(t / 1.5, 0, 1)))
		lp2 += (lp - lp2) * 0.3
		ph += TAU * lerpf(70.0, 25.0, clampf(t / 0.8, 0, 1)) / RATE
		s[i] = (lp2 * 3.0 * exp(-t / 0.55) + sin(ph) * 1.0 * exp(-t / 0.35))
	return _wav(s)


func _burst(dur: float, fc: float, vol: float, decay: float) -> AudioStreamWAV:
	var n := int(dur * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	var hp := 0.0
	for i in n:
		var t := float(i) / RATE
		var nz := _noise()
		lp += (nz - lp) * _a(fc * 1.6)
		hp += (lp - hp) * _a(fc * 0.5)
		s[i] = (lp - hp) * vol * 2.5 * exp(-t * decay)
	return _wav(s)


func _ring(dur: float, f: float) -> AudioStreamWAV:
	var n := int(dur * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	for i in n:
		var t := float(i) / RATE
		s[i] = (sin(TAU * f * t) * 0.5 + sin(TAU * f * 1.51 * t) * 0.3 + _noise() * 0.2 * exp(-t * 60.0)) * exp(-t / (dur * 0.25)) * 0.6
	return _wav(s)


func _whiz() -> AudioStreamWAV:
	var n := int(0.16 * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	var hp := 0.0
	for i in n:
		var t := float(i) / RATE
		var f := lerpf(5000.0, 1800.0, t / 0.16)
		lp += (_noise() - lp) * _a(f * 1.3)
		hp += (lp - hp) * _a(f * 0.7)
		s[i] = (lp - hp) * 3.0 * sin(PI * t / 0.16)
	return _wav(s)


func _wind_loop() -> AudioStreamWAV:
	var n := int(6.0 * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / RATE
		var fc := 380.0 + 180.0 * sin(TAU * t / 6.0) + 90.0 * sin(TAU * t / 2.0)
		lp += (_noise() - lp) * _a(fc)
		s[i] = lp * 2.2
	# crossfade the ends for a seamless loop
	var xf := int(0.5 * RATE)
	for i in xf:
		var k := float(i) / xf
		s[i] = s[i] * k + s[n - xf + i] * (1.0 - k)
	s.resize(n - xf)
	return _wav(s, true)


func _engine_loop() -> AudioStreamWAV:
	var n := int(2.0 * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / RATE
		var saw := fmod(t * 62.0, 1.0) * 2.0 - 1.0 + fmod(t * 63.5, 1.0) * 2.0 - 1.0
		var v := saw * 0.5 + _noise() * 0.4
		lp += (v - lp) * _a(300.0)
		s[i] = lp * 1.4
	return _wav(s, true)
