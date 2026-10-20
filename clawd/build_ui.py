"""Writes build/ui.html (the whole workspace) and build/chip.html from timeline.py."""
import html
import os

import timeline as T

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.normpath(os.path.join(HERE, "..", "build"))

ICONS = {  # 20x20 stroke icons, no logos
    "Home": "M3 10 L10 3 L17 10 M5 9 V17 H15 V9",
    "Selection": "M5 2 L5 16 L9 12 L12 18 L14 17 L11 11 L16 11 Z",
    "Hand": "M6 17 C4 14 3 11 4 9 L6 11 V4 C6 3 8 3 8 4 V9 V3 C8 2 10 2 10 3 V9 V4 C10 3 12 3 12 4 V10 V6 C12 5 14 5 14 6 V12 C14 15 12 17 10 17 Z",
    "Zoom": "M8.5 3 A5.5 5.5 0 1 1 8.4 3 Z M12.5 12.5 L17 17",
    "Rotate": "M15 6 A6 6 0 1 0 16 11 M15 2 V6 H11",
    "Camera": "M3 6 H13 V14 H3 Z M13 8 L17 6 V14 L13 12",
    "Pan Behind": "M10 2 V18 M2 10 H18 M10 2 L8 4 M10 2 L12 4 M10 18 L8 16 M10 18 L12 16 M2 10 L4 8 M2 10 L4 12 M18 10 L16 8 M18 10 L16 12",
    "Rectangle": "M3 5 H17 V15 H3 Z",
    "Pen": "M10 2 L15 11 L10 18 L5 11 Z M10 2 V10 M10 12 A1.5 1.5 0 1 1 10 11.9",
    "Type": "M4 4 H16 M10 4 V17 M7 17 H13",
    "Brush": "M16 3 L8 11 M8 11 C5 11 4 13 4 17 C7 17 9 16 9 13 Z",
    "Clone Stamp": "M7 3 H13 V8 L15 11 H5 L7 8 Z M4 14 H16 M5 17 H15",
    "Eraser": "M11 3 L17 9 L9 17 H5 L3 15 Z M7 7 L13 13",
    "Roto Brush": "M10 3 A3 3 0 1 1 9.9 3 Z M5 17 C5 12 15 12 15 17",
    "Puppet": "M10 3 A2 2 0 1 1 9.9 3 Z M10 7 V12 M6 9 H14 M10 12 L7 17 M10 12 L13 17",
}


def svg(path, size=20, stroke="#c4c4c4", width=1.5, fill="none"):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 20 20"><path d="{path}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/></svg>')


def box(x0, y0, x1, y1, cls="", style="", inner=""):
    return (f'<div class="{cls}" style="left:{x0}px;top:{y0}px;width:{x1 - x0}px;height:{y1 - y0}px;{style}">'
            f'{inner}</div>')


def text(x, y, s, cls="", style=""):
    return f'<div class="t {cls}" style="left:{x}px;top:{y}px;{style}">{html.escape(s)}</div>'


def panel_frame(name, tabs, active=0):
    x0, y0, x1, y1, _ = T.PANELS[name]
    out = [box(x0 + 2, y0 + 2, x1 - 2, y1 - 2, "panel")]
    x = x0 + 12
    for i, tab in enumerate(tabs):
        w = 9 + 6.6 * len(tab)
        cls = "tab on" if i == active else "tab"
        out.append(text(x, y0 + 8, tab + ("  ≡" if i == active else ""), cls))
        if i == active:
            out.append(box(x - 4, y0 + 25, x + w + 14, y0 + 27, "ul"))
        x += w + 34
    return out


