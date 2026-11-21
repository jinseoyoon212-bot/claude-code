extends Node
## 저장 데이터, 상점·스테이지·업적 목록, 설정, 개발자 치트 (자동 로드 싱글톤 "Save").

const PATH := "user://wizardwar.cfg"
const MAX_UP := 5
const MAX_SKILL := 5
const MAX_ITEM := 9
const MAX_EQUIP := 4
const DEV_PASSWORD := "123230"

const UPGRADES := [
	{"id": "power", "name": "마력 강화", "icon": "up_power", "base": 40},
	{"id": "hp", "name": "생명력", "icon": "up_hp", "base": 40},
	{"id": "speed", "name": "신속 시전", "icon": "up_speed", "base": 60},
	{"id": "knight", "name": "기사단 훈련", "icon": "up_knight", "base": 50},
	{"id": "crystal", "name": "수정 강화", "icon": "up_crystal", "base": 35},
	{"id": "mastery", "name": "스킬 숙련", "icon": "up_mastery", "base": 70},
]

const SKILL_ORDER := ["shield", "nova", "summon", "chain", "frost", "heal", "meteor"]
const SKILLS := {
	"shield": {"name": "결계", "icon": "shield", "price": 0, "base": 60, "cd": 10.0},
	"nova": {"name": "별빛 폭발", "icon": "nova", "price": 0, "base": 60, "cd": 8.0},
	"summon": {"name": "기사 소환", "icon": "summon", "price": 0, "base": 80, "cd": 22.0},
	"chain": {"name": "번개 사슬", "icon": "chain", "price": 150, "base": 70, "cd": 6.0},
	"frost": {"name": "서리 폭풍", "icon": "frost", "price": 200, "base": 80, "cd": 14.0},
	"heal": {"name": "치유의 빛", "icon": "heal", "price": 120, "base": 60, "cd": 16.0},
	"meteor": {"name": "유성우", "icon": "meteor", "price": 300, "base": 100, "cd": 20.0},
}

const ITEMS := [
	{"id": "potion_hp", "name": "치유 물약", "desc": "대마법사 체력 50% 회복", "icon": "potion_hp", "price": 30},
	{"id": "potion_mana", "name": "마력 물약", "desc": "모든 스킬 대기시간 초기화", "icon": "potion_mana", "price": 50},
	{"id": "potion_crystal", "name": "수정의 정수", "desc": "빛의 수정 체력 40% 회복", "icon": "potion_crystal", "price": 40},
]

## 스테이지: waves=웨이브 수(0이면 무한), mult=적 체력·공격 배율, elite=정예 확률
const STAGES := [
	{"id": "s1", "name": "성문 앞 전투", "sub": "해골 군단의 첫 습격", "icon": "castle", "waves": 3, "mult": 1.0, "elite": 0.0,
		"boss": "boss_general", "env": "day", "reward": 150},
	{"id": "s2", "name": "달빛 숲", "sub": "망령왕이 숲을 뒤덮는다", "icon": "moon", "waves": 4, "mult": 1.25, "elite": 0.05,
		"boss": "boss_lich", "env": "night", "reward": 250},
	{"id": "s3", "name": "불타는 평원", "sub": "그림자 암살자의 습격", "icon": "flame", "waves": 4, "mult": 1.55, "elite": 0.1,
		"boss": "boss_rogue", "env": "fire", "reward": 350},
	{"id": "s4", "name": "얼어붙은 호수", "sub": "서리 거인이 깨어났다", "icon": "snow", "waves": 5, "mult": 1.9, "elite": 0.15,
		"boss": "boss_golem", "env": "ice", "reward": 450},
	{"id": "s5", "name": "어둠의 요새", "sub": "어둠의 군주 모르가스와의 결전", "icon": "portal", "waves": 5, "mult": 2.3, "elite": 0.2,
		"boss": "boss", "env": "dark", "reward": 700},
	{"id": "endless", "name": "끝없는 밤", "sub": "얼마나 버틸 수 있는가 (3스테이지 클리어 시 해금)", "icon": "infinity", "waves": 0, "mult": 1.0, "elite": 0.1,
		"boss": "", "env": "dark", "reward": 0},
]

