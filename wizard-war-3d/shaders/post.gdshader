// 화면 전체 마무리: 비네팅, 은은한 대비 곡선, 밝은 곳은 따뜻하게·어두운 곳은 차갑게(색 분리), 가장자리 색수차, 필름 그레인.
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear, repeat_disable;
uniform float vignette = 0.3;
uniform float grain = 0.018;
uniform float aberration = 0.0002;
uniform vec3 warm : source_color = vec3(1.04, 1.0, 0.94);
uniform vec3 cool : source_color = vec3(0.94, 0.99, 1.06);
uniform float contrast = 1.03;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 d = uv - 0.5;
	float r2 = dot(d, d);
	vec2 off = d * r2 * aberration * 40.0;
	vec3 c;
	c.r = texture(screen_tex, uv + off).r;
	c.g = texture(screen_tex, uv).g;
	c.b = texture(screen_tex, uv - off).b;
	float lum = dot(c, vec3(0.299, 0.587, 0.114));
	c *= mix(cool, warm, smoothstep(0.15, 0.75, lum));
	c = (c - 0.5) * contrast + 0.5;
	c *= 1.0 - vignette * smoothstep(0.1, 0.55, r2 * 2.2);
	c += (hash(uv * vec2(1280.0, 720.0) + fract(TIME) * 100.0) - 0.5) * grain;
	COLOR = vec4(max(c, 0.0), 1.0);
}
