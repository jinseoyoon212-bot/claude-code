extends Node
## 저장 데이터와 상점 목록 (자동 로드 싱글톤 "Save").

const PATH := "user://wizardwar.cfg"
const MAX_UP := 5
const MAX_SKILL := 5
const MAX_ITEM := 9
const MAX_EQUIP := 4

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

var gold := 100
var up := {"power": 0, "hp": 0, "speed": 0, "knight": 0, "crystal": 0, "mastery": 0}
var skills := {"shield": 1, "nova": 1, "summon": 1, "chain": 0, "frost": 0, "heal": 0, "meteor": 0}
var equipped: Array = ["shield", "nova", "summon"]
var items := {"potion_hp": 1, "potion_mana": 0, "potion_crystal": 0}
var best_wave := 0
var wins := 0
var next_action := ""   # 씬을 다시 불러온 뒤 할 일: "start" / "shop"


func _ready() -> void:
	load_data()


func load_data() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) != OK:
		return
	gold = int(cfg.get_value("p", "gold", gold))
	best_wave = int(cfg.get_value("p", "best_wave", 0))
	wins = int(cfg.get_value("p", "wins", 0))
	var u: Dictionary = cfg.get_value("p", "up", {})
	for k in up:
		up[k] = int(u.get(k, 0))
	var s: Dictionary = cfg.get_value("p", "skills", {})
	for k in skills:
		skills[k] = int(s.get(k, skills[k]))
	var it: Dictionary = cfg.get_value("p", "items", {})
	for k in items:
		items[k] = int(it.get(k, items[k]))
	var eq: Array = cfg.get_value("p", "equipped", equipped)
	equipped = eq.filter(func(e): return skills.has(e) and skills[e] > 0).slice(0, MAX_EQUIP)


func save_data() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("p", "gold", gold)
	cfg.set_value("p", "best_wave", best_wave)
	cfg.set_value("p", "wins", wins)
	cfg.set_value("p", "up", up)
	cfg.set_value("p", "skills", skills)
	cfg.set_value("p", "items", items)
	cfg.set_value("p", "equipped", equipped)
	cfg.save(PATH)


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
	## 스킬 레벨별 수치
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