def build():
    P = T.PANELS
    h = []
    # menu bar
    h.append(box(0, 0, 1920, 26, "menubar"))
    for i, m in enumerate(["File", "Edit", "Composition", "Layer", "Effect", "Animation", "View", "Window", "Help"]):
        h.append(text(16 + [0, 40, 80, 176, 228, 282, 362, 412, 476][i], 6, m, "menu"))
    h.append(text(900, 6, "Untitled Project.aep *", "menu dim"))
    # toolbar
    h.append(box(0, 26, 1920, 68, "toolbar"))
    for name in T.TOOLS:
        x0, y0, x1, y1 = T.tool_rect(name)
        hot = name in ("Type", "Rectangle", "Pen")
        h.append(box(x0, y0, x1, y1, "tool hot" if hot else "tool",
                     inner=f'<div class="ic">{svg(ICONS[name], 22, "#e2e2e2" if hot else "#bdbdbd")}</div>'))
    sx = T.TOOL_X0 + len(T.TOOLS) * T.TOOL_W + 18
    h.append(box(sx, 39, sx + 14, 53, "check", inner=svg("M4 10 L8 14 L16 5", 14, "#e8e8e8", 2.2)))
    h.append(text(sx + 22, 39, "Snapping", "menu"))
    wx = 1300
    for i, ws in enumerate(["Default", "Review", "Learn", "Standard", "Small Screen", "Libraries"]):
        h.append(text(wx, 39, ws, "ws on" if i == 0 else "ws"))
        if i == 0:
            h.append(box(wx, 56, wx + 46, 58, "ul"))
        wx += 30 + 7.2 * len(ws)
    h.append(box(1880, 36, 1902, 58, "", inner=svg(ICONS["Zoom"], 20)))

    # project
    x0, y0, x1, y1, _ = P["project"]
    h += panel_frame("project", ["Project", "Effect Controls MADE WITH CLAUDE"])
    h.append(box(x0 + 12, y0 + 40, x0 + 112, y0 + 96, "thumb"))
    h.append(text(x0 + 124, y0 + 42, "Main Comp ▾", "b"))
    h.append(text(x0 + 124, y0 + 60, "1920 x 1080 (1.00)", "dim"))
    h.append(text(x0 + 124, y0 + 76, "Δ 0:00:04:00, 30.00 fps", "dim"))
    h.append(box(x0 + 12, y0 + 110, x1 - 12, y0 + 132, "field", inner=svg(ICONS["Zoom"], 14)))
    h.append(box(x0 + 2, y0 + 140, x1 - 2, y0 + 162, "colhead"))
    h.append(text(x0 + 40, y0 + 145, "Name", "dim"))
    h.append(text(x0 + 200, y0 + 145, "Type", "dim"))
    h.append(text(x0 + 300, y0 + 145, "Size", "dim"))
    items = [("Main Comp", "Composition", "", "#c8a0d8"), ("clawd.png", "PNG file", "12 KB", "#a07d5a"),
             ("Solids", "Folder", "", "#e2c46a")]
    for i, (n, ty, sz, col) in enumerate(items):
        yy = y0 + 170 + i * 24
        if i == 0:
            h.append(box(x0 + 2, yy - 3, x1 - 2, yy + 19, "sel"))
        h.append(box(x0 + 16, yy + 2, x0 + 28, yy + 14, "", f"background:{col};border-radius:2px"))
        h.append(text(x0 + 40, yy, n))
        h.append(text(x0 + 200, yy, ty, "dim"))
        h.append(text(x0 + 300, yy, sz, "dim"))
    h.append(text(x0 + 16, y1 - 26, "8 bpc", "dim"))

    # composition panel (viewer + bottom bar are redrawn per frame by the comp canvas)
    x0, y0, x1, y1, _ = P["comp"]
    h += panel_frame("comp", ["Composition Main Comp", "Layer (none)", "Footage (none)"])
    vx0, vy0, vx1, vy1 = T.VIEWER
    h.append(box(vx0 + 2, vy0, vx1 - 2, vy1 - 2, "viewer"))
    h.append(box(*T.COMP_RECT, "compbox"))

    # info
    x0, y0, x1, y1, _ = P["info"]
    h += panel_frame("info", ["Info", "Audio"])
    for i, (a, b) in enumerate([("R :", "X : 1412"), ("G :", "Y : 388"), ("B :", ""), ("A : 0", "")]):
        h.append(text(x0 + 20, y0 + 38 + i * 16, a, "dim mono"))
        h.append(text(x0 + 200, y0 + 38 + i * 16, b, "dim mono"))

    # preview
    x0, y0, x1, y1, _ = P["preview"]
    h += panel_frame("preview", ["Preview"])
    bx = [1580, 1616, 1652, None, 1740, 1776]
    glyph = ["M4 4 V16 M16 4 L7 10 L16 16 Z", "M10 4 L3 10 L10 16 Z M17 4 L10 10 L17 16 Z",
             "M14 4 V16 M6 4 L13 10 L6 16 Z", None, "M3 4 L10 10 L3 16 Z M10 4 L17 10 L10 16 Z",
             "M16 4 V16 M4 4 L13 10 L4 16 Z"]
    for x, g in zip(bx, glyph):
        if x:
            h.append(box(x, 224, x + 28, 248, "", inner=svg(g, 24, "#bdbdbd", 1.4, "#bdbdbd")))
    px0, py0, px1, py1, _ = T.BUTTONS["play"]
    h.append(box(px0, py0, px1, py1, "tool hot",
                 inner=f'<div class="ic">{svg("M6 3 L17 10 L6 17 Z", 26, "#f0f0f0", 1.4, "#f0f0f0")}</div>'))
    h.append(text(x0 + 20, y0 + 92, "Shortcut", "dim"))
    h.append(text(x0 + 90, y0 + 92, "Spacebar ▾", ""))
    h.append(text(x0 + 220, y0 + 92, "Include:", "dim"))

    # effects & presets
    x0, y0, x1, y1, _ = P["effects"]
    h += panel_frame("effects", ["Effects & Presets", "Libraries"])
    h.append(box(x0 + 12, y0 + 38, x1 - 12, y0 + 62, "field on", inner=svg(ICONS["Zoom"], 14)))
    h.append(text(x0 + 40, y0 + 42, "glow", "b"))
    h.append(text(x1 - 34, y0 + 42, "✕", "dim"))
    rows = [("▸  * Animation Presets", 0), ("▾  Stylize", 0), ("Glow", 1), ("▾  Synthetic Aperture", 0),
            ("Color Glow", 1), ("▸  Obsolete", 0)]
    for i, (n, ind) in enumerate(rows):
        yy = y0 + 72 + i * 24
        if n == "Glow":
            gx0, gy0, gx1, gy1, _ = T.BUTTONS["glow"]
            h.append(box(gx0, gy0, gx1, gy1, "sel hot"))
            h.append(box(gx0 + 30, gy0 + 4, gx0 + 46, gy0 + 20, "fxic", inner=svg("M3 15 L10 4 L17 15 Z", 16, "#f4f4f4", 1.2, "#7a5df0")))
            h.append(text(gx0 + 56, gy0 + 4, n, "b"))
        else:
            h.append(text(x0 + 24 + ind * 34, yy, n, "" if ind else "dim"))

    # timeline
    x0, y0, x1, y1, _ = P["timeline"]
    h += panel_frame("timeline", ["Main Comp", "Render Queue"])
    h.append(text(14, y0 + 34, "0:00:00:00", "tc"))
    h.append(text(176, y0 + 42, "00000 (30.00 fps)", "dim"))
    h.append(box(300, y0 + 36, 470, y0 + 58, "field", inner=svg(ICONS["Zoom"], 14)))
    rx0, ry0, rx1, ry1 = T.TL_RULER
    h.append(box(2, ry0, rx0, ry1, "colhead"))
    for lab, xx in [("#", 54), ("Source Name", 92), ("Mode", 330), ("T  TrkMat", 410), ("Parent & Link", 540)]:
        h.append(text(xx, ry0 + 7, lab, "dim"))
    h.append(box(rx0, ry0, rx1, ry1, "ruler"))
    for k in range(0, 9):
        c = k * 0.5
        xx = T.comp_time_x(c)
        major = k % 2 == 0
        h.append(box(xx, ry1 - (12 if major else 6), xx + 1, ry1, "", "background:#8a8a8a"))
        if major:
            h.append(text(xx + 4, ry0 + 3, f"{k // 2:02d}s", "dim small"))
    h.append(box(T.comp_time_x(0), ry0 + 1, T.comp_time_x(T.COMP_DUR), ry0 + 4, "", "background:#4a6fa0"))
    for i, (lab, kind, col) in enumerate(T.TL_ROWS):
        yy = T.TL_ROW_Y0 + i * T.TL_ROW_H
        h.append(box(2, yy, x1 - 2, yy + T.TL_ROW_H - 1, "row" + (" sel" if i == 0 else "")))
        if kind == "layer":
            n = sum(1 for r in T.TL_ROWS[:i + 1] if r[1] == "layer")
            h.append(box(10, yy + 7, 22, yy + 19, "", "border:1.5px solid #9a9a9a;border-radius:2px"))
            h.append(box(30, yy + 7, 42, yy + 19, "", f"background:{col};border-radius:2px"))
            h.append(text(56, yy + 5, str(n), "dim"))
            h.append(text(78, yy + 5, ("▾  " if i == 0 else "▸  ") + lab, "b" if i == 0 else ""))
            h.append(text(330, yy + 5, "Normal ▾", "dim"))
            h.append(text(540, yy + 5, "⓪  None ▾", "dim"))
            h.append(box(T.comp_time_x(0), yy + 4, T.comp_time_x(T.COMP_DUR), yy + T.TL_ROW_H - 5, "bar",
                         f"background:{col}"))
        else:
            h.append(box(100, yy + 6, 114, yy + 20, "", inner=svg("M10 3 A7 7 0 1 1 9.9 3 Z M10 6 V10 L13 12", 14, "#3d9bff", 1.6)))
            h.append(text(122, yy + 5, lab))
            val = "960.0, 540.0" if lab == "Position" else "∞ 100.0, 100.0%"
            h.append(text(330, yy + 5, val, "blue"))
    h.append(text(14, y1 - 26, "Frame Render Time  0ms", "dim"))
    h.append(text(600, y1 - 26, "Toggle Switches / Modes", "dim"))

    return "\n".join(h)


