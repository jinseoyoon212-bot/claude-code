shader_type spatial;
render_mode cull_disabled, diffuse_lambert_wrap;
// Grass blades: dry straw/green mix, wind sway, bend away from the player, darker at the root.
uniform vec3 player_pos;
uniform float wind_strength = 1.0;

varying float vy;
varying vec3 vtint;

void vertex() {
	vec3 ip = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float h = UV.y;
	vy = h;
	float t = TIME;
	float wind = sin(t * 1.6 + ip.x * 0.17 + ip.z * 0.11) * 0.5 + sin(t * 3.1 + ip.x * 0.5) * 0.15;
	vec3 bend = vec3(0.6, 0.0, 0.35) * (wind * 0.28 + 0.12) * wind_strength;
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 away = wp.xz - player_pos.xz;
	float ad = length(away);
	if (ad < 1.3 && ad > 0.001) bend.xz += normalize(away) * (1.3 - ad) * 0.9;
	VERTEX += (inverse(mat3(MODEL_MATRIX)) * bend) * h * h;
	vec3 green = mix(vec3(0.30, 0.38, 0.13), vec3(0.42, 0.46, 0.18), COLOR.r);
	vec3 straw = mix(vec3(0.56, 0.50, 0.27), vec3(0.70, 0.62, 0.36), COLOR.r);
	vtint = mix(green, straw, smoothstep(0.35, 0.75, COLOR.g + COLOR.r * 0.3));
}

void fragment() {
	vec3 base = mix(vec3(0.09, 0.12, 0.04), vec3(0.16, 0.17, 0.07), 0.5);
	ALBEDO = mix(base, vtint, smoothstep(0.0, 0.85, vy));
	AO = mix(0.25, 1.0, vy);
	AO_LIGHT_AFFECT = 0.8;
	ROUGHNESS = 0.85;
	SPECULAR = 0.2;
	BACKLIGHT = vec3(0.25, 0.28, 0.12);
}
