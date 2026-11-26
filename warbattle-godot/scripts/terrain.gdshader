shader_type spatial;
// Four-layer splat terrain (grass, forest floor, rock, dirt) driven by vertex colour.
uniform sampler2D albedo0 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo1 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo2 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo3 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal0 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal1 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal2 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal3 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;

varying vec3 wpos;
varying vec4 w;
varying float tint;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w = COLOR / max(dot(COLOR, vec4(1.0)), 0.001);
	tint = UV2.x;
}

// two scales blended to hide tiling
vec4 tex2(sampler2D t, vec2 uv) { return mix(texture(t, uv), texture(t, uv * 0.231 + 0.37), 0.45); }

void fragment() {
	vec2 uv = wpos.xz / 6.0;
	vec3 c0 = tex2(albedo0, uv * 0.5).rgb * vec3(0.86, 0.9, 0.66);
	vec3 c1 = tex2(albedo1, uv).rgb;
	vec3 c2 = tex2(albedo2, uv * 0.7).rgb;
	c2 = mix(c2, vec3(dot(c2, vec3(0.33))) * vec3(1.05, 1.02, 0.98), 0.65);
	vec3 c3 = tex2(albedo3, uv).rgb;
	vec3 col = c0 * w.r + c1 * w.g + c2 * w.b + c3 * w.a;
	col *= 0.82 + tint * 0.28;
	float sand = smoothstep(2.6, 1.0, wpos.y);
	col = mix(col, vec3(0.62, 0.55, 0.42) * (0.85 + 0.3 * c3.r), sand * 0.85);
	col = mix(col, col * vec3(0.55, 0.6, 0.62), smoothstep(0.6, -1.5, wpos.y));
	ALBEDO = col;
	vec3 n = texture(normal0, uv * 0.5).rgb * w.r + texture(normal1, uv).rgb * w.g + texture(normal2, uv * 0.7).rgb * w.b + texture(normal3, uv).rgb * w.a;
	NORMAL_MAP = n;
	NORMAL_MAP_DEPTH = 1.2;
	ROUGHNESS = mix(0.97, 0.55, smoothstep(0.4, -0.8, wpos.y));
	SPECULAR = 0.35;
}
