class_name Hud
extends CanvasLayer
## Menu, loading screen, in-game HUD, big map, end screen and touch controls.

signal deploy(settings: Dictionary)
signal again
signal touch_button(name: String)

const AMBER := Color(1.0, 0.70, 0.28)
const TEXT := Color(0.925, 0.9, 0.82)
const MUTED := Color(0.66, 0.635, 0.55)
const PANEL := Color(0.055, 0.063, 0.05, 0.62)
const LINE := Color(0.91, 0.886, 0.8, 0.22)

var game: Node
var f_display: FontFile = load("res://assets/fonts/BarlowCondensed-ExtraBold.ttf")
var f_semi: FontFile = load("res://assets/fonts/BarlowCondensed-SemiBold.ttf")
var f_body: FontFile = load("res://assets/fonts/Barlow-Medium.ttf")

var menu: Control
var loading: Control
var load_bar: ProgressBar
var load_text: Label
var hud: Control
var compass: Control
var minimap: Control
var alive_l: Label
var kills_l: Label
var zone_l: Label
var feed: VBoxContainer
var hp_fill: ColorRect
var hp_bg: ColorRect
var gear_l: Label
var meds_l: Label
var slots: Array[Label] = []
var ammo_mag: Label
var ammo_res: Label
var prompt: Label
var toast: Label
var toast_t := 0.0
var actbar: ColorRect
var actfill: ColorRect
var act_l: Label
var cross: Control
var hitmark: Control
var hit_t := 0.0
var hit_col := Color.WHITE
var vig_damage: ColorRect
var vig_zone: ColorRect
var scope: Control
var bigmap: Control
var endscreen: Control
var end_title: Label
var end_rank: Label
var end_stats: Label
var touch: Control
var stick_knob: Control
var fps_l: Label
var settings := {"quality": "high", "view": "tpp", "sens": 1.0, "fov": 80.0, "bots": 29}
var spread_px := 8.0
var map_tex: ImageTexture


func _ready() -> void:
	layer = 10
	var th := Theme.new()
	th.default_font = f_body
	th.default_font_size = 16
	th.set_color("font_color", "Label", TEXT)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = th
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_load_settings()
	_build_hud(root)
	_build_touch(root)
	_build_bigmap(root)
	_build_end(root)
	_build_loading(root)
	_build_menu(root)


