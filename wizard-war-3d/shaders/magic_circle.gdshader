// 회전하는 룬 마법진 (바닥에 깔리는 평면용). 모든 선을 수식으로 그린다.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform float power : hint_range(0.0, 2.0) = 1.0;
uniform vec3 col1 : source_color = vec3(1.0, 0.5, 0.1);
uniform vec3 col2 : source_color = vec3(1.0, 0.92, 0.55);

float ring(float r, float rad, float w) {
	return smoothstep(w, 0.0, abs(r - rad));
}

float seg(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

vec2 rot(vec2 p, float a) {
	float c = cos(a);
	float s = sin(a);
	return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) {
		discard;
	}
	float ang = atan(p.y, p.x);
	float v = 0.0;
	v += ring(r, 0.965, 0.014) * 1.3;
	v += ring(r, 0.90, 0.007);
	// 룬 눈금 띠
	float band = step(0.77, r) * step(r, 0.885);
	float ticks = smoothstep(0.8, 1.0, abs(sin(ang * 18.0 + TIME * 0.7)));
	float glyph = smoothstep(0.55, 1.0, abs(sin(ang * 6.0 - TIME * 0.7 + r * 14.0)));
	v += band * (ticks * 0.65 + glyph * 0.35);
	v += ring(r, 0.765, 0.009);
	// 반대로 도는 점선
	v += ring(r, 0.64, 0.008) * step(0.0, sin(ang * 36.0 - TIME * 1.6));
	// 육망성 (삼각형 두 개가 서로 반대로 회전)
	vec2 q = rot(p, TIME * 0.32);
	float hex = 0.0;
	for (int i = 0; i < 3; i++) {
		float a0 = float(i) * 2.0943951;
		float a1 = float(i + 1) * 2.0943951;
		vec2 v0 = vec2(cos(a0), sin(a0)) * 0.74;
		vec2 v1 = vec2(cos(a1), sin(a1)) * 0.74;
		hex += smoothstep(0.013, 0.0, seg(q, v0, v1));
		vec2 w0 = vec2(cos(a0 + 1.0471976), sin(a0 + 1.0471976)) * 0.74;
		vec2 w1 = vec2(cos(a1 + 1.0471976), sin(a1 + 1.0471976)) * 0.74;
		hex += smoothstep(0.013, 0.0, seg(q, w0, w1));
	}
	v += hex * 1.1;
	v += ring(r, 0.42, 0.009);
	v += ring(r, 0.30, 0.006) * step(0.0, sin(ang * 12.0 + TIME * 2.0));
	// 중심의 맥동하는 빛
	v += smoothstep(0.32, 0.0, r) * (0.45 + 0.25 * sin(TIME * 6.0));
	v = clamp(v, 0.0, 1.6);
	float edge = smoothstep(1.0, 0.9, r);
	vec3 c = mix(col1, col2, clamp(v - 0.4, 0.0, 1.0));
	ALBEDO = c * v * power * 1.8;
	ALPHA = clamp(v * power * edge, 0.0, 1.0);
}
