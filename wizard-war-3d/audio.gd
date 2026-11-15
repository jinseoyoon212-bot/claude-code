extends Node
## 효과음·배경음악 관리 (자동 로드 싱글톤 "Sfx").

const NAMES := ["cast", "hit", "explode", "nova", "shield", "chain", "frost", "heal", "meteor", "coin", "click", "buy",
	"error", "wave", "boss", "win", "lose", "dash", "bones", "summon", "levelup", "impact", "whoosh",
	"judge_charge", "judge_open", "star_fall", "star_hit", "judge_pillar"]

var streams := {}
var pool: Array = []
var pool_i := 0
var last_play := {}
var recent: Array = []
var stat_skipped := 0   # 빈 재생기가 없어 생략한 소리 수 (진단용)
var stat_stolen := 0    # 재생 중인 소리를 끊고 가져간 횟수 (진단용)
const BIG := ["win", "lose", "boss", "impact", "wave", "nova", "explode", "meteor", "summon", "levelup",
	"judge_charge", "judge_open", "judge_pillar"]
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var cur_music := ""
var fade := 0.0
var fade_len := 1.2
var duck := 1.0       # 음악 볼륨 배율 (컷씬에서 낮춘다)
var duck_now := 1.0
var music_t0_ms := 0     # 현재 곡이 (0초 기준으로) 시작된 실제 시각. 웹에서는 get_playback_position()이 항상 0이라 직접 잰다
var voice_ms := {}       # 효과음 재생기별 시작 시각 (가장 오래된 소리를 찾는 용도)
# 반복 이음새 겹침 길이: 박자의 정수배 (제목 76bpm×1박, 전투 124bpm×2박, 보스 138bpm×2박)
const LOOP_XF := {"music_title": 0.789, "music_battle": 0.968, "music_boss": 0.870}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for n in NAMES:
		streams[n] = load("res://audio/%s.ogg" % n)
	# 음악은 WAV(ADPCM) + 반복 설정은 *.wav.import 에서 지정 (Ogg는 반복 지점에서 0.2~0.3초 무음이 생김)
	for n in ["music_title", "music_battle", "music_boss"]:
		streams[n] = load("res://audio/%s.wav" % n)
	for i in 16:
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
	# 0.12초 안에 너무 많은 소리가 겹치면 작은 효과음은 건너뛴다 (웹은 소리 처리가 메인 스레드라 부담이 큼)
	recent = recent.filter(func(tm): return now - tm < 120)
	if recent.size() >= 4 and not BIG.has(n):
		return
	var p := _take_player(BIG.has(n))
	if p == null:
		return
	recent.append(now)
	last_play[n] = now
	voice_ms[p] = now
	p.stream = streams[n]
	p.volume_db = _db(vol * Save.settings.sfx)
	p.pitch_scale = 1.0 + randf_range(-pitch_var, pitch_var)
	p.play()


func _take_player(important: bool) -> AudioStreamPlayer:
	## 재생 중이 아닌 재생기를 우선 쓴다. 전부 사용 중이면 작은 소리는 생략하고,
	## 큰 소리만 가장 오래 재생된 소리를 끊고 가져간다 (예전에는 무조건 돌려써서 재생 중인 소리가 뚝 끊겼다).
	for i in pool.size():
		var cand: AudioStreamPlayer = pool[(pool_i + i) % pool.size()]
		if not cand.playing:
			pool_i = (pool_i + i + 1) % pool.size()
			return cand
	if not important:
		stat_skipped += 1
		return null
	var oldest: AudioStreamPlayer = pool[0]
	for cand in pool:
		if int(voice_ms.get(cand, 0)) < int(voice_ms.get(oldest, 0)):
			oldest = cand
	stat_stolen += 1
	return oldest


func music(n: String) -> void:
	if n == cur_music:
		return
	cur_music = n
	_start_music(n, 1.2, 0.0)


func _start_music(n: String, dur: float, from: float) -> void:
	## 새 곡(또는 같은 곡의 처음)을 다른 재생기로 시작하면서 지금 곡과 겹쳐 바꾼다.
	var old := music_a
	music_a = music_b
	music_b = old
	if n != "" and streams.has(n):
		music_a.stream = streams[n]
		music_a.volume_db = -60.0
		music_a.play(from)
		music_t0_ms = Time.get_ticks_msec() - int(from * 1000.0)
	fade = 1.0
	fade_len = dur


func _check_loop() -> void:
	## 곡 반복: 엔진의 자체 반복은 되돌아가는 순간 소리를 잠깐 비우고, 게임이 바쁘면 그 틈이 0.1~0.3초까지 늘어난다.
	## 곡 끝에 닿기 전에 같은 곡을 박자 단위로 겹쳐 시작해서 반복 지점을 아예 지나가지 않게 한다.
	var st := music_a.stream
	if st == null or cur_music == "":
		return
	var xf: float = LOOP_XF.get(cur_music, 1.0)
	var pos := (Time.get_ticks_msec() - music_t0_ms) / 1000.0
	var left := st.get_length() - pos
	if left <= xf:
		# 늦게 감지한 만큼(xf - left) 건너뛰고 시작하면 박자가 정확히 맞는다
		_start_music(cur_music, xf, clampf(xf - left, 0.0, xf * 0.5))


func _process(delta: float) -> void:
	var real_delta := delta / maxf(Engine.time_scale, 0.01)   # 슬로모션과 상관없이 실제 시간으로 페이드
	duck_now = move_toward(duck_now, duck, real_delta * 1.6)
	var vol: float = Save.settings.music * 0.7 * duck_now
	if fade > 0.0:
		fade = maxf(0.0, fade - real_delta / fade_len)
		var k := 1.0 - fade
		# 같은 세기로 겹쳐 바꾸기(equal-power): 중간에 소리가 푹 꺼지지 않는다
		music_a.volume_db = _db(sin(k * PI / 2.0) * vol) if music_a.playing else -60.0
		music_b.volume_db = _db(cos(k * PI / 2.0) * vol)
		if fade <= 0.0:
			music_b.stop()
	elif music_a.playing:
		music_a.volume_db = _db(vol)
		_check_loop()
	elif cur_music != "":
		_start_music(cur_music, 0.3, 0.0)   # 만약 곡이 끝나버렸다면 다시 시작 (안전장치)
