// 나뭇잎·풀·덤불·꽃: 바람에 흔들리고(높을수록 크게), 빛이 잎을 투과하고(BACKLIGHT), 잎 색이 군데군데 다르다.
shader_type spatial;
render_mode cull_disabled, diffuse_burley;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform float alpha_cut = 0.45;
uniform float wind = 1.0;
uniform float wind_speed = 1.5;
uniform float sway_h = 0.06;                   // 높이당 흔들림 크기
uniform vec3 tint : source_color = vec3(1.0, 1.0, 1.0);
uniform float trans = 0.55;                    // 빛이 비치는 정도
uniform float variation = 0.18;                // 위치에 따른 색 변화

varying vec3 wpos;

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

void vertex() {
	vec3 w0 = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float ph = w0.x * 0.35 + w0.z * 0.27;
	float gust = 0.6 + 0.4 * sin(TIME * 0.35 + w0.x * 0.05);
	float s1 = sin(TIME * wind_speed + ph) + 0.45 * sin(TIME * wind_speed * 2.7 + ph * 1.7);
	float h = max(VERTEX.y, 0.0);
	float k = wind * gust * sway_h * h * h * 0.1;
	VERTEX.x += s1 * k;
	VERTEX.z += cos(TIME * wind_speed * 0.8 + ph) * k * 0.6;
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec4 t = texture(albedo_tex, UV);
	if (t.a < alpha_cut) {
		discard;
	}
	float v = vnoise(wpos.xz * 0.22);
	vec3 c = t.rgb * tint * (1.0 - variation + variation * 2.0 * v);
	c = mix(c, c * vec3(1.12, 1.02, 0.82), smoothstep(0.55, 0.9, vnoise(wpos.xz * 0.11 + 9.0)) * 0.5);   // 군데군데 누렇게
	c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.14);   // 너무 쨍한 색을 가라앉힌다
	ALBEDO = c;
	ROUGHNESS = 0.8;
	SPECULAR = 0.2;
	BACKLIGHT = c * trans;
}