func _lbl(text: String, font: FontFile, size: int, col := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	l.add_theme_constant_override("shadow_offset_y", 1)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _panel(col := PANEL) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.border_color = LINE
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(3)
	sb.content_margin_left = 9
	sb.content_margin_right = 9
	sb.content_margin_top = 2
	sb.content_margin_bottom = 2
	return sb


# ---------------------------------------------------------------- menu
func _build_menu(root: Control) -> void:
	menu = ColorRect.new()
	(menu as ColorRect).color = Color(0.07, 0.08, 0.06)
	menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(menu)
	var m := MarginContainer.new()
	m.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 48)
	menu.add_child(m)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 56)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	m.add_child(row)
	var brand := VBoxContainer.new()
	brand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	brand.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	brand.add_theme_constant_override("separation", 10)
	brand.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_child(brand)
	var title := HBoxContainer.new()
	title.add_theme_constant_override("separation", 0)
	title.add_child(_lbl("WAR", f_display, 128))
	title.add_child(_lbl("BATTLE", f_display, 128, AMBER))
	brand.add_child(title)
	brand.add_child(_lbl("KESTREL ISLAND  ·  1.6 KM²  ·  LAST ONE STANDING", f_semi, 18, MUTED))
	var p := _lbl("Jump from the transport, land where you dare, and scavenge what you can find in the houses, warehouses and the Ridgeback military base. The firestorm closes in every few minutes. Thirty fighters drop; one walks out.", f_body, 17, Color(0.81, 0.79, 0.7))
	p.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.custom_minimum_size.x = 520
	brand.add_child(p)
	var card := PanelContainer.new()
	var sb := _panel(Color(0.04, 0.047, 0.035, 0.85))
	sb.set_content_margin_all(22)
	card.add_theme_stylebox_override("panel", sb)
	card.custom_minimum_size.x = 420
	card.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(card)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	card.add_child(v)
	v.add_child(_option("Graphics", "quality", ["low", "medium", "high", "ultra"], ["Low (phones)", "Medium", "High", "Ultra"]))
	v.add_child(_option("Camera", "view", ["tpp", "fpp"], ["Third person", "First person"]))
	v.add_child(_slider("Sensitivity", "sens", 0.2, 3.0, 0.05))
	v.add_child(_slider("Field of view", "fov", 60, 103, 1))
	v.add_child(_slider("Opponents", "bots", 5, 39, 1))
	var play := Button.new()
	play.text = "DEPLOY"
	play.add_theme_font_override("font", f_display)
	play.add_theme_font_size_override("font_size", 30)
	var pb := StyleBoxFlat.new()
	pb.bg_color = AMBER
	pb.set_corner_radius_all(4)
	pb.set_content_margin_all(12)
	play.add_theme_stylebox_override("normal", pb)
	var pbh := pb.duplicate() as StyleBoxFlat
	pbh.bg_color = AMBER.lightened(0.1)
	play.add_theme_stylebox_override("hover", pbh)
	play.add_theme_stylebox_override("pressed", pbh)
	play.add_theme_color_override("font_color", Color(0.1, 0.07, 0.02))
	play.add_theme_color_override("font_hover_color", Color(0.1, 0.07, 0.02))
	play.pressed.connect(func(): _save_settings(); deploy.emit(settings))
	v.add_child(play)
	var keys := _lbl("WASD move · Shift sprint · RMB aim · F jump/canopy/pick up · R reload · C crouch · Q/E lean · 1-3 weapons · G grenade · T smoke · H heal · V view · M map", f_body, 13, MUTED)
	keys.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	keys.custom_minimum_size.x = 370
	v.add_child(keys)
	var cred := _lbl("Props, plants, textures and sky: CC0 assets from Poly Haven. Soldier: Mixamo character. Fonts: Barlow (OFL). Engine: Godot.", f_body, 12, Color(0.54, 0.52, 0.45))
	cred.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	cred.custom_minimum_size.x = 370
	v.add_child(cred)


func _row(label: String) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	var l := _lbl(label.to_upper(), f_semi, 15, MUTED)
	l.custom_minimum_size.x = 120
	h.add_child(l)
	return h


func _option(label: String, key: String, values: Array, names: Array) -> Control:
	var h := _row(label)
	var ob := OptionButton.new()
	for i in names.size():
		ob.add_item(names[i], i)
	ob.selected = maxi(0, values.find(settings[key]))
	ob.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ob.item_selected.connect(func(i): settings[key] = values[i])
	h.add_child(ob)
	return h


func _slider(label: String, key: String, lo: float, hi: float, step: float) -> Control:
	var h := _row(label)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = settings[key]
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var out := _lbl(str(settings[key]), f_semi, 16)
	out.custom_minimum_size.x = 44
	s.value_changed.connect(func(v): settings[key] = (int(v) if step >= 1 else v); out.text = ("%d" % v) if step >= 1 else ("%.2f" % v))
	h.add_child(s)
	h.add_child(out)
	return h


func _load_settings() -> void:
	if OS.has_feature("mobile") or OS.has_feature("web_android") or OS.has_feature("web_ios"):
		settings.quality = "low"
	elif OS.has_feature("web"):
		settings.quality = "medium"
	var cf := ConfigFile.new()
	if cf.load("user://settings.cfg") == OK:
		for k in settings.keys():
			settings[k] = cf.get_value("s", k, settings[k])


func _save_settings() -> void:
	var cf := ConfigFile.new()
	for k in settings.keys():
		cf.set_value("s", k, settings[k])
	cf.save("user://settings.cfg")


