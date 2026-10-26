"""Hey Tunacookie: every timed event and position for the Haiku cost film (metres, seconds).

The Blender scene (haiku_scene.py) and the sound (haiku_sound.py) both read this file.
Prices are $ per 1M tokens, Claude API first-party rates (Haiku 5.5: prompts up to 100K tokens).
"""
FPS = 30
DURATION = 12.0
FRAMES = 360
BPM = 120
BEAT = 60.0 / BPM

GREETING = ("HEY", "TUNACOOKIE")
PRICES = [  # (label, input $/1M, output $/1M, bar colour)
    ("OPUS 5.5", 4.00, 20.00, (0.85, 0.47, 0.34)),
    ("SONNET 5.5", 2.00, 10.00, (0.55, 0.62, 0.78)),
    ("HAIKU 5.5", 0.10, 0.50, (0.45, 0.88, 0.62)),
]
CHEAPER = round(PRICES[0][2] / PRICES[2][2])          # 40x
SAVED_PCT = 100 * (1 - PRICES[2][2] / PRICES[0][2])   # 97.5 %
CAPTION = "$ PER 1M OUTPUT TOKENS"
TAGLINE = f"HAIKU 5.5   ${PRICES[2][1]:.2f} IN  /  ${PRICES[2][2]:.2f} OUT   PER 1M TOKENS"
FOOTNOTE = "CLAUDE API LIST PRICES, PROMPTS UP TO 100K TOKENS"

# layout
TITLE_X, TITLE_Y = -1.55, 1.2
BAR_X = [1.45, 2.45, 3.45]
BAR_Y = 0.65
BAR_W = 0.5
M_PER_DOLLAR = 0.08
BUTTON = (3.45, -0.45)
BUTTON_TOP = 0.09

# beats
T_LETTER0, T_LETTER_STEP = 0.10, 0.08          # 13 letters drop in
T_WAVE1 = (0.95, 2.35)
T_BARS = [2.85, 3.25]                          # Opus, Sonnet grow
T_PRESS = 4.50                                 # Clawd lands on HAIKU 5.5
T_HAIKU_BAR = 4.58
T_CHEAPER = 5.00
T_COINS = (6.00, 8.20)
T_SAVED = 6.40
T_TAGLINE = 10.30
T_WAVE2 = 10.70

CLAWD_SCALE = 2.6
# hops: (takeoff, landing, x, y, surface z, apex)
START = (-4.6, -0.5, 0.0)
HOPS = [
    (0.15, 0.70, -1.55, -0.55, 0.0, 0.9),
    (2.55, 3.05, 0.55, -0.45, 0.0, 0.5),
    (3.90, T_PRESS, BUTTON[0], BUTTON[1], BUTTON_TOP, 0.7),
    (5.45, 6.00, BAR_X[2], BAR_Y, PRICES[2][2] * M_PER_DOLLAR, 0.45),
    (6.40, 6.75, BAR_X[2], BAR_Y, PRICES[2][2] * M_PER_DOLLAR, 0.3),
    (7.00, 7.35, BAR_X[2], BAR_Y, PRICES[2][2] * M_PER_DOLLAR, 0.3),
    (7.60, 7.95, BAR_X[2], BAR_Y, PRICES[2][2] * M_PER_DOLLAR, 0.3),
    (8.55, 9.30, 0.25, -0.65, 0.0, 1.0),
]


def frame(t):
    return int(round(t * FPS)) + 1


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def _coins(n=56, seed=11):
    """Coins that rain on the Haiku side: (spawn t, land t, x, y, landing z)."""
    import random
    r = random.Random(seed)
    out = []
    for i in range(n):
        t0 = T_COINS[0] + (T_COINS[1] - T_COINS[0]) * i / n + r.uniform(0, 0.05)
        x, y = r.uniform(2.85, 4.45), r.uniform(-0.75, 1.25)
        z = 0.008 + 0.016 * r.randint(0, 2)
        if abs(x - BAR_X[2]) < BAR_W / 2 and abs(y - BAR_Y) < BAR_W / 2:
            z += PRICES[2][2] * M_PER_DOLLAR
        elif abs(x - BUTTON[0]) < 0.35 and abs(y - BUTTON[1]) < 0.2:
            z += BUTTON_TOP
        drop = 3.2 - z
        out.append((t0, t0 + (2 * drop / 9.81) ** 0.5, x, y, z))
    return out


COINS = _coins()
