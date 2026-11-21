// 땅 위에 낮게 깔리는 안개띠: 천천히 흘러가는 노이즈 위로 가장자리가 부드럽게 사라진다.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;

uniform vec3 col : source_color = vec3(0.8, 0.85, 0.95);
uniform float density = 0.25;
uniform float speed = 0.03;

varying vec3 wp;

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p = p * 2.05 + vec2(3.3, 8.1);
		a *= 0.5;
	}
	return s;
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 q = wp.xz * 0.06 + vec2(TIME * speed, TIME * speed * 0.4);
	float n = fbm(q) * 1.4 - 0.25;
	vec2 e = abs(UV - 0.5) * 2.0;
	float edge = (1.0 - smoothstep(0.55, 1.0, e.x)) * (1.0 - smoothstep(0.55, 1.0, e.y));
	ALBEDO = col;
	ALPHA = clamp(n, 0.0, 1.0) * edge * density;
}
