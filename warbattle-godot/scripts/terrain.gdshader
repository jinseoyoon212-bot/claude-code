shader_type spatial;
// Four-layer splat terrain (grass, forest floor, rock, dirt) driven by vertex colour.
// Rock is projected from three sides so cliffs do not stretch; beaches use a sand texture.
uniform sampler2D albedo0 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo1 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo2 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D albedo3 : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D sand : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal0 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal1 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal2 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal3 : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;

varying vec3 wpos;
varying vec3 wnrm;
varying vec4 w;
varying float tint;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	w = COLOR / max(dot(COLOR, vec4(1.0)), 0.001);
	tint = UV2.x;
}

vec4 tex2(sampler2D t, vec2 uv) { return mix(texture(t, uv), texture(t, uv * 0.231 + 0.37), 0.45); }

vec3 triplanar(sampler2D t, vec3 p, vec3 n, float scale) {
	vec3 bw = pow(abs(n), vec3(4.0));
	bw /= dot(bw, vec3(1.0));
	return texture(t, p.zy * scale).rgb * bw.x + texture(t, p.xz * scale).rgb * bw.y + texture(t, p.xy * scale).rgb * bw.z;
}

void fragment() {
	vec2 uv = wpos.xz / 6.0;
	vec3 c0 = tex2(albedo0, uv * 0.5).rgb * vec3(0.86, 0.9, 0.66);
	vec3 c1 = tex2(albedo1, uv).rgb;
	vec3 c2 = triplanar(albedo2, wpos, wnrm, 1.0 / 8.0);
	c2 = mix(c2, vec3(dot(c2, vec3(0.33))) * vec3(1.05, 1.02, 0.98), 0.6);
	vec3 c3 = tex2(albedo3, uv).rgb;
	vec3 col = c0 * w.r + c1 * w.g + c2 * w.b + c3 * w.a;
	col *= 0.82 + tint * 0.28;
	// large-scale colour variation so fields are not uniform
	float macro = texture(albedo1, wpos.xz / 420.0).g;
	col *= mix(0.88, 1.1, macro);
	float beach = smoothstep(2.6, 1.0, wpos.y);
	vec3 sandc = tex2(sand, wpos.xz / 5.0).rgb;
	col = mix(col, sandc, beach * 0.9);
	col = mix(col, col * vec3(0.5, 0.56, 0.58), smoothstep(0.6, -1.5, wpos.y));
	ALBEDO = col;
	vec3 n = texture(normal0, uv * 0.5).rgb * w.r + texture(normal1, uv).rgb * w.g + texture(normal2, uv * 0.75).rgb * w.b + texture(normal3, uv).rgb * w.a;
	NORMAL_MAP = n;
	NORMAL_MAP_DEPTH = 1.3;
	ROUGHNESS = mix(0.97, 0.45, smoothstep(0.4, -0.8, wpos.y));
	SPECULAR = 0.35;
}
