"""Synthesizes the whole soundtrack from timeline.py: no samples, no words. -> build/sound.wav"""
import os

import numpy as np
from pedalboard import Compressor, Limiter, Pedalboard, Reverb
from pedalboard.io import AudioFile
from scipy.signal import butter, sosfilt

import timeline as T

SR = 48000
LEN = int(T.DURATION * SR)
BUILD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build"))
rng = np.random.default_rng(3)

music = np.zeros((2, LEN))
fx = np.zeros((2, LEN))
fx_wet = np.zeros((2, LEN))      # effects that get a little room


def note(n):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return 440.0 * 2 ** ((names[n[0]] + 12 * (int(n[-1]) + 1) - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def env(dur, a=0.002, d=0.1):
    t = tt(dur)
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "lowpass", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "highpass", fs=SR, output="sos"), x)


def sweep(f0, f1, dur, curve="exp"):
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur) if curve == "exp" else f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def put(buf, t0, x, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= LEN:
        return
    x = x[: LEN - max(i, 0)]
    if i < 0:
        x, i = x[-i:], 0
    buf[0, i:i + len(x)] += x * gain * np.sqrt(0.5 * (1 - pan))
    buf[1, i:i + len(x)] += x * gain * np.sqrt(0.5 * (1 + pan))


def pan_of(t):
    """Pan effects with where Clawd is on the workspace."""
    x = T.COMP_CENTER_UI[0]
    for (ti, tl, hx, hy, *_ ) in T.HOPS:
        if t >= ti:
            x = hx
    return float(np.clip((x - 960) / 1100, -0.7, 0.7))


# ------------------------------------------------------------------ music
CHORDS = [("F", ["F3", "A3", "C4", "E4"]), ("G", ["G3", "B3", "D4", "F4"]),
          ("A", ["A3", "C4", "E4", "G4"]), ("C", ["C4", "E4", "G4", "B4"])]
BAR = 4 * T.BEAT


def chord_at(t):
    return CHORDS[int(t // BAR) % 4]


# pad, with the kick pump after the drop
pad = np.zeros(LEN)
for b in range(int(T.DURATION // BAR) + 1):
    root, notes = chord_at(b * BAR)
    for n in notes:
        for det in (-0.12, 0.12):
            f = note(n) * 2 ** (det / 12)
            t = tt(BAR + 0.4)
            saw = 2 * ((f * t) % 1) - 1
            e = np.minimum(1, t / 0.3) * np.minimum(1, (BAR + 0.4 - t) / 0.3)
            seg = lp(saw, 1400) * e * 0.035
            i = int(b * BAR * SR)
            pad[i:i + len(seg)] += seg[: LEN - i]
tline = np.arange(LEN) / SR
pump = np.ones(LEN)
for k in np.arange(T.T_POP, T.T_PLAY, T.BEAT):
    idx = (tline >= k) & (tline < k + T.BEAT)
    pump[idx] = 0.35 + 0.65 * np.minimum(1, (tline[idx] - k) / 0.22)
pad_gain = np.where(tline < T.T_POP, 0.8, 0.55)
put(music, 0, pad * pump * pad_gain)
put(music, 0, np.roll(pad, 600) * pump * pad_gain * 0.4, pan=0.6)


def kick():
    t = tt(0.35)
    return np.sin(2 * np.pi * np.cumsum(45 + 120 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12) * 0.9


def snare():
    t = tt(0.25)
    return (bp(noise(0.25), 1500, 7000) * 0.5 + np.sin(2 * np.pi * 190 * t) * 0.4) * np.exp(-t / 0.07) * 0.5


def hat(open_=False):
    d = 0.18 if open_ else 0.04
    return hp(noise(d + 0.05), 7000, 4) * env(d + 0.05, 0.001, d / 3) * 0.25


for k in range(int(T.DURATION / (T.BEAT / 4))):          # ticking hats on 16ths
    t = k * T.BEAT / 4
    if t >= T.T_WAVE:
        break
    if t < T.T_POP:
        put(music, t, hat(), 0.35 if k % 2 else 0.6, pan=0.3)
    elif k % 2 == 0:
        put(music, t, hat(k % 8 == 6), 0.7 if k % 4 == 2 else 0.4, pan=0.25)

for k, t in enumerate(np.arange(T.T_POP, T.T_PLAY, T.BEAT)):
    put(music, t, kick(), 0.9)
    if k % 2 == 1:
        put(music, t, snare(), 0.8, pan=-0.05)
    if k % 4 == 3:
        put(music, t + T.BEAT * 0.75, kick(), 0.5)

# rubbery bass on F G Am C
for t in np.arange(T.T_POP, T.T_PLAY, T.BEAT / 2):
    root = chord_at(t)[0]
    f = note(root + "2") * (2 if int(t / (T.BEAT / 2)) % 4 == 3 else 1)
    d = 0.24
    tb = tt(d)
    fr = f * (1 + 0.25 * np.exp(-tb / 0.02))
    x = np.tanh(2.5 * np.sin(2 * np.pi * np.cumsum(fr) / SR)) * env(d, 0.004, 0.12)
    put(music, t, lp(x, 900), 0.45)

# glassy FM keys on the off-beats
for t in np.arange(T.T_POP + T.BEAT / 2, T.T_PLAY, T.BEAT):
    for n in chord_at(t)[1][1:]:
        f = note(n) * 2
        tk = tt(0.4)
        mod = np.sin(2 * np.pi * f * 3.5 * tk) * 2.2 * np.exp(-tk / 0.08)
        x = np.sin(2 * np.pi * f * tk + mod) * env(0.4, 0.002, 0.15)
        put(music, t, x, 0.05, pan=0.35 if n[0] in "AE" else -0.35)

# Play: a C major brass stab, then the chord rings out
for n in ["C3", "G3", "C4", "E4", "G4", "C5"]:
    f = note(n)
    tb = tt(T.DURATION - T.T_PLAY)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * tb)
    saw = sum(np.sin(2 * np.pi * f * h * np.cumsum(vib) / SR) / h for h in range(1, 9))
    e = np.minimum(1, tb / 0.02) * (0.45 + 0.55 * np.exp(-tb / 0.25))
    cutoff = lp(saw * e, 2600)
    put(music, T.T_PLAY, cutoff, 0.07)

# ------------------------------------------------------------------ effects
def glass_knock():
    t = tt(0.4)
    return (sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in [(2350, 0.08), (3720, 0.05), (5100, 0.03)])
            + bp(noise(0.4), 1500, 5000) * np.exp(-t / 0.01)) * 0.35


def glass_break():
    out = np.zeros(int(0.9 * SR))
    for _ in range(40):
        f = rng.uniform(2500, 9000)
        i = int(rng.exponential(0.12) * SR)
        if i >= len(out):
            continue
        t = tt(0.15)
        p = np.sin(2 * np.pi * f * t) * np.exp(-t / rng.uniform(0.01, 0.05)) * rng.uniform(0.1, 0.4)
        n = min(len(p), len(out) - i)
        out[i:i + n] += p[:n]
    return out + hp(noise(0.9), 3000) * env(0.9, 0.001, 0.12) * 0.4


def boing(d=0.22):
    t = tt(d)
    f = 180 + 420 * (t / d) + 40 * np.sin(2 * np.pi * 22 * t)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.1) * 0.35


def pomf():
    t = tt(0.15)
    return (lp(noise(0.15), 400) * 0.6 + np.sin(2 * np.pi * 110 * t)) * env(0.15, 0.002, 0.035) * 0.55


def whoosh(d):
    n = noise(d)
    t = tt(d)
    shape = np.sin(np.pi * t / d) ** 2
    lo = bp(n, 300, 1200) * (1 - t / d) + bp(n, 1200, 4500) * (t / d)
    return lo * shape * 0.5


def click():
    return hp(noise(0.03), 2000) * env(0.03, 0.0005, 0.006) * 0.8 + np.sin(2 * np.pi * 1800 * tt(0.03)) * env(0.03, 0.0005, 0.01) * 0.3


def blip(f0=1200, f1=1900):
    return sweep(f0, f1, 0.08) * env(0.08, 0.002, 0.04) * 0.25


def bell(f, d=0.9, g=0.3):
    t = tt(d)
    return sum(np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d / (1 + 2 * k))) / (1 + k)
               for k, r in enumerate([1, 2.76, 5.4])) * g


def zap():
    t = tt(0.4)
    f = 900 * np.exp(-t / 0.08) + 50
    saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
    return lp(saw, 2500) * env(0.4, 0.002, 0.15) * 0.25


def sub_boom(d=1.0, g=0.9):
    t = tt(d)
    return np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-t / 0.1)) / SR) * env(d, 0.004, 0.35) * g


