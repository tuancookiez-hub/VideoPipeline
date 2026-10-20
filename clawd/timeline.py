"""Single source of truth: UI layout in UI pixels (1920x1080) and every timed event.

The HTML interface, the comp canvas, the Blender scene and the sound all read this
file (JS readers get it as build/layout.json via `python timeline.py`).
"""
import json
import math
import os

FPS = 30
DURATION = 12.0
FRAMES = 360
BPM = 120
BEAT = 60.0 / BPM

UI_W, UI_H = 1920, 1080
UI_SCALE = 2                      # ui.png is 3840x2160
PX = 0.004                        # metres per UI pixel in Blender

CLAWD_HEX = "#D97757"


def frame(t):
    """Film time in seconds -> 1-based frame number."""
    return int(round(t * FPS)) + 1


def ui_to_world(ux, uy, z=0.0):
    """Pixels are the API: one function turns UI pixels into metres."""
    return ((ux - UI_W / 2) * PX, (UI_H / 2 - uy) * PX, z)


# ---------------------------------------------------------------- panels
# name: (x0, y0, x1, y1, title)
PANELS = {
    "menubar":  (0,    0,    1920, 26,   ""),
    "toolbar":  (0,    26,   1920, 68,   ""),
    "project":  (0,    68,   372,  612,  "Project"),
    "comp":     (372,  68,   1488, 612,  "Composition"),
    "info":     (1488, 68,   1920, 176,  "Info"),
    "preview":  (1488, 176,  1920, 300,  "Preview"),
    "effects":  (1488, 300,  1920, 612,  "Effects & Presets"),
    "timeline": (0,    612,  1920, 1080, "Main Comp"),
}

# viewer inside the comp panel: drawn per frame by the comp canvas
VIEWER = (372, 96, 1488, 612)          # includes the bottom bar with the timecode
COMP_RECT = (530, 116, 1330, 566)      # the 1920x1080 comp shown at 41.67%
COMP_W, COMP_H = 1920, 1080

# toolbar: 15 tools, 52 px apart
TOOLS = ["Home", "Selection", "Hand", "Zoom", "Rotate", "Camera", "Pan Behind",
         "Rectangle", "Pen", "Type", "Brush", "Clone Stamp", "Eraser", "Roto Brush", "Puppet"]
TOOL_X0, TOOL_W, TOOL_Y0, TOOL_Y1 = 14, 52, 30, 64


def tool_rect(name):
    i = TOOLS.index(name)
    x = TOOL_X0 + i * TOOL_W
    return (x + 3, TOOL_Y0, x + TOOL_W - 3, TOOL_Y1)


# timeline geometry
TL_ROW_Y0, TL_ROW_H = 704, 26
TL_TRACK_X0, TL_TRACK_X1 = 720, 1900
TL_RULER = (720, 672, 1900, 700)
COMP_DUR = 4.0                         # inner comp is 4 s long
TL_T0_X, TL_PX_PER_S = 760, 275        # comp time 0 at x=760, 4 s at x=1860

TL_ROWS = [  # (label, kind, colour)
    ("MADE WITH CLAUDE", "layer", "#c8423f"),
    ("Position", "prop", None),
    ("Scale", "prop", None),
    ("Spark", "layer", "#c9a227"),
    ("Swoosh", "layer", "#5d8fa8"),
    ("BG", "layer", "#8a7cc1"),
    ("clawd.png", "layer", "#a07d5a"),
]


def tl_row_center(i):
    return TL_ROW_Y0 + i * TL_ROW_H + TL_ROW_H / 2


def comp_time_x(c):
    return TL_T0_X + c * TL_PX_PER_S


# ---------------------------------------------------------------- buttons Clawd hits
BUTTONS = {
    "type":      tool_rect("Type") + ("toolbar",),
    "rectangle": tool_rect("Rectangle") + ("toolbar",),
    "pen":       tool_rect("Pen") + ("toolbar",),
    "glow":      (1522, 420, 1700, 444, "effects"),
    "play":      (1682, 220, 1726, 252, "preview"),
}

# keyframes stamped on the Position row: (film time, comp time)
KEYS = [(6.0, 0.0), (6.5, 1.0), (7.0, 2.0), (7.5, 3.0)]
# title group pose at each key: comp-pixel offset from centre and scale
KEY_POSES = [(-300, 180, 0.72), (190, -170, 0.88), (190, 40, 1.0), (0, -40, 1.0)]
KEY_ROW = 1
PLAYHEAD_HEAD = (TL_RULER[1] + TL_RULER[3]) / 2


