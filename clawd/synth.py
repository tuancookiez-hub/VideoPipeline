"""Shared synthesis helpers for the soundtracks: oscillators, filters and the stock hits."""
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
rng = np.random.default_rng(3)


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
    length = buf.shape[1]
    i = int(t0 * SR)
    if i >= length:
        return
    x = x[: length - max(i, 0)]
    if i < 0:
        x, i = x[-i:], 0
    buf[0, i:i + len(x)] += x * gain * np.sqrt(0.5 * (1 - pan))
    buf[1, i:i + len(x)] += x * gain * np.sqrt(0.5 * (1 + pan))


def kick():
    t = tt(0.35)
    return np.sin(2 * np.pi * np.cumsum(45 + 120 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12) * 0.9


def snare():
    t = tt(0.25)
    return (bp(noise(0.25), 1500, 7000) * 0.5 + np.sin(2 * np.pi * 190 * t) * 0.4) * np.exp(-t / 0.07) * 0.5


def hat(open_=False):
    d = 0.18 if open_ else 0.04
    return hp(noise(d + 0.05), 7000, 4) * env(d + 0.05, 0.001, d / 3) * 0.25


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


def coin(f=2100):
    t = tt(0.35)
    return (np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 1.5 * t)) * env(0.35, 0.001, 0.09) * 0.18
