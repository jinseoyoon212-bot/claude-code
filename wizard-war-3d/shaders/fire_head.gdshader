// 불의 용 머리: 화면 전체 쿼드 위에서 레이마칭으로 그리는 "불로 이루어진 용의 얼굴".
// 두개골·주둥이·아래턱·뿔·눈썹뼈·이빨을 부드러운 거리장(SDF)으로 만들고, 그 경계를 3D 노이즈로 일렁이게 해서
// 불길이 얼굴 모양을 이루는 모습을 만든다. 눈구멍과 콧구멍은 파여서 어둡게 남는다.
shader_type spatial;
render_mode unshaded, blend_mix, depth_test_disabled, depth_draw_never, cull_disabled, fog_disabled;

uniform vec3 head_pos = vec3(0.0);
uniform vec3 axis_f = vec3(1.0, 0.0, 0.0);   // 머리가 향하는 방향
uniform vec3 axis_u = vec3(0.0, 1.0, 0.0);
uniform vec3 axis_r = vec3(0.0, 0.0, 1.0);
uniform float head_scale = 2.4;
uniform float jaw = 0.3;                      // 아래턱이 벌어진 각도(라디안)
uniform float form : hint_range(0.0, 1.0) = 1.0;   // 0: 보이지 않음 → 1: 완성 (불꽃이 모이며 형태가 생긴다)
uniform float ash : hint_range(0.0, 1.0) = 0.0;    // 0: 활활 → 1: 식어서 재가 된다
uniform float gain = 1.0;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
				   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
			   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
				   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm3(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 3; i++) {
		s += a * vnoise(p);
		p = p * 2.07 + vec3(1.7, 9.2, 3.1);
		a *= 0.5;
	}
	return s;
}

float sd_ell(vec3 p, vec3 r) {
	float k0 = length(p / r);
	float k1 = length(p / (r * r));
	return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

float sd_cone(vec3 p, vec3 a, vec3 b, float ra, float rb) {
	vec3 pa = p - a;
	vec3 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h) - mix(ra, rb, h);
}

float smin(float a, float b, float k) {
	float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
	return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
	return -smin(-a, -b, k);
}

