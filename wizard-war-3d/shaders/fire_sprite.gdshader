// 불의 용 머리를 이루는 불꽃 입자(MultiMesh 인스턴스). 카메라를 향하는 빌보드 + 일렁이는 노이즈 불꽃 모양.
// 인스턴스 색의 rgb = 밝기가 곱해진 불꽃 색, a = 입자마다 다른 노이즈 씨앗.
shader_type spatial;
render_mode blend_add, unshaded, depth_draw_never, cull_disabled;

varying vec4 vc;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vn(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	vc = COLOR;
	float sz = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	VERTEX *= sz;
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float seed = vc.a;
	// 위로 일렁이며 올라가는 불꽃 질감
	float n = vn(p * 2.4 + vec2(seed * 37.0, TIME * 2.2 + seed * 11.0));
	n = 0.6 * n + 0.4 * vn(p * 5.0 + vec2(TIME * 1.3, seed * 19.0));
	float a = smoothstep(1.0, 0.1, r) * (0.45 + 1.1 * n);
	ALBEDO = vc.rgb;
	ALPHA = clamp(a, 0.0, 1.0);
}