for k in T.T_KNOCKS:
    put(fx_wet, k, glass_knock(), 1.0, pan=-0.05)
# sticker peel + riser
peel_d = T.T_PEEL[1] - T.T_PEEL[0]
pn = noise(peel_d)
crackle = (rng.random(len(pn)) > 0.997) * rng.standard_normal(len(pn)) * 3
put(fx, T.T_PEEL[0], (bp(pn, 1500, 6000) * 0.25 + hp(crackle, 2000)) * np.linspace(1, 0.3, len(pn)), 0.6)
riser_d = T.T_POP - 1.2
put(fx, 1.2, bp(noise(riser_d), 800, 6000) * np.linspace(0, 1, int(riser_d * SR)) ** 2 * 0.35
    + sweep(200, 1600, riser_d) * np.linspace(0, 1, int(riser_d * SR)) ** 3 * 0.08)
# pop, breaking glass, sub boom
put(fx, T.T_POP, sweep(900, 180, 0.08) * env(0.08, 0.001, 0.03), 0.6)
put(fx_wet, T.T_POP, glass_break(), 0.8)
put(fx, T.T_POP, sub_boom(), 1.0)

# hops: boing on take-off, pomf on landing, whoosh on the big leaps
for (ti, tl, x, y, zs, apex, fl) in T.HOPS:
    put(fx, ti, boing(), 0.8, pan=pan_of(ti))
    put(fx, tl, pomf(), 1.0, pan=pan_of(tl))
    if apex >= 0.3 or fl:
        put(fx, ti, whoosh(tl - ti), 0.9, pan=pan_of(tl))
