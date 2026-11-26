shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, specular_schlick_ggx;
// Sea: two scrolling normal maps, fresnel-tinted reflection, deeper colour far away.
uniform sampler2D normal0 : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D normal1 : hint_normal, repeat_enable, filter_linear_mipmap;

varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec2 uv = wpos.xz;
	vec3 n0 = texture(normal0, uv / 38.0 + vec2(TIME * 0.006, TIME * 0.003)).rgb;
	vec3 n1 = texture(normal1, uv / 90.0 - vec2(TIME * 0.004, -TIME * 0.002)).rgb;
	NORMAL_MAP = normalize(n0 + n1 - 1.0) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.6;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	ALBEDO = mix(vec3(0.03, 0.14, 0.17), vec3(0.08, 0.2, 0.24), fres);
	METALLIC = 0.0;
	ROUGHNESS = 0.04;
	SPECULAR = 0.6;
	ALPHA = mix(0.82, 0.97, fres);
}
