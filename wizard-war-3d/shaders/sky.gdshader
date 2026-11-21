// 하늘: 지평선 안개, 태양 원반과 빛무리, 흘러가는 구름(빛 받는 쪽/그늘진 쪽), 밤하늘의 별.
// 태양 방향은 장면의 DirectionalLight3D(LIGHT0)를 그대로 따른다.
shader_type sky;

uniform vec3 top_col : source_color = vec3(0.22, 0.42, 0.78);
uniform vec3 hor_col : source_color = vec3(0.72, 0.76, 0.84);
uniform vec3 low_col : source_color = vec3(0.3, 0.35, 0.3);
uniform vec3 sun_col : source_color = vec3(1.0, 0.92, 0.75);
uniform float sun_size = 0.0075;
uniform float sun_power = 1.0;
uniform float cloud_cover : hint_range(0.0, 1.0) = 0.5;
uniform vec3 cloud_lit : source_color = vec3(1.0, 0.97, 0.92);
uniform vec3 cloud_shade : source_color = vec3(0.55, 0.6, 0.72);
uniform float stars : hint_range(0.0, 1.0) = 0.0;

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
	for (int i = 0; i < 5; i++) {
		s += a * vnoise(p);
		p = p * 2.02 + vec2(7.3, 1.9);
		a *= 0.5;
	}
	return s;
}

void sky() {
	vec3 dir = EYEDIR;
	float h = dir.y;
	vec3 sd = normalize(LIGHT0_DIRECTION);
	float cs = dot(dir, sd);
	// 지평선으로 갈수록 뿌옇고 따뜻하게(태양 쪽), 위로 갈수록 짙게
	float up = clamp(h, 0.0, 1.0);
	vec3 col = mix(hor_col, top_col, pow(up, 0.5));
	col = mix(col, hor_col, pow(1.0 - up, 6.0) * 0.5);
	col += sun_col * pow(max(cs, 0.0), 6.0) * 0.12 * sun_power * (1.0 - up * 0.6);   // 태양 쪽 하늘이 환해진다
	col = mix(col, low_col, smoothstep(0.0, -0.3, h));
	// 별
	if (stars > 0.0 && h > 0.0) {
		vec3 q = dir * 220.0;
		vec2 cell = floor(q.xz / (0.35 + abs(q.y) * 0.0) );
		float rnd = hash21(floor(dir.xz / max(h, 0.15) * 90.0));
		float tw = 0.6 + 0.4 * sin(TIME * (1.5 + rnd * 4.0) + rnd * 40.0);
		col += vec3(0.85, 0.9, 1.0) * step(0.992, rnd) * tw * stars * smoothstep(0.0, 0.25, h);
	}
	// 구름: 하늘을 평면으로 보고 노이즈를 입힌다
	float cl = 0.0;
	vec3 cc = cloud_lit;
	if (h > 0.0) {
		vec2 uv = dir.xz / (h + 0.22) * 0.9 + vec2(TIME * 0.006, TIME * 0.002);
		float n = fbm(uv * 1.6);
		float edge = 1.0 - cloud_cover;
		cl = smoothstep(edge, edge + 0.22, n) * smoothstep(0.0, 0.14, h);
		float n2 = fbm((uv + sd.xz * 0.06) * 1.6);   // 태양 쪽으로 조금 옮겨 뽑아 밝고 어두운 면을 만든다
		float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
		cc = mix(cloud_shade, cloud_lit, lit);
		cc += sun_col * pow(max(cs, 0.0), 8.0) * 0.5 * sun_power;     // 태양 가장자리 구름이 은은히 빛난다
		col = mix(col, cc, cl * 0.92);
	}
	// 태양 원반과 빛무리 (구름에 가려진다)
	float disc = smoothstep(cos(sun_size * 1.5), cos(sun_size), cs);
	float glow = pow(max(cs, 0.0), 40.0) * 0.5 + pow(max(cs, 0.0), 400.0) * 1.5;
	col += sun_col * (disc * 8.0 + glow) * sun_power * (1.0 - cl * 0.85);
	COLOR = col;
}
