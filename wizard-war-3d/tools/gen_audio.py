#!/usr/bin/env python3
"""빛과 어둠의 마법 전쟁 — 효과음/배경음악 절차적 생성기.

python3 tools/gen_audio.py  ->  audio/*.ogg
외부 샘플 없이 numpy로 합성하고 ffmpeg(libvorbis)로 인코딩한다.
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "audio")
rng = np.random.default_rng(42)


# ---------------- 기본 도구 ----------------
def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env_adsr(n, a=0.01, d=0.1, s=0.6, r=0.2):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def env_exp(n, k=6.0):
    return np.exp(-k * np.arange(n) / n)


def osc(freq, dur, kind="sine", phase=0.0):
    t = t_axis(dur)
    if np.isscalar(freq):
        ph = 2 * np.pi * freq * t + phase
    else:
        ph = 2 * np.pi * np.cumsum(freq) / SR + phase
    if kind == "sine":
        return np.sin(ph)
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1.0) - 1
    if kind == "square":
        return np.sign(np.sin(ph))
    raise ValueError(kind)


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def lowpass(x, cutoff):
    """1-pole lowpass. cutoff: Hz (scalar or array)"""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def lp_fast(x, cutoff):
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    from itertools import accumulate
    return np.fromiter(accumulate(x, lambda acc, v: acc + a * (v - acc)), float, len(x))


def highpass(x, cutoff):
    return x - lp_fast(x, cutoff)


def sweep(f0, f1, dur, curve="exp"):
    n = int(SR * dur)
    if curve == "exp":
        return f0 * (f1 / f0) ** (np.arange(n) / n)
    return np.linspace(f0, f1, n)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def place(buf, x, at):
    i = int(at * SR)
    end = min(len(buf), i + len(x))
    buf[i:end] += x[: end - i]


def reverb(x, wet=0.25, taps=((0.031, 0.5), (0.047, 0.42), (0.071, 0.33), (0.113, 0.25), (0.167, 0.18), (0.241, 0.12))):
    out = np.copy(x)
    for d, g in taps:
        k = int(d * SR)
        out[k:] += x[:-k] * g * wet * 2
    return out


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def stereo_pcm(x, stereo_width):
    x = np.clip(x, -1, 1)
    if stereo_width > 0:
        d = int(0.012 * SR)
        r = np.concatenate([np.zeros(d), x[:-d]])
        st = np.stack([x, x * (1 - stereo_width) + r * stereo_width], axis=1)
    else:
        st = np.stack([x, x], axis=1)
    return (st * 32767).astype(np.int16)


def save_wav(name, x, stereo_width=0.0):
    """음악은 WAV로 저장한다. Ogg는 반복 지점에서 디코더를 되감느라 0.2~0.3초 무음이 생기지만,
    WAV(PCM/ADPCM)는 샘플 단위로 끊김 없이 반복된다. 압축·반복 설정은 *.wav.import 에 있다."""
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name + ".wav")
    with wave.open(dst, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo_pcm(x, stereo_width).tobytes())
    print("wrote", dst)


def fold_loop(out, total):
    """끝에 남은 잔향(리버브 꼬리)을 처음에 겹쳐 더해, 반복 이음새가 자연스럽게 이어지게 한다."""
    n = int(SR * total)
    tail = out[n:n + SR]
    head = out[:n].copy()
    head[:len(tail)] += tail
    return norm(head, 0.8)


def save(name, x, stereo_width=0.0):
    os.makedirs(OUT, exist_ok=True)
    x = np.clip(x, -1, 1)
    if stereo_width > 0:
        d = int(0.012 * SR)
        r = np.concatenate([np.zeros(d), x[:-d]])
        st = np.stack([x, x * (1 - stereo_width) + r * stereo_width], axis=1)
    else:
        st = np.stack([x, x], axis=1)
    pcm = (st * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    dst = os.path.join(OUT, name + ".ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "libvorbis", "-q:a", "4", dst], check=True)
    os.remove(tmp)
    print("wrote", dst)


# ---------------- 효과음 ----------------
def sfx_cast():
    d = 0.28
    f = sweep(1400, 380, d)
    x = osc(f, d, "tri") * env_exp(int(SR * d), 7) * 0.7
    sh = osc(sweep(2800, 900, d), d, "sine") * env_exp(int(SR * d), 10) * 0.3
    return reverb(norm(mix(x, sh), 0.7), 0.2)


def sfx_hit():
    d = 0.18
    n = lp_fast(noise(d), 2200) * env_exp(int(SR * d), 14)
    th = osc(sweep(180, 60, d), d, "sine") * env_exp(int(SR * d), 9)
    return norm(mix(n * 0.8, th), 0.75)


def sfx_explode():
    d = 1.0
    n = int(SR * d)
    nz = lp_fast(noise(d), 900) * env_exp(n, 4.5)
    boom = osc(sweep(110, 35, d), d, "sine") * env_exp(n, 5)
    crack = highpass(noise(0.06), 2000) * env_exp(int(SR * 0.06), 8)
    return reverb(norm(mix(nz * 1.2, boom, crack * 0.6), 0.9), 0.35)


def sfx_nova():
    d = 1.1
    n = int(SR * d)
    out = np.zeros(n)
    for i, m in enumerate([72, 76, 79, 84, 88]):
        tone = osc(midi(m), d, "sine") * env_adsr(n, 0.005 + i * 0.03, 0.2, 0.3, 0.7)
        out += tone * 0.3
    wh = lp_fast(noise(d), 3000) * env_adsr(n, 0.02, 0.3, 0.0, 0.1) * 0.5
    boom = osc(sweep(140, 50, 0.5), 0.5, "sine") * env_exp(int(SR * 0.5), 6)
    return reverb(norm(mix(out, wh, boom), 0.85), 0.45)


def sfx_shield():
    d = 0.9
    n = int(SR * d)
    f = sweep(220, 660, d)
    x = (osc(f, d, "tri") + 0.5 * osc(f * 1.5, d, "sine")) * env_adsr(n, 0.05, 0.2, 0.5, 0.4)
    trem = 0.7 + 0.3 * np.sin(2 * np.pi * 12 * t_axis(d))
    return reverb(norm(x * trem, 0.6), 0.4)


def sfx_chain():
    d = 0.55
    n = int(SR * d)
    buzz = osc(120 + 40 * rng.standard_normal(n).cumsum() / 300, d, "saw")
    crack = highpass(noise(d), 3000) * (rng.random(n) > 0.85)
    e = env_exp(n, 5)
    zap = osc(sweep(3000, 400, 0.15), 0.15, "square") * env_exp(int(SR * 0.15), 8)
    return norm(mix((buzz * 0.4 + crack * 0.8) * e, zap * 0.5), 0.7)


def sfx_frost():
    d = 1.3
    n = int(SR * d)
    out = np.zeros(n)
    for i in range(10):
        f = midi(rng.choice([84, 88, 91, 93, 96, 100]))
        tone = osc(f, 0.6, "sine") * env_exp(int(SR * 0.6), 7) * 0.35
        place(out, tone, i * 0.07)
    wind = lp_fast(highpass(noise(d), 1500), 5000) * env_adsr(n, 0.1, 0.4, 0.2, 0.6) * 0.35
    return reverb(norm(out + wind, 0.7), 0.5)


def sfx_heal():
    d = 1.4
    n = int(SR * d)
    out = np.zeros(n)
    for i, m in enumerate([67, 71, 74, 79, 83]):
        tone = (osc(midi(m), 0.9, "sine") + 0.3 * osc(midi(m) * 2, 0.9, "sine")) * env_exp(int(SR * 0.9), 4)
        place(out, tone * 0.35, i * 0.09)
    return reverb(norm(out, 0.65), 0.5)


def sfx_meteor():
    d = 0.9
    n = int(SR * d)
    wh = lp_fast(noise(d), 1)  # placeholder
    whoosh = lowpass(noise(d), sweep(400, 3500, d)) * np.linspace(0.1, 1, n) * 0.6
    boom = sfx_explode()
    out = np.zeros(int(SR * 1.8))
    place(out, whoosh, 0)
    place(out, boom, 0.8)
    return norm(out, 0.9)


def sfx_coin():
    d = 0.35
    a = osc(midi(88), 0.08, "square") * env_exp(int(SR * 0.08), 3) * 0.3
    b = osc(midi(95), 0.27, "square") * env_exp(int(SR * 0.27), 5) * 0.3
    out = np.zeros(int(SR * d))
    place(out, a, 0)
    place(out, b, 0.07)
    return norm(lp_fast(out, 6000), 0.45)


def sfx_click():
    d = 0.07
    return norm(osc(sweep(1800, 900, d), d, "sine") * env_exp(int(SR * d), 10), 0.4)


def sfx_buy():
    out = np.zeros(int(SR * 0.6))
    for i, m in enumerate([76, 81, 88]):
        place(out, osc(midi(m), 0.35, "tri") * env_exp(int(SR * 0.35), 5) * 0.4, i * 0.07)
    return reverb(norm(out, 0.6), 0.3)


def sfx_error():
    out = np.zeros(int(SR * 0.3))
    for i in range(2):
        place(out, osc(170, 0.11, "square") * env_exp(int(SR * 0.11), 4) * 0.3, i * 0.13)
    return norm(lp_fast(out, 2000), 0.5)


def horn(m, dur, vol=0.4):
    n = int(SR * dur)
    f = midi(m) * (1 + 0.004 * np.sin(2 * np.pi * 5 * t_axis(dur)))
    x = osc(f, dur, "saw") + 0.6 * osc(f * 1.002, dur, "saw")
    return lp_fast(x, 1600) * env_adsr(n, 0.06, 0.1, 0.8, 0.25) * vol


def sfx_wave():
    out = np.zeros(int(SR * 1.6))
    place(out, horn(55, 0.35), 0)
    place(out, horn(55, 0.2), 0.38)
    place(out, horn(62, 0.9), 0.6)
    place(out, horn(50, 0.9, 0.3), 0.6)
    return reverb(norm(out, 0.7), 0.4)


def sfx_boss():
    d = 2.2
    n = int(SR * d)
    f = sweep(70, 45, d)
    x = (osc(f, d, "saw") + osc(f * 1.01, d, "saw") + osc(f * 0.5, d, "square") * 0.5)
    roar = lp_fast(x, 500) * env_adsr(n, 0.2, 0.4, 0.7, 0.8)
    gr = lowpass(noise(d), sweep(1200, 300, d)) * env_adsr(n, 0.1, 0.5, 0.4, 0.8) * 0.6
    return reverb(norm(roar + gr, 0.9), 0.4)


def sfx_win():
    out = np.zeros(int(SR * 2.4))
    seq = [(60, 0), (64, 0.15), (67, 0.3), (72, 0.45)]
    for m, at in seq:
        place(out, horn(m, 0.3, 0.35), at)
    for m in (60, 64, 67, 72):
        place(out, horn(m, 1.6, 0.25), 0.65)
    return reverb(norm(out, 0.8), 0.45)


def sfx_lose():
    out = np.zeros(int(SR * 2.4))
    for i, m in enumerate([62, 61, 60, 57]):
        place(out, horn(m, 0.55 if i < 3 else 1.4, 0.35), i * 0.45)
    return reverb(norm(lp_fast(out, 1200), 0.75), 0.5)


def sfx_dash():
    d = 0.3
    n = int(SR * d)
    x = lowpass(noise(d), sweep(600, 4000, d)) * env_adsr(n, 0.02, 0.1, 0.5, 0.15)
    return norm(x, 0.55)


def sfx_bones():
    out = np.zeros(int(SR * 0.7))
    for i in range(7):
        c = highpass(noise(0.03), 1500) * env_exp(int(SR * 0.03), 6)
        f = osc(rng.uniform(600, 1200), 0.05, "square") * env_exp(int(SR * 0.05), 8) * 0.3
        place(out, mix(c, f), i * 0.06 + rng.uniform(0, 0.03))
    return norm(out, 0.5)


def sfx_summon():
    d = 1.0
    n = int(SR * d)
    f = sweep(200, 900, d)
    x = (osc(f, d, "tri") + 0.5 * osc(f * 1.25, d, "tri") + 0.3 * osc(f * 1.5, d, "sine")) * env_adsr(n, 0.05, 0.3, 0.6, 0.4)
    return reverb(norm(x, 0.6), 0.45)


def sfx_levelup():
    out = np.zeros(int(SR * 1.2))
    for i, m in enumerate([72, 76, 79, 84, 88, 91]):
        place(out, osc(midi(m), 0.5, "tri") * env_exp(int(SR * 0.5), 4) * 0.3, i * 0.06)
    return reverb(norm(out, 0.65), 0.5)


def sfx_impact():
    """인트로 타이틀 등장 효과음"""
    d = 2.6
    n = int(SR * d)
    boom = osc(sweep(90, 28, d), d, "sine") * env_exp(n, 3)
    nz = lp_fast(noise(d), 700) * env_exp(n, 4) * 0.8
    shimmer = np.zeros(n)
    for m in (72, 79, 84, 88, 91):
        shimmer += osc(midi(m), d, "sine") * env_adsr(n, 0.01, 0.6, 0.2, 1.8) * 0.12
    return reverb(norm(mix(boom * 1.2, nz, shimmer), 0.95), 0.55)


def sfx_whoosh_long():
    d = 2.0
    n = int(SR * d)
    x = lowpass(noise(d), sweep(200, 2500, d)) * np.sin(np.linspace(0, np.pi, n)) ** 2
    return norm(x, 0.5)


# ---------------- 음악 ----------------
def pad_chord(notes, dur, vol=0.12):
    n = int(SR * dur)
    out = np.zeros(n)
    for m in notes:
        for det in (-0.06, 0.0, 0.06):
            f = midi(m + det)
            out += osc(f, dur, "saw", rng.uniform(0, 6))
    out = lp_fast(out, 1100) * env_adsr(n, 0.4, 0.3, 0.8, 0.6)
    return out * vol / len(notes)


def pluck(m, dur, vol=0.25):
    n = int(SR * dur)
    x = osc(midi(m), dur, "tri") + 0.3 * osc(midi(m) * 2, dur, "sine")
    return x * env_exp(n, 6) * vol


def kick(vol=0.8):
    d = 0.35
    return osc(sweep(140, 42, d), d, "sine") * env_exp(int(SR * d), 7) * vol


def snare(vol=0.35):
    d = 0.22
    return (highpass(noise(d), 1200) * 0.8 + osc(190, d, "tri") * 0.4) * env_exp(int(SR * d), 10) * vol


def hat(vol=0.1):
    d = 0.06
    return highpass(noise(d), 6000) * env_exp(int(SR * d), 12) * vol


def tom(m, vol=0.5):
    d = 0.4
    return osc(sweep(midi(m) * 1.4, midi(m), d), d, "sine") * env_exp(int(SR * d), 6) * vol


def bass(m, dur, vol=0.35):
    n = int(SR * dur)
    x = osc(midi(m), dur, "saw") + osc(midi(m) * 0.5, dur, "square") * 0.5
    return lp_fast(x, 380) * env_adsr(n, 0.01, 0.1, 0.7, 0.08) * vol


def music_title():
    bpm = 76
    beat = 60 / bpm
    bars = 8
    total = bars * 4 * beat
    out = np.zeros(int(SR * total) + SR)
    prog = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [55, 60, 64]), (55, [55, 59, 62]),
            (57, [57, 60, 64]), (53, [53, 57, 60]), (50, [53, 57, 62]), (52, [52, 56, 59])]
    melody = [76, 74, 72, 71, 72, 74, 76, 79, 77, 76, 74, 72, 71, 72, 74, 76,
              76, 74, 72, 71, 72, 74, 76, 79, 81, 79, 77, 76, 74, 76, 75, 76]
    for bi, (root, ch) in enumerate(prog):
        t0 = bi * 4 * beat
        place(out, pad_chord([n + 12 for n in ch], 4 * beat + 0.6, 0.16), t0)
        place(out, bass(root - 12, 4 * beat, 0.25), t0)
        for k in range(8):
            place(out, pluck(ch[k % 3] + 24, beat, 0.08), t0 + k * beat / 2)
        place(out, tom(43, 0.35), t0)
        place(out, tom(43, 0.25), t0 + 2.5 * beat)
        for k in range(4):
            m = melody[(bi * 4 + k) % len(melody)]
            n = int(SR * beat * 0.95)
            v = osc(midi(m) * (1 + 0.003 * np.sin(2 * np.pi * 5.5 * t_axis(beat * 0.95))), beat * 0.95, "tri")
            place(out, v * env_adsr(n, 0.04, 0.1, 0.7, 0.2) * 0.13, t0 + k * beat)
    out = reverb(out, 0.5)
    return fold_loop(out, total)


def music_battle(boss=False):
    bpm = 138 if boss else 124
    beat = 60 / bpm
    bars = 8
    total = bars * 4 * beat
    out = np.zeros(int(SR * total) + SR)
    if boss:
        prog = [(45, [57, 60, 64]), (46, [58, 62, 65]), (45, [57, 60, 64]), (44, [56, 59, 63])] * 2
    else:
        prog = [(45, [57, 60, 64]), (41, [53, 57, 60]), (43, [55, 59, 62]), (40, [52, 56, 59])] * 2
    riff = [0, 0, 12, 0, 10, 0, 7, 0]
    for bi, (root, ch) in enumerate(prog):
        t0 = bi * 4 * beat
        place(out, pad_chord(ch, 4 * beat + 0.3, 0.12 if boss else 0.1), t0)
        for k in range(8):
            place(out, bass(root + riff[k], beat / 2 * 0.9, 0.3), t0 + k * beat / 2)
        for k in range(4):
            place(out, kick(0.7), t0 + k * beat)
            if k % 2 == 1:
                place(out, snare(0.3), t0 + k * beat)
            for h in range(2):
                place(out, hat(0.07), t0 + k * beat + h * beat / 2)
        if boss:
            for k in range(4):
                place(out, tom(38 + (k % 2) * 3, 0.35), t0 + k * beat + beat * 0.75)
        arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24]
        for k in range(16):
            if (k + bi) % 3 != 2:
                place(out, pluck(arp[k % 4], beat / 4 * 1.5, 0.06), t0 + k * beat / 4)
    out = reverb(out, 0.25)
    return fold_loop(out, total)


SFX = {
    "cast": sfx_cast, "hit": sfx_hit, "explode": sfx_explode, "nova": sfx_nova, "shield": sfx_shield,
    "chain": sfx_chain, "frost": sfx_frost, "heal": sfx_heal, "meteor": sfx_meteor, "coin": sfx_coin,
    "click": sfx_click, "buy": sfx_buy, "error": sfx_error, "wave": sfx_wave, "boss": sfx_boss,
    "win": sfx_win, "lose": sfx_lose, "dash": sfx_dash, "bones": sfx_bones, "summon": sfx_summon,
    "levelup": sfx_levelup, "impact": sfx_impact, "whoosh": sfx_whoosh_long,
}

if __name__ == "__main__":
    only_music = len(sys.argv) > 1 and sys.argv[1] == "music"   # python3 tools/gen_audio.py music
    if not only_music:
        for name, fn in SFX.items():
            save(name, fn(), 0.3)
    save_wav("music_title", music_title(), 0.5)
    save_wav("music_battle", music_battle(False), 0.5)
    save_wav("music_boss", music_battle(True), 0.5)