const ACHIEVEMENTS := [
	{"id": "kill_1", "name": "첫 처치", "desc": "적 1명 처치", "stat": "kills", "goal": 1, "reward": 20},
	{"id": "kill_100", "name": "해골 사냥꾼", "desc": "적 100명 처치", "stat": "kills", "goal": 100, "reward": 150},
	{"id": "kill_500", "name": "군단 파괴자", "desc": "적 500명 처치", "stat": "kills", "goal": 500, "reward": 400},
	{"id": "kill_2000", "name": "빛의 전설", "desc": "적 2000명 처치", "stat": "kills", "goal": 2000, "reward": 1000},
	{"id": "boss_1", "name": "군주 사냥", "desc": "보스 1마리 처치", "stat": "bosses", "goal": 1, "reward": 150},
	{"id": "boss_10", "name": "어둠의 천적", "desc": "보스 10마리 처치", "stat": "bosses", "goal": 10, "reward": 600},
	{"id": "stage_all", "name": "빛의 수호자", "desc": "5개 스테이지 모두 클리어", "stat": "cleared", "goal": 5, "reward": 1000},
	{"id": "stars_15", "name": "완벽한 방어", "desc": "별 15개 모으기", "stat": "stars", "goal": 15, "reward": 1200},
	{"id": "skills_all", "name": "대현자", "desc": "스킬 7종 모두 습득", "stat": "skills", "goal": 7, "reward": 400},
	{"id": "endless_10", "name": "밤을 견딘 자", "desc": "끝없는 밤 웨이브 10 도달", "stat": "endless", "goal": 10, "reward": 600},
	{"id": "elite_20", "name": "정예 사냥꾼", "desc": "정예 적 20명 처치", "stat": "elites", "goal": 20, "reward": 300},
	{"id": "rich", "name": "부자 마법사", "desc": "골드 3000 이상 보유", "stat": "gold", "goal": 3000, "reward": 200},
]

var gold := 150
var up := {"power": 0, "hp": 0, "speed": 0, "knight": 0, "crystal": 0, "mastery": 0}
var skills := {"shield": 1, "nova": 1, "summon": 1, "chain": 0, "frost": 0, "heal": 0, "meteor": 0}
var equipped: Array = ["shield", "nova", "summon"]
var items := {"potion_hp": 1, "potion_mana": 0, "potion_crystal": 0}
var stars := {}
var stats := {"kills": 0, "bosses": 0, "elites": 0, "games": 0}
var endless_best := 0
var claimed: Array = []
var settings := {"music": 0.7, "sfx": 0.9, "shadows": true, "numbers": true, "shake": true, "fps": false, "gfx": 2}
var dev_unlocked := false
var current_stage := "s1"

# 실행 중에만 유지되는 값
var next_action := ""
var intro_seen := false
var audio_unlocked := false   # 웹: 첫 터치/클릭 뒤에야 소리를 낼 수 있음
var warmed := false           # 이펙트 셰이더 미리 컴파일 여부
var cheats := {"god": false, "one_hit": false, "no_cd": false, "speed": 1}
var touch_ui := false        # true면 터치 버튼·조이스틱, false면 키보드·마우스용 단축키 바
var touch_device := false    # 기기가 터치 위주(휴대폰·태블릿)인지
var _last_mouse_ms := -10000
var _pending_touch_ms := -1


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_detect_device()
	settings.gfx = 1 if touch_device else 2   # 그래픽 품질 기본값: 휴대폰·태블릿은 보통, PC는 높음 (저장된 값이 있으면 덮어쓴다)
	if not FileAccess.file_exists(PATH) and touch_device and OS.has_feature("web"):
		settings.shadows = false   # 모바일 브라우저는 그림자를 꺼서 부드럽게
	load_data()


func _detect_device() -> void:
	## 기기 종류를 자동으로 판별한다
	if OS.has_feature("web"):
		var js := "(window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)"
		touch_device = bool(JavaScriptBridge.eval(js, true))
	else:
		touch_device = OS.has_feature("mobile")
	touch_ui = touch_device


func _input(ev: InputEvent) -> void:
	## 실제 입력으로 조작 방식을 다시 판별한다
	## (터치 노트북에서 손가락을 쓰면 터치 UI, 키보드를 누르면 단축키 바)
	var now := Time.get_ticks_msec()
	if ev is InputEventMouseButton:
		_last_mouse_ms = now
	elif ev is InputEventKey and ev.pressed and touch_ui and not touch_device:
		touch_ui = false
	elif ev is InputEventKey and ev.pressed and touch_ui and ev.keycode in [KEY_W, KEY_A, KEY_S, KEY_D, KEY_SPACE]:
		touch_ui = false
	elif ev is InputEventScreenTouch and ev.pressed and not touch_ui:
		_pending_touch_ms = now


func _process(_d: float) -> void:
	# 마우스 클릭이 만든 가짜 터치가 아니라 진짜 손가락 터치일 때만 터치 UI로 전환
	if _pending_touch_ms >= 0 and Time.get_ticks_msec() - _pending_touch_ms > 120:
		if absi(_pending_touch_ms - _last_mouse_ms) > 150:
			touch_ui = true
		_pending_touch_ms = -1


