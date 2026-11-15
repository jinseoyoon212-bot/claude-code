// 반짝이는 별빛: 카메라를 향하는 빌보드. 한가운데 하얗게 타는 핵 + 십자 광선 + 번지는 후광.
// 유성의 머리와 충돌 순간의 섬광에 쓴다.
shader_type spatial;
render_mode blend_add, unshaded, depth_draw_never, cull_disabled, fog_disabled;

uniform vec3 col : source_color = vec3(1.0, 0.85, 0.4);
uniform float fade : hint_range(0.0, 1.0) = 1.0;
uniform float intensity = 1.8;

void vertex() {
	float sz = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	VERTEX *= sz;
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) {
		discard;
	}
	float a = atan(p.y, p.x);
	float core = exp(-r * r * 22.0);
	float halo = exp(-r * 3.2) * 0.55;
	float s1 = pow(abs(cos(a * 2.0 + TIME * 1.1)), 30.0) * exp(-r * 2.4);
	float s2 = pow(abs(cos(a * 2.0 - TIME * 0.7 + 0.785)), 60.0) * exp(-r * 3.0) * 0.8;
	float s3 = pow(abs(cos(a * 3.0 + TIME * 0.4)), 40.0) * exp(-r * 4.0) * 0.5;
	float ring = smoothstep(0.06, 0.0, abs(r - 0.62 - 0.04 * sin(TIME * 6.0))) * 0.35;
	float v = core * 1.4 + halo + s1 + s2 + s3 + ring;
	vec3 c = mix(col, vec3(1.0), clamp(core * 1.3, 0.0, 1.0));
	ALBEDO = c * intensity * fade;
	ALPHA = clamp(v, 0.0, 1.0) * (1.0 - smoothstep(0.7, 1.0, r)) * fade;
}
