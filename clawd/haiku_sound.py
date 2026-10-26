"""Synthesized soundtrack for Hey Tunacookie, every hit read from haiku_timeline.py -> build/haiku/sound.wav"""
import os

import numpy as np
from pedalboard import Compressor, Limiter, Pedalboard, Reverb
from pedalboard.io import AudioFile

import haiku_timeline as H
from synth import (SR, bell, blip, boing, bp, click, coin, env, hat, hp, kick, lp, noise, note, pomf, put, rng,
                   snare, sweep, tt, whoosh)

LEN = int(H.DURATION * SR)
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "haiku"))
music = np.zeros((2, LEN))
fx = np.zeros((2, LEN))
fx_wet = np.zeros((2, LEN))

CHORDS = [["F3", "A3", "C4", "E4"], ["G3", "B3", "D4", "F4"], ["A3", "C4", "E4", "G4"], ["C4", "E4", "G4", "B4"]]
BAR = 4 * H.BEAT
T_DROP = H.HOPS[0][1]                       # the beat drops when Clawd lands
T_BREAK = (H.HOPS[2][0], H.T_PRESS)         # the band holds its breath before the press
T_END = H.T_TAGLINE


def chord_at(t):
    return CHORDS[int(t // BAR) % 4]


def in_break(t):
    return T_BREAK[0] <= t < T_BREAK[1]


# ------------------------------------------------------------------ music
pad = np.zeros(LEN)
for b in range(int(H.DURATION // BAR) + 1):
    for n in chord_at(b * BAR):
        for det in (-0.1, 0.1):
            f = note(n) * 2 ** (det / 12)
            t = tt(BAR + 0.4)
            saw = 2 * ((f * t) % 1) - 1
            e = np.minimum(1, t / 0.3) * np.minimum(1, (BAR + 0.4 - t) / 0.3)
            seg = lp(saw, 1500) * e * 0.03
            i = int(b * BAR * SR)
            pad[i:i + len(seg)] += seg[: LEN - i]
tline = np.arange(LEN) / SR
pump = np.ones(LEN)
for k in np.arange(T_DROP, T_END, H.BEAT):
    if in_break(k):
        continue
    idx = (tline >= k) & (tline < k + H.BEAT)
    pump[idx] = 0.4 + 0.6 * np.minimum(1, (tline[idx] - k) / 0.22)
put(music, 0, pad * pump * 0.7)

for k in range(int(H.DURATION / (H.BEAT / 4))):
    t = k * H.BEAT / 4
    if t >= H.T_WAVE2 + 0.8 or in_break(t):
        continue
    if t < T_DROP:
        put(music, t, hat(), 0.4, pan=0.3)
    elif k % 2 == 0:
        put(music, t, hat(k % 8 == 6), 0.6 if k % 4 == 2 else 0.35, pan=0.25)

beats = [t for t in np.arange(T_DROP, T_END, H.BEAT) if not in_break(t)]
for k, t in enumerate(beats):
    put(music, t, kick(), 0.85)
    if k % 2 == 1:
        put(music, t, snare(), 0.75)

for t in np.arange(T_DROP, T_END, H.BEAT / 2):    # rubbery bass
    if in_break(t):
        continue
    f = note(chord_at(t)[0][0] + "2")
    tb = tt(0.24)
    x = np.tanh(2.5 * np.sin(2 * np.pi * np.cumsum(f * (1 + 0.25 * np.exp(-tb / 0.02))) / SR)) * env(0.24, 0.004, 0.12)
    put(music, t, lp(x, 900), 0.42)

for t in np.arange(T_DROP + H.BEAT / 2, T_END, H.BEAT):    # glassy FM keys on the off-beats
    if in_break(t):
        continue
    for n in chord_at(t)[1:]:
        f = note(n) * 2
        tk = tt(0.4)
        x = np.sin(2 * np.pi * f * tk + np.sin(2 * np.pi * f * 3.5 * tk) * 2.2 * np.exp(-tk / 0.08)) * env(0.4, 0.002, 0.15)
        put(music, t, x, 0.045, pan=0.35 if n[0] in "AE" else -0.35)

# the tagline: a warm C major chord that rings out
for n in ["C3", "G3", "C4", "E4", "G4", "C5"]:
    f = note(n)
    tb = tt(H.DURATION - T_END)
    saw = sum(np.sin(2 * np.pi * f * h * tb) / h for h in range(1, 7))
    put(music, T_END, lp(saw * np.minimum(1, tb / 0.03) * (0.45 + 0.55 * np.exp(-tb / 0.3)), 2400), 0.06)

# ------------------------------------------------------------------ effects
# letters: a rising pluck as each one lands (pentatonic, so the name plays a little tune)
SCALE = ["C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6", "G6", "A6", "C7", "D7", "E7"]
n_letters = sum(len(w) for w in H.GREETING)
for i in range(n_letters):
    t_land = H.T_LETTER0 + i * H.T_LETTER_STEP + 0.5 * 0.36
    put(fx_wet, t_land, bell(note(SCALE[i % len(SCALE)]), 0.5, 0.13), pan=-0.6 + 1.2 * i / n_letters)
    put(fx, t_land, pomf(), 0.25)

for (ti, tl, x, y, z, apex) in H.HOPS:
    pan = float(np.clip(x / 4.5, -0.7, 0.7))
    put(fx, ti, boing(), 0.8, pan=pan)
    put(fx, tl, pomf(), 1.0, pan=pan)
    if apex >= 0.6:
        put(fx, ti, whoosh(tl - ti), 0.8, pan=pan)

# bars grow: the expensive ones get long rising tones
for t0, (label, p_in, p_out, _), d in zip(H.T_BARS, H.PRICES, (0.55, 0.4)):
    put(fx, t0, sweep(180, 180 + 40 * p_out, d) * env(d, 0.02, d) * 0.22, pan=0.5)
# the press: click + blip, then the Haiku bar gives a tiny bloop
put(fx, H.T_PRESS, click(), 1.0, pan=0.6)
put(fx, H.T_PRESS + 0.02, blip(1500, 2400), 0.9, pan=0.6)
put(fx, H.T_HAIKU_BAR + 0.05, sweep(500, 760, 0.07) * env(0.07, 0.002, 0.03) * 0.5, pan=0.6)
# 40x CHEAPER: bell stab + sparkle
for i, n in enumerate(["C6", "E6", "G6", "C7"]):
    put(fx_wet, H.T_CHEAPER + i * 0.03, bell(note(n), 1.1, 0.16), pan=0.5)
put(fx_wet, H.T_CHEAPER, hp(noise(0.9), 6000) * env(0.9, 0.01, 0.3) * 0.25, pan=0.5)
# coins: one ding per landing, plus a cash-register ka-ching on SAVED
for (t0, tl, x, y, z) in H.COINS:
    put(fx, tl, coin(rng.uniform(1900, 2600)), 0.7, pan=float(np.clip((x - 3.4) / 1.2, -0.8, 0.8)))
put(fx, H.T_SAVED, bp(noise(0.06), 2000, 6000) * env(0.06, 0.001, 0.015) * 0.8, pan=0.5)
put(fx_wet, H.T_SAVED + 0.05, bell(note("E7"), 0.8, 0.2) + bell(note("C7"), 0.8, 0.2), pan=0.5)
# tagline chime, then yay chirps on the wave
put(fx_wet, H.T_TAGLINE, bell(note("G5"), 1.2, 0.15))
put(fx_wet, H.T_TAGLINE + 0.08, bell(note("C6"), 1.4, 0.12))
for i, (f0, f1) in enumerate([(700, 1300), (900, 1700)]):
    put(fx_wet, H.T_WAVE2 + 0.05 + i * 0.16, sweep(f0, f1, 0.14) * env(0.14, 0.005, 0.08) * 0.35, pan=-0.1)
for (a, b) in (H.T_WAVE1,):
    for i, (f0, f1) in enumerate([(800, 1400), (950, 1750)]):
        put(fx_wet, a + 0.05 + i * 0.16, sweep(f0, f1, 0.14) * env(0.14, 0.005, 0.08) * 0.3, pan=-0.35)

# ------------------------------------------------------------------ mix + master
wet = Pedalboard([Reverb(room_size=0.35, wet_level=0.3, dry_level=0.8, width=0.9)])(fx_wet.astype(np.float32), SR)
mix = music * 0.9 + fx + wet
nf = int(0.5 * SR)
mix[:, -nf:] *= np.linspace(1, 0, nf) ** 1.5
master = Pedalboard([Compressor(threshold_db=-16, ratio=3, attack_ms=5, release_ms=120), Limiter(threshold_db=-1.0)])
out = np.clip(master((mix * 0.9).astype(np.float32), SR), -0.891, 0.891)
os.makedirs(OUT, exist_ok=True)
with AudioFile(os.path.join(OUT, "sound.wav"), "w", SR, 2) as fh:
    fh.write(out)

for k in range(int(H.DURATION * 2)):     # the check: loudness per half second
    seg = out[:, int(k * SR / 2):int((k + 1) * SR / 2)]
    print(f"{k / 2:4.1f}s {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9):6.1f} dB")