def button_center(name):
    x0, y0, x1, y1, _ = BUTTONS[name]
    return ((x0 + x1) / 2, (y0 + y1) / 2)


# ---------------------------------------------------------------- beats / events
T_KNOCKS = [0.62, 1.02]
T_PEEL = (1.50, 1.90)
T_POP = 2.00
T_TYPE, T_RECT, T_PEN = 2.50, 3.00, 3.50
T_TYPE_END = 2.90
TITLE = "MADE WITH CLAUDE"
T_GLOW_LAND = 4.50
T_CHIP_UP = 4.62
T_KICK = 5.00
T_CHIP_HIT = 5.40
T_PLAYHEAD_ON = 8.00
T_REWIND = (8.00, 8.40)
T_SURF = (8.50, 9.60)
T_PLAY = 10.00
T_FALL0, T_FALL_STEP = 10.45, 0.15
FALL_ORDER = ["timeline", "project", "toolbar", "effects", "info", "preview"]
T_WAVE = 11.20

# Clawd hops: (takeoff time, landing time, landing UI x, UI y, landing surface, apex m, flip)
SURF_KEY = 0.016      # raised hit buttons
SURF_HEAD = 0.034     # playhead head top
COMP_CENTER_UI = ((COMP_RECT[0] + COMP_RECT[2]) / 2, (COMP_RECT[1] + COMP_RECT[3]) / 2)
END_SPOT = (1385, 520)

HOPS = [
    (2.12, T_TYPE, *button_center("type"), SURF_KEY, 0.42, False),
    (2.76, T_RECT, *button_center("rectangle"), SURF_KEY, 0.16, False),
    (3.26, T_PEN, *button_center("pen"), SURF_KEY, 0.16, False),
    (3.78, T_GLOW_LAND, button_center("glow")[0] + 10, button_center("glow")[1], SURF_KEY, 0.36, True),
    (5.48, KEYS[0][0], comp_time_x(0), tl_row_center(KEY_ROW), 0.0, 0.40, False),
    (6.16, KEYS[1][0], comp_time_x(1), tl_row_center(KEY_ROW), 0.0, 0.20, False),
    (6.66, KEYS[2][0], comp_time_x(2), tl_row_center(KEY_ROW), 0.0, 0.20, False),
    (7.16, KEYS[3][0], comp_time_x(3), tl_row_center(KEY_ROW), 0.0, 0.20, False),
    (7.70, T_PLAYHEAD_ON, comp_time_x(3), PLAYHEAD_HEAD, SURF_HEAD, 0.16, False),
    (9.66, T_PLAY, *button_center("play"), SURF_KEY, 0.45, False),
    (10.42, 11.00, *END_SPOT, 0.0, 0.30, False),
]


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def ease_io(x):
    x = min(max(x, 0.0), 1.0)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def playhead(t):
    """Comp time under the playhead at film time t."""
    if t < KEYS[0][0]:
        return 0.0
    if t < T_REWIND[0]:
        c = 0.0
        for i in range(1, len(KEYS)):
            ft, ct = KEYS[i]
            prev = KEYS[i - 1][1]
            c = prev + (ct - prev) * smooth((t - ft) / 0.08) if t >= ft else c
            if t < ft:
                break
        return c
    if t < T_REWIND[1]:
        return 3.0 * (1 - ease_io((t - T_REWIND[0]) / (T_REWIND[1] - T_REWIND[0])))
    if t < T_SURF[0]:
        return 0.0
    if t < T_SURF[1]:
        return COMP_DUR * ease_io((t - T_SURF[0]) / (T_SURF[1] - T_SURF[0]))
    return COMP_DUR


def export(path):
    data = {k: v for k, v in globals().items()
            if k.isupper() and isinstance(v, (int, float, str, list, tuple, dict))}
    data["PLAYHEAD"] = [round(playhead((f - 1) / FPS), 5) for f in range(1, FRAMES + 1)]
    with open(path, "w") as fh:
        json.dump(data, fh, indent=1)


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "layout.json")
    export(out)
    print("wrote", os.path.normpath(out))
