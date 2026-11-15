// 불로 이루어진 용: 3D 노이즈로 일렁이는 불꽃 + 가장자리 발광 + 불꽃이 모여 형태가 만들어지는 디졸브
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled, unshaded;

uniform float dissolve : hint_range(0.0, 1.0) = 1.0;   // 0: 보이지 않음 → 1: 완전한 모습
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_disable;   // 용의 비늘·뿔 무늬 (어두운 곳은 식은 껍질, 밝은 곳은 이글거리는 불)
uniform float intensity = 1.35;
uniform float flicker = 0.55;                           // 표면이 일렁이는 정도
uniform float ash : hint_range(0.0, 1.0) = 0.0;        // 0: 활활 타는 불 → 1: 식어서 재가 되어 흩어진다
uniform vec4 core_col : source_color = vec4(1.0, 0.8, 0.32, 1.0);
uniform vec4 mid_col : source_color = vec4(1.0, 0.36, 0.05, 1.0);
uniform vec4 edge_col : source_color = vec4(0.5, 0.05, 0.0, 1.0);

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
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float d = fbm(wp * 0.55 + vec3(0.0, -TIME * 2.4, 0.0));
	VERTEX += NORMAL * (d - 0.4) * flicker / max(length(MODEL_MATRIX[0].xyz), 0.0001);
}

void fragment() {
	float n = fbm(wp * 0.85 + vec3(0.0, -TIME * 3.2, TIME * 0.6));
	float fres = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 1.5);
	// 불빛 방향의 명암을 조금 섞어서 용의 입체적인 모양(머리·날개·몸통)이 읽히게 한다
	float ndl = clamp(dot(normalize(NORMAL), normalize(vec3(0.4, 0.7, 0.6))), 0.0, 1.0);
	float tl = dot(texture(tex, UV).rgb, vec3(0.333));
	float heat = clamp((n * 0.78 + fres * 0.3 + ndl * 0.22) * (0.55 + 1.1 * tl) + 0.08, 0.0, 1.0);
	vec3 c = mix(edge_col.rgb, mid_col.rgb, smoothstep(0.22, 0.6, heat));
	c = mix(c, core_col.rgb, smoothstep(0.78, 1.0, heat));
	// 불꽃이 모여 형태가 만들어지는 효과: 노이즈가 문턱보다 낮은 곳은 아직 없다
	float dn = fbm(wp * 1.1 + vec3(5.0, 1.0, 9.0));
	// 재가 될 때는 위쪽(높은 곳)부터 먼저 흩어진다
	float cut = dn - (1.0 - dissolve) * 1.15 - ash * (1.05 + clamp((wp.y - 2.0) * 0.06, 0.0, 0.3));
	if (cut < 0.0) {
		discard;
	}
	float rim = 1.0 - smoothstep(0.0, 0.12, cut);   // 사라지는 가장자리는 밝게 타오른다
	// 식어가는 몸: 검은 숯이 되고, 갈라진 틈에서만 불씨가 붉게 숨 쉰다
	float char_k = smoothstep(0.0, 0.55, ash);
	float crack = smoothstep(0.62, 0.9, fbm(wp * 2.2 + vec3(0.0, -TIME * 1.2, 0.0)));
	vec3 coal = vec3(0.07, 0.06, 0.06) + vec3(1.0, 0.3, 0.05) * crack * (1.0 - char_k * 0.4) * 1.6;
	c = mix(c * intensity, coal, char_k);
	ALBEDO = c + vec3(1.0, 0.55, 0.12) * rim * 3.0;
	ALPHA = clamp(0.78 + heat * 0.3, 0.0, 1.0);
}
