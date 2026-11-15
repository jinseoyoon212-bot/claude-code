// 아스트라 유디키움의 빛기둥 / 빛줄기: 세로 원통 메시에 입히는 가산 혼합 셰이더.
// 가운데는 하얗게 타오르고 가장자리는 푸르게 번지며, 세로 결과 위로 솟는 빛의 띠가 흐른다.
shader_type spatial;
render_mode blend_add, unshaded, depth_draw_never, cull_disabled, fog_disabled;

uniform float fade : hint_range(0.0, 1.0) = 1.0;
uniform float intensity = 1.5;
uniform float top_y = 60.0;                              // 이 높이에서 서서히 사라진다
uniform float rings = 1.0;                               // 솟는 빛의 띠 세기
uniform vec3 core_col : source_color = vec3(1.0, 0.96, 0.82);
uniform vec3 edge_col : source_color = vec3(0.32, 0.5, 1.0);

varying vec3 wp;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
				   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
			   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
				   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float fr = clamp(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.0, 1.0);
	float body = pow(fr, 1.2);
	float n = 0.6 * vnoise(vec3(UV.x * 18.0, wp.y * 0.07 - TIME * 1.6, TIME * 0.4)) + 0.4 * vnoise(vec3(UV.x * 40.0, wp.y * 0.2 - TIME * 3.0, 1.0));
	float band = pow(0.5 + 0.5 * sin(wp.y * 0.32 - TIME * 7.0), 8.0) * rings;
	float vfade = (1.0 - smoothstep(top_y * 0.6, top_y, wp.y)) * smoothstep(-2.0, 1.0, wp.y);
	float a = body * (0.5 + 0.9 * n) + band * 0.5 * body;
	vec3 c = mix(edge_col, core_col, smoothstep(0.25, 0.95, body + band * 0.2));
	ALBEDO = c * intensity * fade;
	ALPHA = clamp(a, 0.0, 1.0) * vfade * fade;
}
