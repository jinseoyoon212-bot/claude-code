extends Node
## 효과음·배경음악 관리 (자동 로드 싱글톤 "Sfx").

const NAMES := ["cast", "hit", "explode", "nova", "shield", "chain", "frost", "heal", "meteor", "coin", "click", "buy",
	"error", "wave", "boss", "win", "lose", "dash", "bones", "summon", "levelup", "impact", "whoosh"]

var streams := {}
var pool: Array = []
var pool_i := 0
var last_play := {}
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var cur_music := ""
var fade := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for n in NAMES:
		streams[n] = load("res://audio/%s.ogg" % n)
	for n in ["music_title", "music_battle", "music_boss"]:
		var s: AudioStreamOggVorbis = load("res://audio/%s.ogg" % n)
		s.loop = true
		streams[n] = s
	for i in 14:
		var p := AudioStreamPlayer.new()
		add_child(p)
		pool.append(p)
	music_a = AudioStreamPlayer.new()
	music_b = AudioStreamPlayer.new()
	add_child(music_a)
	add_child(music_b)


func _db(v: float) -> float:
	return linear_to_db(maxf(v, 0.0001))


func play(n: String, vol := 1.0, pitch_var := 0.08) -> void:
	if not streams.has(n) or Save.settings.sfx <= 0.01:
		return
	var now := Time.get_ticks_msec()
	if now - int(last_play.get(n, -1000)) < 45:
		return
	last_play[n] = now
	var p: AudioStreamPlayer = pool[pool_i]
	pool_i = (pool_i + 1) % pool.size()
	p.stream = streams[n]
	p.volume_db = _db(vol * Save.settings.sfx)
	p.pitch_scale = 1.0 + randf_range(-pitch_var, pitch_var)
	p.play()


func music(n: String) -> void:
	if n == cur_music:
		return
	cur_music = n
	var old := music_a
	music_a = music_b
	music_b = old
	if n != "" and streams.has(n):
		music_a.stream = streams[n]
		music_a.volume_db = -60.0
		music_a.play()
	fade = 1.0


func _process(delta: float) -> void:
	var target := _db(Save.settings.music * 0.7)
	if fade > 0.0:
		fade = maxf(0.0, fade - delta / 1.2)
		var k := 1.0 - fade
		music_a.volume_db = lerpf(-50.0, target, k) if music_a.playing else -60.0
		music_b.volume_db = lerpf(target, -50.0, k)
		if fade <= 0.0:
			music_b.stop()
	elif music_a.playing:
		music_a.volume_db = target