CSS = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;background:#0e0e0e;overflow:hidden}
body>div{position:absolute}
.t{position:absolute;font:500 12px Inter,sans-serif;color:#c9c9c9;white-space:nowrap;letter-spacing:.1px}
.t.dim{color:#8f8f8f}.t.b{color:#ececec;font-weight:600}.t.small{font-size:10px}
.t.mono{font-family:'JetBrains Mono',monospace;font-size:11px}
.t.blue{color:#3d9bff}.t.menu{color:#d0d0d0;font-size:12.5px}
.t.tab{color:#9a9a9a;font-size:12px}.t.tab.on{color:#f0f0f0;font-weight:600}
.t.ws{color:#a8a8a8}.t.ws.on{color:#3d9bff;font-weight:600}
.t.tc{font:600 24px Inter,sans-serif;color:#3d9bff;letter-spacing:.5px}
.menubar{background:#1c1c1c}
.toolbar{background:#232323;border-bottom:1px solid #111}
.panel{background:#232323;border-radius:4px;border:1px solid #2c2c2c}
.ul{background:#2d8ceb;border-radius:1px}
.tool{border-radius:4px;background:#2a2a2a;border:1px solid #333}
.tool.hot{background:#343434;border:1px solid #4a4a4a}
.ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex}
.check{background:#2d8ceb;border-radius:3px;display:flex;align-items:center;justify-content:center}
.thumb{background:#000;border:1px solid #3a3a3a}
.field{background:#1a1a1a;border:1px solid #3c3c3c;border-radius:12px;padding:3px 8px}
.field.on{border-color:#2d8ceb}
.colhead{background:#1d1d1d;border-bottom:1px solid #333}
.sel{background:#3a4458}
.sel.hot{background:#2d5d9a;border-radius:3px}
.viewer{background:#1b1b1b}
.compbox{background:#000}
.ruler{background:#1e1e1e;border-bottom:1px solid #3a3a3a}
.row{border-bottom:1px solid #2b2b2b}
.row.sel{background:#2e3644}
.bar{opacity:.78;border-radius:2px}
.fxic{border-radius:3px}
"""


def write():
    os.makedirs(BUILD, exist_ok=True)
    page = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{build()}</body></html>"
    with open(os.path.join(BUILD, "ui.html"), "w") as fh:
        fh.write(page)
    chip = (f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}"
            "html,body{width:240px;height:64px;background:#2d5d9a}</style></head><body>"
            f"<div style='left:14px;top:14px;width:36px;height:36px' class='fxic'>{svg('M3 15 L10 4 L17 15 Z', 36, '#fff', 1.2, '#7a5df0')}</div>"
            "<div class='t b' style='left:64px;top:12px;font-size:30px;font-weight:700'>Glow</div></body></html>")
    with open(os.path.join(BUILD, "chip.html"), "w") as fh:
        fh.write(chip)
    T.export(os.path.join(BUILD, "layout.json"))
    print("wrote ui.html, chip.html, layout.json in", BUILD)


if __name__ == "__main__":
    write()