func load_data() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) != OK:
		return
	gold = int(cfg.get_value("p", "gold", gold))
	endless_best = int(cfg.get_value("p", "endless_best", 0))
	dev_unlocked = bool(cfg.get_value("p", "dev", false))
	current_stage = str(cfg.get_value("p", "stage", "s1"))
	for pair in [[up, "up"], [skills, "skills"], [items, "items"], [stats, "stats"], [settings, "settings"]]:
		var src: Dictionary = cfg.get_value("p", pair[1], {})
		var dst: Dictionary = pair[0]
		for k in dst:
			if src.has(k):
				dst[k] = src[k]
	stars = cfg.get_value("p", "stars", {})
	claimed = cfg.get_value("p", "claimed", [])
	var eq: Array = cfg.get_value("p", "equipped", equipped)
	equipped = eq.filter(func(e): return skills.has(e) and skills[e] > 0).slice(0, MAX_EQUIP)
	if equipped.is_empty():
		equipped = ["shield"]


func save_data() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("p", "gold", gold)
	cfg.set_value("p", "endless_best", endless_best)
	cfg.set_value("p", "dev", dev_unlocked)
	cfg.set_value("p", "stage", current_stage)
	cfg.set_value("p", "up", up)
	cfg.set_value("p", "skills", skills)
	cfg.set_value("p", "items", items)
	cfg.set_value("p", "stats", stats)
	cfg.set_value("p", "settings", settings)
	cfg.set_value("p", "stars", stars)
	cfg.set_value("p", "claimed", claimed)
	cfg.set_value("p", "equipped", equipped)
	cfg.save(PATH)


func reset_all() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(PATH))
	gold = 150
	for k in up: up[k] = 0
	skills = {"shield": 1, "nova": 1, "summon": 1, "chain": 0, "frost": 0, "heal": 0, "meteor": 0}
	equipped = ["shield", "nova", "summon"]
	items = {"potion_hp": 1, "potion_mana": 0, "potion_crystal": 0}
	stars = {}
	stats = {"kills": 0, "bosses": 0, "elites": 0, "games": 0}
	endless_best = 0
	claimed = []
	current_stage = "s1"
	save_data()


# ---------- 스테이지 ----------
func stage(id: String) -> Dictionary:
	for s in STAGES:
		if s.id == id:
			return s
	return STAGES[0]


func stage_unlocked(id: String) -> bool:
	if id == "s1":
		return true
	if id == "endless":
		return int(stars.get("s3", 0)) > 0
	for i in STAGES.size():
		if STAGES[i].id == id:
			return int(stars.get(STAGES[i - 1].id, 0)) > 0
	return false


func total_stars() -> int:
	var n := 0
	for k in stars:
		n += int(stars[k])
	return n


func cleared_count() -> int:
	var n := 0
	for s in STAGES:
		if s.id != "endless" and int(stars.get(s.id, 0)) > 0:
			n += 1
	return n


# ---------- 업적 ----------
func stat_value(st: String) -> int:
	match st:
		"cleared": return cleared_count()
		"stars": return total_stars()
		"skills": return skills.values().filter(func(v): return v > 0).size()
		"endless": return endless_best
		"gold": return gold
	return int(stats.get(st, 0))


func achievement_ready(a: Dictionary) -> bool:
	return not claimed.has(a.id) and stat_value(a.stat) >= a.goal


func unclaimed_count() -> int:
	return ACHIEVEMENTS.filter(func(a): return achievement_ready(a)).size()


func claim(id: String) -> String:
	for a in ACHIEVEMENTS:
		if a.id == id:
			if claimed.has(id):
				return "이미 받은 보상입니다"
			if stat_value(a.stat) < a.goal:
				return "아직 조건을 달성하지 못했습니다"
			claimed.append(id)
			gold += a.reward
			save_data()
			return ""
	return "알 수 없는 업적"


# ---------- 가격 ----------
func up_cost(id: String) -> int:
	for u in UPGRADES:
		if u.id == id:
			return u.base * (up[id] + 1)
	return 0


func skill_cost(id: String) -> int:
	var lv: int = skills[id]
	return SKILLS[id].price if lv == 0 else SKILLS[id].base * lv


func item_cost(id: String) -> int:
	for it in ITEMS:
		if it.id == id:
			return it.price
	return 0


# ---------- 구매 (실패 시 이유 문자열, 성공 시 "") ----------
func buy_upgrade(id: String) -> String:
	if up[id] >= MAX_UP:
		return "이미 최대 단계입니다"
	var c := up_cost(id)
	if gold < c:
		return "골드가 %d 부족합니다" % (c - gold)
	gold -= c
	up[id] += 1
	save_data()
	return ""