# tools: keycap click + blip; 16 key taps for the title
for tb in (T.T_TYPE, T.T_RECT, T.T_PEN, T.T_GLOW_LAND, T.T_PLAY):
    put(fx, tb, click(), 1.0, pan=pan_of(tb))
    put(fx, tb + 0.02, blip(), 0.8, pan=pan_of(tb))
for i in range(len(T.TITLE)):
    put(fx, T.T_TYPE + 0.04 + i * (T.T_TYPE_END - T.T_TYPE) / len(T.TITLE),
        hp(noise(0.02), 3000) * env(0.02, 0.0005, 0.004) * rng.uniform(0.3, 0.5), pan=rng.uniform(-0.3, 0.3))
put(fx, T.T_RECT + 0.03, sweep(280, 950, 0.18) * env(0.18, 0.003, 0.08) * 0.5)              # bloop
scrib = bp(noise(0.35), 2000, 5000) * (0.5 + 0.5 * np.sin(2 * np.pi * 17 * tt(0.35))) ** 2
put(fx, T.T_PEN + 0.02, scrib * env(0.35, 0.01, 0.3) * 0.35)                                  # pen scribble
# glow: thwack, chip whoosh, magic shimmer with bells
put(fx, T.T_KICK, lp(noise(0.12), 2500) * env(0.12, 0.001, 0.03) * 0.9 + sweep(220, 80, 0.12) * env(0.12, 0.001, 0.05) * 0.6,
    pan=0.4)
