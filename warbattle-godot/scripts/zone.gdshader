shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
// Firestorm wall: banded orange glow fading upward and with distance from the camera.
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float a = atan(wpos.z, wpos.x);
	float s = sin(a * 180.0 + wpos.y * 0.08 - TIME * 1.5) * 0.5 + 0.5;
	float h = smoothstep(1.0, 0.0, UV.y);
	float flick = 0.75 + 0.25 * sin(TIME * 3.0 + a * 40.0 + wpos.y * 0.2);
	float near = smoothstep(520.0, 40.0, distance(CAMERA_POSITION_WORLD.xz, wpos.xz));
	ALBEDO = mix(vec3(0.95, 0.32, 0.08), vec3(1.0, 0.62, 0.22), s) * (0.18 + 0.14 * s) * h * flick * near;
}