# ---------------------------------------------------------------- loading
func _build_loading(root: Control) -> void:
	loading = ColorRect.new()
	(loading as ColorRect).color = Color(0.054, 0.063, 0.05)
	loading.set_anchors_preset(Control.PRESET_FULL_RECT)
	loading.visible = false
	root.add_child(loading)
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	loading.add_child(c)
	var v := VBoxContainer.new()
	v.custom_minimum_size.x = 520
	c.add_child(v)
	v.add_child(_lbl("PREPARING THE DROP", f_display, 44))
	load_bar = ProgressBar.new()
	load_bar.show_percentage = false
	load_bar.custom_minimum_size.y = 5
	var fill := StyleBoxFlat.new()
	fill.bg_color = AMBER
	load_bar.add_theme_stylebox_override("fill", fill)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.1)
	load_bar.add_theme_stylebox_override("background", bg)
	v.add_child(load_bar)
	load_text = _lbl("Starting", f_body, 15, MUTED)
	v.add_child(load_text)


func show_loading(p: float, text: String) -> void:
	menu.visible = false
	loading.visible = p < 1.0
	load_bar.value = p * 100.0
	load_text.text = text


# ---------------------------------------------------------------- HUD
func _build_hud(root: Control) -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	root.add_child(hud)
	vig_damage = _vignette(Color(0.6, 0.04, 0.0))
	vig_zone = _vignette(Color(1.0, 0.35, 0.08))
	hud.add_child(vig_damage)
	hud.add_child(vig_zone)
	scope = Control.new()
	scope.set_anchors_preset(Control.PRESET_FULL_RECT)
	scope.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scope.draw.connect(_draw_scope)
	scope.visible = false
	hud.add_child(scope)
	compass = Control.new()
	compass.mouse_filter = Control.MOUSE_FILTER_IGNORE
	compass.set_anchors_preset(Control.PRESET_CENTER_TOP)
	compass.custom_minimum_size = Vector2(460, 60)
	compass.position = Vector2(-230, 10)
	compass.draw.connect(_draw_compass)
	hud.add_child(compass)
	zone_l = _lbl("", f_semi, 16, AMBER)
	zone_l.set_anchors_preset(Control.PRESET_CENTER_TOP)
	zone_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	zone_l.position = Vector2(-200, 70)
	zone_l.size = Vector2(400, 24)
	hud.add_child(zone_l)
	feed = VBoxContainer.new()
	feed.position = Vector2(14, 14)
	feed.add_theme_constant_override("separation", 4)
	hud.add_child(feed)
	var mapbox := VBoxContainer.new()
	mapbox.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	mapbox.position = Vector2(-226, 14)
	mapbox.alignment = BoxContainer.ALIGNMENT_END
	hud.add_child(mapbox)
	minimap = Control.new()
	minimap.custom_minimum_size = Vector2(210, 210)
	minimap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	minimap.clip_contents = true
	minimap.draw.connect(_draw_minimap)
	mapbox.add_child(minimap)
	var counts := HBoxContainer.new()
	counts.alignment = BoxContainer.ALIGNMENT_END
	mapbox.add_child(counts)
	alive_l = _count(counts, "ALIVE")
	kills_l = _count(counts, "KILLS")
	var bottom := VBoxContainer.new()
	bottom.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bottom.position = Vector2(-220, -62)
	bottom.custom_minimum_size.x = 440
	hud.add_child(bottom)
	meds_l = _lbl("", f_semi, 14, MUTED)
	meds_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bottom.add_child(meds_l)
	var hprow := HBoxContainer.new()
	bottom.add_child(hprow)
	gear_l = _lbl("", f_display, 14)
	hprow.add_child(gear_l)
	hp_bg = ColorRect.new()
	hp_bg.color = Color(0, 0, 0, 0.5)
	hp_bg.custom_minimum_size = Vector2(380, 11)
	hp_bg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	hprow.add_child(hp_bg)
	hp_fill = ColorRect.new()
	hp_fill.color = TEXT
	hp_fill.size = Vector2(380, 11)
	hp_bg.add_child(hp_fill)
	var wbox := VBoxContainer.new()
	wbox.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	wbox.position = Vector2(-240, -170)
	wbox.custom_minimum_size.x = 225
	wbox.alignment = BoxContainer.ALIGNMENT_END
	hud.add_child(wbox)
	for i in 3:
		var l := _lbl("", f_semi, 16)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		l.add_theme_stylebox_override("normal", _panel())
		wbox.add_child(l)
		slots.append(l)
	var arow := HBoxContainer.new()
	arow.alignment = BoxContainer.ALIGNMENT_END
	wbox.add_child(arow)
	ammo_mag = _lbl("", f_display, 46)
	ammo_res = _lbl("", f_semi, 22, MUTED)
	arow.add_child(ammo_mag)
	arow.add_child(ammo_res)
	cross = Control.new()
	cross.set_anchors_preset(Control.PRESET_CENTER)
	cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cross.draw.connect(_draw_cross)
	hud.add_child(cross)
	hitmark = Control.new()
	hitmark.set_anchors_preset(Control.PRESET_CENTER)
	hitmark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hitmark.draw.connect(_draw_hit)
	hud.add_child(hitmark)
	prompt = _lbl("", f_semi, 18)
	prompt.set_anchors_preset(Control.PRESET_CENTER)
	prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt.position = Vector2(-250, 62)
	prompt.size = Vector2(500, 30)
	prompt.add_theme_stylebox_override("normal", _panel())
	hud.add_child(prompt)
	actbar = ColorRect.new()
	actbar.color = Color(1, 1, 1, 0.12)
	actbar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	actbar.set_anchors_preset(Control.PRESET_CENTER)
	actbar.position = Vector2(-110, 128)
	actbar.size = Vector2(220, 4)
	hud.add_child(actbar)
	actfill = ColorRect.new()
	actfill.color = Color(0.5, 0.81, 0.48)
	actfill.size = Vector2(0, 4)
	actbar.add_child(actfill)
	act_l = _lbl("", f_semi, 14)
	act_l.set_anchors_preset(Control.PRESET_CENTER)
	act_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	act_l.position = Vector2(-150, 104)
	act_l.size = Vector2(300, 20)
	hud.add_child(act_l)
	toast = _lbl("", f_display, 24)
	toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.position = Vector2(-400, 190)
	toast.size = Vector2(800, 34)
	hud.add_child(toast)
	fps_l = _lbl("", f_body, 12, Color(TEXT, 0.5))
	fps_l.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	fps_l.position = Vector2(12, -24)
	hud.add_child(fps_l)


