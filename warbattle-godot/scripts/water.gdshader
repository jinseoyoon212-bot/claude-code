shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, specular_schlick_ggx;
// Sea: depth from the terrain heightmap gives turquoise shallows, deep blue offshore and
// a band of foam along the shore; two scrolling normal maps and gentle swell.
uniform sampler2D normal0 : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D normal1 : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D heightmap : filter_linear;
uniform float map_size = 1600.0;

varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz;
	vec2 huv = (wpos.xz + map_size * 0.5) / map_size;
	float ground = (huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) ? -16.0 : texture(heightmap, huv).r;
	float depth = clamp(-ground, 0.0, 20.0);
	vec3 n0 = texture(normal0, uv / 38.0 + vec2(TIME * 0.006, TIME * 0.003)).rgb;
	vec3 n1 = texture(normal1, uv / 90.0 - vec2(TIME * 0.004, -TIME * 0.002)).rgb;
	NORMAL_MAP = normalize(n0 + n1 - 1.0) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.6;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	vec3 shallow = vec3(0.10, 0.36, 0.36);
	vec3 deep = vec3(0.02, 0.10, 0.14);
	vec3 col = mix(shallow, deep, smoothstep(0.0, 9.0, depth));
	// shore foam: a band that pulses with incoming swell, broken up by the normal texture
	float swell = sin(depth * 2.2 - TIME * 1.4) * 0.5 + 0.5;
	float foam = smoothstep(1.2, 0.0, depth) * (0.55 + 0.45 * swell) * smoothstep(0.35, 0.6, n0.r * 0.6 + n1.g * 0.6);
	col = mix(col, vec3(0.9, 0.93, 0.92), clamp(foam, 0.0, 1.0));
	ALBEDO = mix(col, col * 1.2, fres);
	METALLIC = 0.0;
	ROUGHNESS = mix(0.03, 0.6, foam);
	SPECULAR = 0.6;
	ALPHA = clamp(mix(0.55, 0.96, smoothstep(0.0, 4.0, depth)) + foam * 0.5 + fres * 0.2, 0.0, 1.0);
}
