// 지팡이에서 뿜어져 나오는 불줄기 / 용의 꼬리가 되는 불의 몸통: 튜브 메시 위에 3D 노이즈 불꽃을 얹는다.
// UV.x = 꼬리(0) → 머리(1), 메시의 반지름은 코드에서 만든다. 가장자리는 투명하게 녹아 불길처럼 보인다.
shader_type spatial;
render_mode blend_add, depth_draw_never, cull_disabled, unshaded, fog_disabled;

uniform float fade : hint_range(0.0, 1.0) = 1.0;
uniform float intensity = 1.7;
uniform float lick = 1.5;                               // 불길이 바깥으로 널름거리는 정도
uniform vec4 core_col : source_color = vec4(1.0, 0.5, 0.12, 1.0);
uniform vec4 mid_col : source_color = vec4(0.95, 0.28, 0.03, 1.0);
uniform vec4 edge_col : source_color = vec4(0.55, 0.06, 0.0, 1.0);

varying vec3 wp;
varying float along;

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

float fbm(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

void vertex() {
	along = UV.x;
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float d = fbm(w * 0.42 + vec3(0.0, -TIME * 3.4, TIME * 0.5));
	VERTEX += NORMAL * (d - 0.33) * lick * smoothstep(0.0, 0.25, along);
	wp = w;
}

void fragment() {
	float fr = clamp(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.0, 1.0);
	float body = pow(fr, 0.75);                      // 튜브 한가운데가 가장 진하고 가장자리는 불길로 흩어진다
	float n = fbm(wp * 0.75 + vec3(along * 1.5, -TIME * 4.6, TIME * 0.9));
	float tail = smoothstep(0.0, 0.3, along);
	float head = smoothstep(0.6, 1.0, along);
	float heat = clamp(body * 0.85 + n * 0.85 - 0.3 + head * 0.2, 0.0, 1.0);
	vec3 c = mix(edge_col.rgb, mid_col.rgb, smoothstep(0.18, 0.55, heat));
	c = mix(c, core_col.rgb, smoothstep(0.88, 1.2, heat));
	ALBEDO = c * intensity * fade;
	ALPHA = clamp(body * (0.3 + n * 1.0), 0.0, 1.0) * tail * fade;
}