// 머리 좌표: +X 앞, +Y 위, Z 좌우. 머리 길이 약 4.
float head_sdf(vec3 p) {
	vec3 q = vec3(p.x, p.y, abs(p.z));
	float skull = sd_ell(p - vec3(0.0, 0.3, 0.0), vec3(1.05, 0.9, 0.9));
	float snout = sd_cone(p, vec3(0.5, 0.12, 0.0), vec3(2.9, -0.02, 0.0), 0.64, 0.34);
	float nose = sd_ell(p - vec3(2.95, 0.12, 0.0), vec3(0.32, 0.24, 0.36));
	float d = smin(skull, snout, 0.4);
	d = smin(d, nose, 0.2);
	// 아래턱: 관절을 축으로 열린다
	vec3 jp = p - vec3(0.35, -0.38, 0.0);
	float cj = cos(jaw);
	float sj = sin(jaw);
	jp = vec3(cj * jp.x - sj * jp.y, sj * jp.x + cj * jp.y, jp.z);
	float jw = sd_cone(vec3(jp.x, jp.y, abs(jp.z)), vec3(0.1, -0.05, 0.0), vec3(2.15, -0.1, 0.0), 0.46, 0.24);
	d = smin(d, jw, 0.18);
	// 눈썹뼈, 뿔(뒤쪽 위로 휘어짐), 뺨 가시
	d = smin(d, sd_cone(q, vec3(0.2, 0.8, 0.5), vec3(1.3, 0.68, 0.32), 0.2, 0.12), 0.16);
	d = smin(d, sd_cone(q, vec3(-0.1, 0.85, 0.5), vec3(-1.3, 1.5, 0.85), 0.34, 0.2), 0.1);
	d = min(d, sd_cone(q, vec3(-1.3, 1.5, 0.85), vec3(-2.7, 1.9, 1.3), 0.2, 0.04));
	d = min(d, sd_cone(q, vec3(-0.5, 0.35, 0.75), vec3(-1.7, 0.2, 1.35), 0.2, 0.03));
	d = min(d, sd_cone(q, vec3(0.0, 0.05, 0.8), vec3(-0.9, -0.55, 1.35), 0.15, 0.03));
	// 갈기: 뒤통수에서 길게 늘어진 불꽃 덩어리
	d = smin(d, sd_ell(p - vec3(-1.3, 0.55, 0.0), vec3(1.0, 0.9, 0.7)), 0.4);
	// 목
	d = smin(d, sd_cone(p, vec3(-0.5, -0.05, 0.0), vec3(-2.8, -1.8, 0.0), 0.85, 1.15), 0.5);
	// 눈구멍과 콧구멍은 파낸다
	d = smax(d, -(length(q - vec3(0.78, 0.58, 0.55)) - 0.17), 0.08);
	d = smax(d, -(length(q - vec3(3.05, 0.2, 0.19)) - 0.09), 0.05);
	// 이빨: 위턱은 아래로, 아래턱은 위로 솟은 뾰족한 이빨
	float tx = clamp(q.x, 0.9, 2.55);
	float ti = floor((tx - 0.9) / 0.3 + 0.5);
	float cx = 0.9 + ti * 0.3;
	float zr = mix(0.4, 0.2, (cx - 0.9) / 1.65);
	d = min(d, sd_cone(q, vec3(cx, -0.1, zr), vec3(cx, -0.78, zr), 0.14, 0.0));
	float jtx = clamp(jp.x, 0.8, 2.0);
	float jti = floor((jtx - 0.8) / 0.34 + 0.5);
	float jcx = 0.8 + jti * 0.34;
	d = min(d, sd_cone(vec3(jp.x, jp.y, abs(jp.z)), vec3(jcx, 0.0, 0.26), vec3(jcx, 0.7, 0.26), 0.14, 0.0));
	return d;
}

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

vec3 fire_color(float tt) {
	vec3 c = mix(vec3(0.35, 0.03, 0.005), vec3(0.95, 0.24, 0.03), smoothstep(0.0, 0.4, tt));
	c = mix(c, vec3(1.0, 0.52, 0.1), smoothstep(0.35, 0.7, tt));
	c = mix(c, vec3(1.0, 0.88, 0.5), smoothstep(0.75, 1.0, tt));
	return c;
}