func _count(parent: Control, word: String) -> Label:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", _panel())
	var h := HBoxContainer.new()
	pc.add_child(h)
	var n := _lbl("0", f_display, 22)
	h.add_child(n)
	h.add_child(_lbl(word, f_semi, 13, MUTED))
	parent.add_child(pc)
	return n


func _vignette(col: Color) -> ColorRect:
	var r := ColorRect.new()
	r.set_anchors_preset(Control.PRESET_FULL_RECT)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = "shader_type canvas_item; uniform vec4 col : source_color; uniform float amount = 0.0; void fragment(){ float d = distance(UV, vec2(0.5)); COLOR = vec4(col.rgb, smoothstep(0.3, 0.75, d) * amount); }"
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("col", col)
	r.material = m
	return r


func _draw_compass() -> void:
	if game == null or game.player == null:
		return
	var deg := fposmod(-rad_to_deg(game.cam_yaw), 360.0)
	var w := compass.size.x
	var labels := {0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW"}
	for d in range(-360, 721, 15):
		var x := w / 2.0 + (d - deg) * 4.0
		if x < 10 or x > w - 10:
			continue
		var a := 1.0 - absf(x - w / 2.0) / (w / 2.0) * 0.9
		var n := posmod(d, 360)
		if labels.has(n):
			var big := n % 90 == 0
			compass.draw_string(f_display if big else f_semi, Vector2(x - 12, 20), labels[n], HORIZONTAL_ALIGNMENT_CENTER, 24, 18 if big else 14, Color(AMBER if big else TEXT, a))
		else:
			compass.draw_string(f_semi, Vector2(x - 12, 18), str(n), HORIZONTAL_ALIGNMENT_CENTER, 24, 13, Color(TEXT, a))
		compass.draw_line(Vector2(x + 30, 24), Vector2(x + 30, 30), Color(TEXT, a * 0.6), 1.0)
	compass.draw_string(f_display, Vector2(w / 2.0 - 30, 50), "%03d" % int(deg), HORIZONTAL_ALIGNMENT_CENTER, 60, 14, TEXT)


func _draw_minimap() -> void:
	if game == null or game.player == null or map_tex == null:
		return
	var W := minimap.size.x
	var view := 260.0
	var c: Vector3 = game.view_center()
	minimap.draw_rect(Rect2(Vector2.ZERO, minimap.size), Color(0.17, 0.31, 0.35))
	var img_s := map_tex.get_width() / World.MAP_SIZE
	var src := Rect2((c.x + World.HALF - view / 2.0) * img_s, (c.z + World.HALF - view / 2.0) * img_s, view * img_s, view * img_s)
	minimap.draw_texture_rect_region(map_tex, Rect2(Vector2.ZERO, minimap.size), src)
	var to_m := func(x: float, z: float) -> Vector2: return Vector2((x - c.x) / view * W + W / 2.0, (z - c.z) / view * W + W / 2.0)
	_draw_zone(minimap, to_m, W / view)
	_arrow(minimap, Vector2(W / 2.0, W / 2.0), game.cam_yaw, 8.0)
	minimap.draw_rect(Rect2(Vector2.ZERO, minimap.size), LINE, false, 1.0)


func _draw_zone(ci: CanvasItem, to_m: Callable, scale: float) -> void:
	var z: Dictionary = game.zone
	var c: Vector2 = to_m.call(z.c.x, z.c.y)
	ci.draw_arc(c, z.r * scale, 0, TAU, 96, Color(1, 0.48, 0.18), 2.0)
	if z.nc != null and z.stage != "final":
		var n: Vector2 = to_m.call(z.nc.x, z.nc.y)
		ci.draw_arc(n, z.nr * scale, 0, TAU, 96, Color(1, 1, 1, 0.9), 1.5)


func _arrow(ci: CanvasItem, p: Vector2, yaw: float, s: float) -> void:
	var r := -yaw
	var pts := PackedVector2Array([Vector2(0, -s), Vector2(s * 0.7, s * 0.75), Vector2(0, s * 0.4), Vector2(-s * 0.7, s * 0.75)])
	for i in pts.size():
		pts[i] = p + pts[i].rotated(r)
	ci.draw_colored_polygon(pts, Color(0.96, 0.91, 0.78))
	pts.append(pts[0])
	ci.draw_polyline(pts, Color(0.08, 0.08, 0.08), 1.5)


func _draw_cross() -> void:
	var g := spread_px
	var c := Color(0.94, 0.94, 0.9, 0.9)
	for d in [Vector2.UP, Vector2.DOWN, Vector2.LEFT, Vector2.RIGHT]:
		cross.draw_line(d * g, d * (g + 8), Color(0, 0, 0, 0.6), 4.0)
		cross.draw_line(d * g, d * (g + 8), c, 2.0)
	cross.draw_rect(Rect2(-1, -1, 2, 2), c)


func _draw_hit() -> void:
	if hit_t <= 0.0:
		return
	for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
		hitmark.draw_line(d * 5, d * 13, hit_col, 2.5)


func _draw_scope() -> void:
	var s := scope.size
	var r := minf(s.x, s.y) * 0.36
	var c := s / 2.0
	# black surround with a round window
	var pts := PackedVector2Array()
	for i in 65:
		pts.append(c + Vector2.from_angle(i / 64.0 * TAU) * r)
	scope.draw_rect(Rect2(0, 0, s.x, c.y - r), Color.BLACK)
	scope.draw_rect(Rect2(0, c.y + r, s.x, s.y), Color.BLACK)
	scope.draw_rect(Rect2(0, 0, c.x - r, s.y), Color.BLACK)
	scope.draw_rect(Rect2(c.x + r, 0, s.x, s.y), Color.BLACK)
	for i in 64:
		var a0 := i / 64.0 * TAU
		var a1 := (i + 1) / 64.0 * TAU
		var p0 := c + Vector2.from_angle(a0) * r
		var p1 := c + Vector2.from_angle(a1) * r
		var q0 := c + Vector2.from_angle(a0) * r * 2.0
		var q1 := c + Vector2.from_angle(a1) * r * 2.0
		scope.draw_colored_polygon(PackedVector2Array([p0, q0, q1, p1]), Color.BLACK)
	scope.draw_line(c - Vector2(r, 0), c + Vector2(r, 0), Color(0, 0, 0, 0.85), 1.0)
	scope.draw_line(c - Vector2(0, r), c - Vector2(0, r * 0.08), Color(0, 0, 0, 0.85), 1.0)
	scope.draw_line(c + Vector2(0, r * 0.08), c + Vector2(0, r), Color(0, 0, 0, 0.85), 1.0)


func update_hud(delta: float, p: Actor) -> void:
	toast_t -= delta
	toast.modulate.a = clampf(toast_t * 2.0, 0, 1)
	hit_t -= delta
	hitmark.queue_redraw()
	compass.queue_redraw()
	minimap.queue_redraw()
	if bigmap.visible:
		bigmap.queue_redraw()
	hp_fill.size.x = 380.0 * clampf(p.hp, 0, 100) / 100.0
	hp_fill.color = Color(0.89, 0.33, 0.23) if p.hp < 30 else (Color(0.5, 0.81, 0.48) if p.heal_t > 0 else TEXT)
	(vig_damage.material as ShaderMaterial).set_shader_parameter("amount", game.damage_flash)
	(vig_zone.material as ShaderMaterial).set_shader_parameter("amount", 0.7 if (p.state == "ground" and game.outside_zone(p.global_position)) else 0.0)
	var w = p.weapon()
	cross.visible = not p.ads and p.state == "ground" and p.alive
	scope.visible = p.ads and w != null and Weapons.DATA[w.kind].scope
	if w:
		var sp := Vector2(p.velocity.x, p.velocity.z).length()
		spread_px = 6.0 + Weapons.DATA[w.kind].spread * (1.0 + sp * 0.12) * (0.75 if p.crouch else 1.0) * 900.0
		cross.queue_redraw()
	if p.heal_t > 0 or p.reload_t > 0:
		actbar.visible = true
		act_l.visible = true
		var tot: float = p.heal_max if p.heal_t > 0 else Weapons.DATA[w.kind].reload
		var rem: float = p.heal_t if p.heal_t > 0 else p.reload_t
		actfill.size = Vector2(220.0 * (1.0 - rem / tot), 4)
		act_l.text = ("Using medkit" if p.heal_kind == "medkit" else "Applying bandage") + " %.1fs" % rem if p.heal_t > 0 else "Reloading %.1fs" % rem
	else:
		actbar.visible = false
		act_l.visible = false
	prompt.text = game.prompt_text()
	prompt.visible = prompt.text != ""
	var alive := 0
	for a in game.actors:
		if a.alive:
			alive += 1
	alive_l.text = str(alive)
	kills_l.text = str(p.kills)
	for s in 3:
		var ws = p.weapons[s]
		slots[s].text = "%d  %s" % [s + 1, Weapons.DATA[ws.kind].name if ws else ["Primary", "Primary", "Sidearm"][s]]
		slots[s].modulate.a = 1.0 if s == p.cur else (0.75 if ws else 0.35)
		(slots[s].get_theme_stylebox("normal") as StyleBoxFlat).border_color = AMBER if s == p.cur else Color(0, 0, 0, 0)
	ammo_mag.text = str(w.mag) if w else ""
	ammo_res.text = ("%d  %s" % [p.ammo[Weapons.DATA[w.kind].ammo], Weapons.DATA[w.kind].ammo]) if w else ""
	gear_l.text = ("V%d " % p.armor if p.armor else "V- ") + ("H%d " % p.helmet if p.helmet else "H- ")
	meds_l.text = "%d bandages · %d medkits · %d grenades · %d smoke" % [p.bandages, p.medkits, p.grenades, p.smokes]
	var z: Dictionary = game.zone
	var tt := maxi(0, ceili(z.t))
	zone_l.text = "Final zone" if z.stage == "final" else ("%s %d:%02d" % ["ZONE CLOSES IN" if z.stage == "wait" else "CLOSING", tt / 60, tt % 60])
	fps_l.text = "%d fps" % Engine.get_frames_per_second()


func show_toast(t: String) -> void:
	toast.text = t
	toast_t = 2.6


func hit_marker(head: bool, kill: bool) -> void:
	hit_t = 0.16
	hit_col = Color(0.89, 0.33, 0.23) if kill else (AMBER if head else Color.WHITE)


func add_feed(text: String, mine: bool) -> void:
	var l := _lbl(text, f_semi, 15)
	var sb := _panel()
	if mine:
		sb.border_color = AMBER
		sb.border_width_left = 3
	l.add_theme_stylebox_override("normal", sb)
	feed.add_child(l)
	feed.move_child(l, 0)
	while feed.get_child_count() > 5:
		feed.get_child(feed.get_child_count() - 1).queue_free()
		feed.remove_child(feed.get_child(feed.get_child_count() - 1))
	get_tree().create_timer(7.0).timeout.connect(func(): if is_instance_valid(l): l.queue_free())


# ---------------------------------------------------------------- big map
func _build_bigmap(root: Control) -> void:
	bigmap = ColorRect.new()
	(bigmap as ColorRect).color = Color(0.03, 0.035, 0.03, 0.88)
	bigmap.set_anchors_preset(Control.PRESET_FULL_RECT)
	bigmap.visible = false
	bigmap.mouse_filter = Control.MOUSE_FILTER_STOP
	bigmap.draw.connect(_draw_bigmap)
	root.add_child(bigmap)


func _draw_bigmap() -> void:
	if map_tex == null:
		return
	var S := minf(bigmap.size.x, bigmap.size.y) * 0.92
	var o := (bigmap.size - Vector2(S, S)) / 2.0
	bigmap.draw_texture_rect(map_tex, Rect2(o, Vector2(S, S)), false)
	var sc := S / World.MAP_SIZE
	var to_m := func(x: float, z: float) -> Vector2: return o + Vector2((x + World.HALF) * sc, (z + World.HALF) * sc)
	for t in game.world.towns:
		var p: Vector2 = to_m.call(t.x, t.z - t.R)
		bigmap.draw_string(f_display, p + Vector2(-80, -4), (t.name as String).to_upper(), HORIZONTAL_ALIGNMENT_CENTER, 160, 16, TEXT)
	_draw_zone(bigmap, to_m, sc)
	if game.plane_visible():
		var a: Vector3 = game.flight.a
		var e: Vector3 = a + game.flight.dir * game.flight.len
		bigmap.draw_dashed_line(to_m.call(a.x, a.z), to_m.call(e.x, e.z), Color(1, 1, 1, 0.7), 2.0, 10.0)
	var c: Vector3 = game.view_center()
	_arrow(bigmap, to_m.call(c.x, c.z), game.cam_yaw, 12.0)
	bigmap.draw_rect(Rect2(o, Vector2(S, S)), LINE, false, 1.0)
	bigmap.draw_string(f_semi, Vector2(0, bigmap.size.y - 16), "PRESS M TO CLOSE", HORIZONTAL_ALIGNMENT_CENTER, bigmap.size.x, 14, MUTED)


# ---------------------------------------------------------------- end screen
func _build_end(root: Control) -> void:
	endscreen = ColorRect.new()
	(endscreen as ColorRect).color = Color(0.04, 0.045, 0.035, 0.85)
	endscreen.set_anchors_preset(Control.PRESET_FULL_RECT)
	endscreen.visible = false
	root.add_child(endscreen)
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	endscreen.add_child(c)
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 16)
	c.add_child(v)
	end_title = _lbl("", f_display, 72)
	end_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(end_title)
	end_rank = _lbl("", f_display, 56)
	end_rank.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(end_rank)
	end_stats = _lbl("", f_semi, 22, MUTED)
	end_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(end_stats)
	var b := Button.new()
	b.text = "DROP AGAIN"
	b.add_theme_font_override("font", f_display)
	b.add_theme_font_size_override("font_size", 24)
	b.pressed.connect(func(): endscreen.visible = false; again.emit())
	v.add_child(b)


