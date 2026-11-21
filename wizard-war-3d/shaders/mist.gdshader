// 땅 위에 낮게 깔리는 안개띠: 천천히 흘러가는 노이즈 위로 가장자리가 부드럽게 사라진다.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;

uniform vec3 col : source_color = vec3(0.8, 0.85, 0.95);
uniform float density = 0.25;
uniform float speed = 0.03;
uniform sampler2D noise_a : filter_linear_mipmap, repeat_enable;

varying vec3 wp;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 q = wp.xz * 0.012 + vec2(TIME * speed, TIME * speed * 0.4) * 0.2;
	float n = (texture(noise_a, q).r * 0.65 + texture(noise_a, q * 2.7 + 0.3).g * 0.35) * 1.4 - 0.25;
	vec2 e = abs(UV - 0.5) * 2.0;
	float edge = (1.0 - smoothstep(0.55, 1.0, e.x)) * (1.0 - smoothstep(0.55, 1.0, e.y));
	ALBEDO = col;
	ALPHA = clamp(n, 0.0, 1.0) * edge * density;
}