func buy_skill(id: String) -> String:
	if skills[id] >= MAX_SKILL:
		return "이미 최대 레벨입니다"
	var c := skill_cost(id)
	if gold < c:
		return "골드가 %d 부족합니다" % (c - gold)
	gold -= c
	skills[id] += 1
	if skills[id] == 1 and equipped.size() < MAX_EQUIP:
		equipped.append(id)
	save_data()
	return ""


func buy_item(id: String) -> String:
	if items[id] >= MAX_ITEM:
		return "최대 %d개까지 가질 수 있습니다" % MAX_ITEM
	var c := item_cost(id)
	if gold < c:
		return "골드가 %d 부족합니다" % (c - gold)
	gold -= c
	items[id] += 1
	save_data()
	return ""


func toggle_equip(id: String) -> String:
	if skills[id] == 0:
		return "먼저 스킬을 구매하세요"
	if equipped.has(id):
		if equipped.size() <= 1:
			return "스킬은 최소 1개 장착해야 합니다"
		equipped.erase(id)
	else:
		if equipped.size() >= MAX_EQUIP:
			return "스킬 슬롯은 %d칸입니다. 다른 스킬을 먼저 해제하세요" % MAX_EQUIP
		equipped.append(id)
	save_data()
	return ""


# ---------- 개발자 치트 ----------
func cheat(id: String) -> String:
	match id:
		"gold":
			gold += 10000
		"max_up":
			for k in up: up[k] = MAX_UP
		"max_skill":
			for k in skills: skills[k] = MAX_SKILL
			equipped = ["meteor", "chain", "nova", "shield"]
		"items":
			for k in items: items[k] = MAX_ITEM
		"stages":
			for s in STAGES:
				if s.id != "endless":
					stars[s.id] = 3
		"god", "one_hit", "no_cd":
			cheats[id] = not cheats[id]
			return ("켜짐: " if cheats[id] else "꺼짐: ") + {"god": "무적 모드", "one_hit": "한 방 처치", "no_cd": "대기시간 없음"}[id]
		"speed":
			cheats.speed = 1 if cheats.speed >= 3 else cheats.speed + 1
			return "게임 속도 x%d" % cheats.speed
		"lock":
			dev_unlocked = false
			cheats = {"god": false, "one_hit": false, "no_cd": false, "speed": 1}
	save_data()
	return "적용 완료"


# ---------- 수치 ----------
func up_desc(id: String, lv: int) -> String:
	match id:
		"power": return "공격 피해 +%d%%" % (lv * 15)
		"hp": return "대마법사 체력 +%d%%" % (lv * 15)
		"speed": return "공격 속도 +%d%%" % (lv * 12)
		"knight": return "아군 체력·피해 +%d%%" % (lv * 15)
		"crystal": return "빛의 수정 체력 +%d%%" % (lv * 20)
		"mastery": return "스킬 대기시간 -%d%%" % (lv * 8)
	return ""


func skill_cd(id: String) -> float:
	var lv := maxi(1, skills[id])
	return SKILLS[id].cd * (1.0 - 0.05 * (lv - 1)) * (1.0 - 0.08 * up.mastery)


func sv(id: String, lv: int) -> Dictionary:
	lv = maxi(1, lv)
	match id:
		"shield": return {"dur": 3.0 + 0.5 * lv}
		"nova": return {"dmg": 50.0 + 20.0 * lv, "rad": 6.0 + 0.4 * lv}
		"summon": return {"count": 1 + int(ceil(lv / 2.0))}
		"chain": return {"dmg": 30.0 + 12.0 * lv, "jumps": 2 + lv}
		"frost": return {"dmg": 15.0 + 10.0 * lv, "dur": 2.5 + 0.5 * lv, "rad": 9.0}
		"heal": return {"hero": 0.2 + 0.08 * lv, "ally": 0.15 + 0.05 * lv}
		"meteor": return {"count": 4 + lv, "dmg": 50.0 + 15.0 * lv}
	return {}


func skill_desc(id: String, lv: int) -> String:
	var v := sv(id, lv)
	match id:
		"shield": return "%.1f초 동안 무적" % v.dur
		"nova": return "주변 %.0fm 피해 %d + 넉백" % [v.rad, v.dmg]
		"summon": return "빛의 기사 %d명 소환" % v.count
		"chain": return "적 %d명에게 연쇄 번개 %d" % [v.jumps, v.dmg]
		"frost": return "%.0fm 적 둔화 %.1f초 + 피해 %d" % [v.rad, v.dur, v.dmg]
		"heal": return "본인 %d%%, 아군·수정 %d%% 회복" % [v.hero * 100, v.ally * 100]
		"meteor": return "유성 %d개, 각 피해 %d" % [v.count, v.dmg]
	return ""
