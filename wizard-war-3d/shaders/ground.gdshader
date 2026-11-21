// 땅: 풀밭의 색 얼룩, 맨땅, 자갈 섞인 길(바퀴 자국), 어둠의 땅(갈라진 틈), 눈, 젖은 웅덩이를 모두 수식으로 그린다.
// 노이즈 높낮이에서 법선을 만들어 햇빛에 따라 울퉁불퉁한 질감이 보인다.
shader_type spatial;
render_mode diffuse_burley;

uniform vec3 grass_a : source_color = vec3(0.24, 0.4, 0.18);
uniform vec3 grass_b : source_color = vec3(0.34, 0.5, 0.2);
uniform vec3 dirt_col : source_color = vec3(0.32, 0.25, 0.16);
uniform vec3 path_col : source_color = vec3(0.45, 0.37, 0.26);
uniform vec3 blight_col : source_color = vec3(0.12, 0.1, 0.14);
uniform float path_halfw = 4.5;
uniform float blight_x = 27.0;
uniform float snow : hint_range(0.0, 1.0) = 0.0;
uniform float wet : hint_range(0.0, 1.0) = 0.0;
uniform float cracks : hint_range(0.0, 1.0) = 0.0;
uniform vec3 crack_col : source_color = vec3(0.6, 0.2, 0.9);
uniform float bump = 0.55;

uniform sampler2D noise_a : source_color, filter_linear_mipmap, repeat_enable;   // R,G,B,A = 서로 다른 크기의 구름무늬 노이즈 (끊김 없이 이어짐)
uniform sampler2D noise_b : source_color, filter_linear_mipmap, repeat_enable;   // R = 세포 경계, G = 자갈(세포 거리), B = 큰 세포, A = 세포별 무작위 값

varying vec3 wp;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// 길 가장자리: 1 = 길, 0 = 풀밭
float path_mask(vec2 p, float n) {
	float edge = path_halfw + (n - 0.5) * 2.2;
	float pm = 1.0 - smoothstep(edge - 0.7, edge + 0.5, abs(p.y));
	pm *= smoothstep(-35.0, -31.0, p.x + (n - 0.5) * 4.0) * (1.0 - smoothstep(31.0, 35.0, p.x + (n - 0.5) * 4.0));
	return pm;
}

float height_at(vec2 p, float pm) {
	float h = texture(noise_a, p * 0.11).g * 0.55 + texture(noise_a, p * 0.5).b * 0.3;
	float peb = smoothstep(0.38, 0.12, texture(noise_b, p * 0.17).g);   // 자갈
	return h + pm * peb * 0.22;
}

void fragment() {
	vec2 p = wp.xz;
	float n1 = texture(noise_a, p * 0.012).r;
	float n2 = texture(noise_a, p * 0.1 + 0.37).g;
	float n3 = texture(noise_a, p * 0.55).b;
	float pn = texture(noise_a, p * 0.07 + 0.61).a;
	float pm = path_mask(p, pn);
	// 풀밭: 큰 얼룩 + 잔 얼룩, 군데군데 맨땅
	vec3 grass = mix(grass_a, grass_b, smoothstep(0.25, 0.75, n1)) * (0.8 + 0.4 * n2) * (0.92 + 0.16 * n3);
	float dm = smoothstep(0.6, 0.78, texture(noise_a, p * 0.02 + 0.55).g);
	vec3 col = mix(grass, dirt_col * (0.8 + 0.4 * n2), dm * 0.75);
	// 길: 다져진 흙 + 자갈 + 바퀴 자국
	vec4 nb = texture(noise_b, p * 0.17);
	float peb = smoothstep(0.38, 0.12, nb.g);
	vec3 pcol = path_col * (0.78 + 0.45 * n2) * (0.9 + 0.2 * n3);
	pcol = mix(pcol, path_col * (0.6 + 0.7 * nb.a) * 1.1, peb * 0.7);
	float rut = smoothstep(0.55, 0.0, abs(abs(p.y + sin(p.x * 0.12) * 0.4) - 1.25)) * 0.4;
	pcol *= 1.0 - rut;
	col = mix(col, pcol, pm);
	// 어둠의 땅(오른쪽): 메마르고 갈라진 땅
	float bm = smoothstep(blight_x - 6.0, blight_x + 6.0, p.x);
	vec3 bcol = blight_col * (0.7 + 0.7 * n2);
	float crack = smoothstep(0.12, 0.0, texture(noise_b, p * 0.045).r) * cracks;
	bcol *= 1.0 - crack * 0.8;
	col = mix(col, bcol, bm * 0.88);
	// 눈
	float sn = snow * (1.0 - pm * 0.55) * smoothstep(0.2, 0.6, 0.55 + n2 * 0.6);
	col = mix(col, vec3(0.9, 0.94, 1.0) * (0.88 + 0.18 * n2), sn);
	// 웅덩이(젖은 땅): 길 위의 낮은 곳
	float pud = wet * pm * smoothstep(0.58, 0.7, texture(noise_a, p * 0.06 + 0.8).g);
	col = mix(col, col * 0.45, pud);
	// 높낮이 -> 법선 (가까운 곳만 자세히)
	float lod = 1.0 - smoothstep(30.0, 60.0, length(VERTEX));
	vec3 wn = vec3(0.0, 1.0, 0.0);
	if (lod > 0.0) {
		float e = 0.07;
		float h0 = height_at(p, pm);
		float hx = height_at(p + vec2(e, 0.0), pm);
		float hz = height_at(p + vec2(0.0, e), pm);
		wn = normalize(vec3(-(hx - h0) / e * 0.35 * bump * lod, 1.0, -(hz - h0) / e * 0.35 * bump * lod));
	}
	wn = normalize(mix(wn, vec3(0.0, 1.0, 0.0), pud));
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
	ALBEDO = col;
	ROUGHNESS = mix(0.92, 0.22, pud) - sn * 0.25;
	SPECULAR = 0.35 + pud * 0.4 + sn * 0.3;
	// 눈 반짝임과 균열 속 빛
	float glit = step(0.985, texture(noise_a, p * 6.0).b) * sn;
	EMISSION = vec3(0.9, 0.95, 1.0) * glit * 0.6 + crack_col * crack * 0.45 * bm;
}