func show_end(win: bool, rank: int, total: int, kills: int, dmg: float, secs: float) -> void:
	hud.visible = false
	touch.visible = false
	endscreen.visible = true
	end_title.text = "LAST ONE STANDING" if win else "YOU WERE ELIMINATED"
	end_title.add_theme_color_override("font_color", AMBER if win else TEXT)
	end_rank.text = "#%d  of %d" % [rank, total]
	end_stats.text = "%d eliminations   ·   %d damage   ·   %d:%02d survived" % [kills, int(dmg), int(secs) / 60, int(secs) % 60]


# ---------------------------------------------------------------- touch
func _build_touch(root: Control) -> void:
	touch = Control.new()
	touch.set_anchors_preset(Control.PRESET_FULL_RECT)
	touch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	touch.visible = false
	root.add_child(touch)
	var stick := Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.25)
	sb.border_color = LINE
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(65)
	stick.add_theme_stylebox_override("panel", sb)
	stick.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	stick.position = Vector2(30, -160)
	stick.size = Vector2(130, 130)
	stick.mouse_filter = Control.MOUSE_FILTER_IGNORE
	touch.add_child(stick)
	stick_knob = Panel.new()
	var kb := sb.duplicate() as StyleBoxFlat
	kb.bg_color = Color(TEXT, 0.35)
	kb.set_corner_radius_all(28)
	stick_knob.add_theme_stylebox_override("panel", kb)
	stick_knob.size = Vector2(56, 56)
	stick_knob.position = Vector2(37, 37)
	stick_knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stick.add_child(stick_knob)
	var buttons := [["FIRE", Vector2(-110, -190), 84], ["AIM", Vector2(-190, -250), 58], ["JUMP", Vector2(-190, -90), 58], ["DUCK", Vector2(-100, -80), 50], ["RLD", Vector2(-260, -150), 50], ["USE", Vector2(-360, -260), 58], ["HEAL", Vector2(-60, -330), 50], ["NADE", Vector2(-120, -330), 50], ["SMOKE", Vector2(-180, -330), 50], ["VIEW", Vector2(-60, -400), 46], ["MAP", Vector2(-120, -400), 46], ["SWAP", Vector2(-60, -260), 50]]
	for b in buttons:
		var btn := Button.new()
		btn.text = b[0]
		btn.add_theme_font_override("font", f_semi)
		btn.add_theme_font_size_override("font_size", 14)
		var bs := StyleBoxFlat.new()
		bs.bg_color = Color(0.89, 0.33, 0.23, 0.35) if b[0] == "FIRE" else Color(0, 0, 0, 0.35)
		bs.border_color = LINE
		bs.set_border_width_all(1)
		bs.set_corner_radius_all(int(b[2]) / 2)
		btn.add_theme_stylebox_override("normal", bs)
		btn.add_theme_stylebox_override("pressed", bs)
		btn.add_theme_stylebox_override("hover", bs)
		btn.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
		btn.position = b[1]
		btn.size = Vector2(b[2], b[2])
		btn.focus_mode = Control.FOCUS_NONE
		btn.button_down.connect(func(): touch_button.emit(b[0]))
		if b[0] == "FIRE":
			btn.button_up.connect(func(): touch_button.emit("FIRE_UP"))
		touch.add_child(btn)


func set_stick(v: Vector2) -> void:
	stick_knob.position = Vector2(37, 37) + v * 55.0
