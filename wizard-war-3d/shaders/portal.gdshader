// 어둠의 포탈: 소용돌이치는 보랏빛 에너지. 가운데로 빨려 들어가는 나선 + 환하게 타오르는 중심 + 가장자리 테두리.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, fog_disabled;

uniform vec3 col_a : source_color = vec3(0.5, 0.12, 0.95);
uniform vec3 col_b : source_color = vec3(1.0, 0.72, 1.0);
uniform float power = 1.0;
uniform sampler2D noise_a : filter_linear_mipmap, repeat_enable;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) {
		discard;
	}
	float a = atan(p.y, p.x);
	float tw = a + r * 5.0 - TIME * 1.3;                      // 나선: 가운데로 갈수록 더 많이 감긴다
	vec2 q = vec2(cos(tw), sin(tw)) * (0.25 + r * 0.9);
	float n1 = texture(noise_a, q * 0.5 + 0.5 + vec2(TIME * 0.02, 0.0)).r;
	float n2 = texture(noise_a, q * 1.6 + vec2(0.0, -TIME * 0.03)).g;
	float swirl = smoothstep(0.38, 0.9, n1 * 0.6 + n2 * 0.5);
	float core = exp(-r * r * 6.0);
	float rim = smoothstep(0.72, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
	float tunnel = pow(1.0 - r, 1.4);
	vec3 c = mix(col_a, col_b, clamp(swirl * 0.55 + core, 0.0, 1.0));
	ALBEDO = c * (0.3 + swirl * 1.3 + core * 2.0 + rim * 1.7) * power;
	ALPHA = clamp(0.4 * tunnel + swirl * 0.65 * (1.0 - r * 0.5) + core + rim, 0.0, 1.0) * (1.0 - smoothstep(0.94, 1.0, r));
}