void fragment() {
	// 화면 픽셀 -> 월드 광선
	vec4 vp = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, 0.0, 1.0);
	vp.xyz /= vp.w;
	vec3 rd_w = normalize((INV_VIEW_MATRIX * vec4(vp.xyz, 0.0)).xyz);
	vec3 ro_w = INV_VIEW_MATRIX[3].xyz;
	// 머리 좌표계로 변환 (단위: 머리 크기)
	vec3 d0 = ro_w - head_pos;
	vec3 ro = vec3(dot(d0, axis_f), dot(d0, axis_u), dot(d0, axis_r)) / head_scale;
	vec3 rd = vec3(dot(rd_w, axis_f), dot(rd_w, axis_u), dot(rd_w, axis_r));
	// 머리를 감싸는 구와의 교차
	vec3 c = vec3(-0.2, 0.2, 0.0);
	float R = 3.9;
	vec3 oc = ro - c;
	float b = dot(oc, rd);
	float h = b * b - (dot(oc, oc) - R * R);
	if (h < 0.0) {
		discard;
	}
	h = sqrt(h);
	float t0 = max(-b - h, 0.0);
	float t1 = -b + h;
	const int N = 44;
	float dt = (t1 - t0) / float(N);
	float t = t0 + dt * hash(vec3(SCREEN_UV * 311.0, TIME));
	vec3 col = vec3(0.0);
	float acc = 0.0;
	bool hit = false;
	float shade = 1.0;
	float rim = 0.0;
	float lit_k = 0.45;
	for (int i = 0; i < N; i++) {
		vec3 p = ro + rd * t;
		// 위로 솟는 불길: 위쪽일수록, 뒤쪽 갈기일수록 크게 일렁인다
		float lick = 0.45 + 0.7 * smoothstep(-0.2, 1.4, p.y) + 1.0 * smoothstep(-0.2, -1.8, p.x);
		float nz = fbm3(p * 1.25 + vec3(0.0, -TIME * 2.2, 0.0) + vec3(0.0, 0.0, TIME * 0.3));
		vec3 ps = p + vec3(0.3 * (nz - 0.4), -1.0 * lick * (nz - 0.3), 0.25 * (nz - 0.5));   // 불길이 위로 길게 늘어난다
		float d = head_sdf(ps) + (nz - 0.42) * 0.38 * lick;
		float inside = clamp(-d / 0.2, 0.0, 1.0);
		// 벌린 입 속에서 이글거리는 빛
		vec3 mc = (p - vec3(1.2, -0.3 - 0.5 * sin(jaw), 0.0)) / vec3(0.95, 0.12 + 0.3 * sin(jaw), 0.34);
		float th = smoothstep(1.0, 0.0, length(mc)) * smoothstep(0.1, 0.35, form);
		if (th > 0.0) {
			float ta = clamp(th * dt * 3.0, 0.0, 1.0);
			col += (1.0 - acc) * ta * vec3(1.0, 0.72, 0.3);
			acc += (1.0 - acc) * ta;
		}
		if (inside > 0.0) {
			float mn = fbm3(p * 0.9 + vec3(4.0, 1.0, 7.0));
			float mask = smoothstep(0.0, 0.3, form * 1.35 - mn) * smoothstep(0.0, 0.3, 1.0 - ash * 1.5 - mn * 0.5 + 0.2);
			if (!hit && inside > 0.35 && mask > 0.5) {
				// 처음 만나는 표면에서 모양을 읽을 수 있게 명암과 틈새 어두움을 계산한다
				hit = true;
				vec2 e = vec2(0.06, 0.0);
				vec3 n = normalize(vec3(head_sdf(p + e.xyy) - head_sdf(p - e.xyy), head_sdf(p + e.yxy) - head_sdf(p - e.yxy), head_sdf(p + e.yyx) - head_sdf(p - e.yyx)));
				float lit = clamp(dot(n, normalize(vec3(0.45, 0.8, 0.75))), 0.0, 1.0);
				float ao = clamp(head_sdf(p + n * 0.3) / 0.3, 0.0, 1.0);
				lit_k = clamp(0.25 + 0.75 * lit * (0.3 + 0.7 * ao), 0.0, 1.0);
				shade = 0.55 + 0.6 * ao;
				rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
			}
			float streak = fbm3(p * vec3(2.4, 4.6, 2.4) + vec3(0.0, -TIME * 3.4, 0.0));
			float dens = inside * mask;
			float tt = clamp(0.05 + lit_k * 0.55 + inside * 0.1 + (streak - 0.42) * 1.1 + (1.0 - inside) * 0.12, 0.0, 1.0);
			vec3 fc = fire_color(tt);
			fc = mix(fc, vec3(0.2, 0.05, 0.02) * (0.5 + nz), ash * 0.85);
			float a = clamp(dens * dt * 7.0, 0.0, 1.0);
			col += (1.0 - acc) * a * fc;
			acc += (1.0 - acc) * a;
			if (acc > 0.985) {
				break;
			}
		}
		t += dt;
	}
	if (acc < 0.004) {
		discard;
	}
	vec3 base = col / max(acc, 0.001);
	ALBEDO = base * (shade + rim * 0.35) * gain;
	ALPHA = acc;
}