put(fx, T.T_KICK, whoosh(T.T_CHIP_HIT - T.T_KICK + 0.1), 0.8, pan=0.1)
for i, n in enumerate(["C6", "E6", "G6", "B6", "D7", "E7", "G7"]):
    put(fx_wet, T.T_CHIP_HIT + i * 0.045, bell(note(n), 1.2, 0.12), pan=(i % 3 - 1) * 0.4)
put(fx_wet, T.T_CHIP_HIT, hp(noise(1.0), 6000) * np.sin(np.pi * tt(1.0)) ** 2 * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * tt(1.0))) * 0.25)
# keyframes: rising glockenspiel C E G C
for (ft, ct), n in zip(T.KEYS, ["C6", "E6", "G6", "C7"]):
    put(fx_wet, ft, bell(note(n), 0.9, 0.3), pan=pan_of(ft))
# playhead: tape rewind chirps, skate roll, scrub ticks
for k in range(10):
    t0 = T.T_REWIND[0] + k * 0.04
    put(fx, t0, sweep(2400 - k * 120, 900 - k * 50, 0.035) * env(0.035, 0.002, 0.02) * 0.18, pan=0.3 - k * 0.06)
sd = T.T_SURF[1] - T.T_SURF[0] + 0.1
roll = lp(noise(sd), 250) * (0.8 + 0.2 * np.sin(2 * np.pi * 9 * tt(sd))) * np.minimum(1, tt(sd) / 0.05) * np.minimum(1, (sd - tt(sd)) / 0.1)
put(fx, T.T_SURF[0], roll * 1.4, pan=0)
for k in np.arange(T.T_SURF[0], T.T_SURF[1], 1 / 15):
    put(fx, k, hp(noise(0.01), 4000) * env(0.01, 0.0005, 0.003) * 0.35, pan=pan_of(k))
# play: shimmer + sparkles
put(fx_wet, T.T_PLAY, hp(noise(1.2), 5000) * env(1.2, 0.01, 0.4) * 0.25)
# the editor powers down and falls
for i, name in enumerate(T.FALL_ORDER):
    t0 = T.T_FALL0 + i * T.T_FALL_STEP
    put(fx, t0, zap(), 0.9, pan=(-0.5 + i * 0.2))
    put(fx, t0 + 0.15, whoosh(0.6), 0.4, pan=(-0.5 + i * 0.2))
put(fx, 11.0, sub_boom(0.9, 0.6))
# yay chirps and sparkles
for i, (f0, f1) in enumerate([(700, 1300), (900, 1700)]):
    put(fx_wet, T.T_WAVE + 0.05 + i * 0.16, sweep(f0, f1, 0.14) * env(0.14, 0.005, 0.08) * 0.35, pan=0.4)
for _ in range(14):
    tsp = T.T_WAVE + rng.uniform(0, 0.7)
    put(fx_wet, tsp, bell(rng.uniform(3000, 6000), 0.3, 0.05), pan=rng.uniform(-0.6, 0.6))

# ------------------------------------------------------------------ mix + master
room = Pedalboard([Reverb(room_size=0.35, wet_level=0.3, dry_level=0.8, width=0.9)])
wet = room(fx_wet.astype(np.float32), SR)
mix = music * 0.9 + fx + wet
fade = np.ones(LEN)
nf = int(0.5 * SR)
fade[-nf:] = np.linspace(1, 0, nf) ** 1.5
mix *= fade
master = Pedalboard([Compressor(threshold_db=-16, ratio=3, attack_ms=5, release_ms=120), Limiter(threshold_db=-1.0)])
out = master((mix * 0.9).astype(np.float32), SR)
out = np.clip(out, -0.891, 0.891)
with AudioFile(os.path.join(BUILD, "sound.wav"), "w", SR, 2) as fh:
    fh.write(out)

# the check: loudness per half second
for k in range(int(T.DURATION * 2)):
    seg = out[:, int(k * SR / 2):int((k + 1) * SR / 2)]
    print(f"{k / 2:4.1f}s {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9):6.1f} dB")
