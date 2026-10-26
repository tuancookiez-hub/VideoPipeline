"""Builds build/haiku/haiku.blend: "HEY TUNACOOKIE" in 3D letters, a price chart, Clawd and the Haiku button.

blender -b --factory-startup -P haiku_scene.py
Env: CLAWD_RES (resolution %, default 100), CLAWD_SAMPLES (default 64)
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import haiku_timeline as H  # noqa: E402
import rig  # noqa: E402

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "haiku"))
FONT_PATH = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
N, FPS = H.FRAMES, H.FPS
TIMES = [(f - 1) / FPS for f in range(1, N + 1)]
F = H.frame
smooth = H.smooth


def clamp(x, a=0.0, b=1.0):
    return min(max(x, a), b)


def ease_out_back(x, c=1.9):
    x = clamp(x)
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


def ease_out_bounce(x):
    x = clamp(x)
    n, d = 7.5625, 2.75
    if x < 1 / d:
        return n * x * x
    if x < 2 / d:
        x -= 1.5 / d
        return n * x * x + 0.75
    if x < 2.5 / d:
        x -= 2.25 / d
        return n * x * x + 0.9375
    x -= 2.625 / d
    return n * x * x + 0.984375


# ------------------------------------------------------------------ scene setup
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
sc = bpy.context.scene
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, N
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = int(os.environ.get("CLAWD_RES", "100"))
sc.render.engine = "CYCLES"
cy = sc.cycles
cy.samples = int(os.environ.get("CLAWD_SAMPLES", "64"))
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.03
cy.use_denoising = True
cy.denoiser = "OPENIMAGEDENOISE"
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 4, 2, 2
cy.transmission_bounces, cy.transparent_max_bounces = 2, 4
cy.caustics_reflective = cy.caustics_refractive = False
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.render.use_persistent_data = True
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = 0.0
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.join(OUT, "frames", "h_")

world = bpy.data.worlds.new("Studio")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.011, 0.007, 1)

comp = bpy.data.node_groups.new("Bloom", "CompositorNodeTree")
sc.compositing_node_group = comp
rl = comp.nodes.new("CompositorNodeRLayers")
glare = comp.nodes.new("CompositorNodeGlare")
glare.inputs["Type"].default_value = "Bloom"
glare.inputs["Threshold"].default_value = 0.8
glare.inputs["Strength"].default_value = 0.4
glare.inputs["Size"].default_value = 0.6
out = comp.nodes.new("NodeGroupOutput")
comp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
comp.links.new(rl.outputs["Image"], glare.inputs["Image"])
comp.links.new(glare.outputs["Image"], out.inputs[0])

col = sc.collection
FONT = bpy.data.fonts.load(FONT_PATH)


def link(ob):
    col.objects.link(ob)
    return ob


def mat(name, color, rough=0.4, emit=None, strength=0.0, metal=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Specular IOR Level"].default_value = spec
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


def emission_socket(m):
    return m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]


def key(ob, f, loc=None, rot=None, scale=None):
    if loc is not None:
        ob.location = loc
        ob.keyframe_insert("location", frame=f)
    if rot is not None:
        ob.rotation_euler = rot
        ob.keyframe_insert("rotation_euler", frame=f)
    if scale is not None:
        ob.scale = scale if hasattr(scale, "__len__") else (scale,) * 3
        ob.keyframe_insert("scale", frame=f)


def key_hide(ob, first, last=N):
    for f, h in ((1, first > 1), (first, False), (last + 1, True)):
        if f <= N + 1:
            ob.hide_render = h
            ob.keyframe_insert("hide_render", frame=f)


def key_value(sock, f, v):
    sock.default_value = v
    sock.keyframe_insert("default_value", frame=f)


def text(body, size, loc, material, align="CENTER", extrude=0.03, standing=True, name=None):
    cu = bpy.data.curves.new(name or body, "FONT")
    cu.body = body
    cu.font = FONT
    cu.size = size
    cu.align_x = align
    cu.extrude = extrude
    cu.bevel_depth = min(0.006, extrude / 4)
    cu.bevel_resolution = 2
    cu.materials.append(material)
    ob = link(bpy.data.objects.new(name or body, cu))
    ob.location = loc
    if standing:
        ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob


def box(name, size, loc, material, bevel=0.0):
    """Box with its origin at the centre of its bottom face."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], (v.co.z + 0.5) * size[2]))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    if bevel:
        b = ob.modifiers.new("Bevel", "BEVEL")
        b.width, b.segments = bevel, 3
    return ob


# ------------------------------------------------------------------ stage
FLOOR = mat("Floor", (0.018, 0.012, 0.010), 0.22, spec=0.6)
floor = box("Floor", (40, 40, 0.1), (0, 0, -0.1), FLOOR)

# ------------------------------------------------------------------ HEY TUNACOOKIE, letter by letter
CREAM = mat("Cream", (0.85, 0.78, 0.68), 0.35, emit=(1.0, 0.86, 0.7), strength=0.35)
ORANGE = mat("Terracotta", (0.6, 0.16, 0.08), 0.35, emit=(1.0, 0.42, 0.22), strength=0.9)
letters = []
for row, (word, size, z, m) in enumerate([(H.GREETING[0], 0.62, 1.22, CREAM), (H.GREETING[1], 0.5, 0.52, ORANGE)]):
    objs = [text(ch, size, (0, H.TITLE_Y, z), m, align="LEFT", extrude=0.06, name=f"L{row}_{i}_{ch}")
            for i, ch in enumerate(word)]
    bpy.context.view_layer.update()
    gap = 0.045 * size
    widths = [o.dimensions.x for o in objs]
    x = H.TITLE_X - (sum(widths) + gap * (len(objs) - 1)) / 2
    for o, w in zip(objs, widths):
        o.location.x = x
        x += w + gap
        letters.append(o)
for i, o in enumerate(letters):
    t0 = H.T_LETTER0 + i * H.T_LETTER_STEP
    base = o.location.copy()
    for f, t in zip(range(1, N + 1), TIMES):
        u = (t - t0) / 0.5
        drop = 2.6 * (1 - ease_out_bounce(u))
        tilt = 0.5 * (1 - smooth(u * 1.4)) * (1 if i % 2 else -1)
        key(o, f, loc=base + Vector((0, 0, drop)), rot=(math.pi / 2, tilt, 0))
    key_hide(o, F(t0))

# ------------------------------------------------------------------ the price chart
bars, price_labels = [], []
for i, (label, p_in, p_out, color) in enumerate(H.PRICES):
    x = H.BAR_X[i]
    pad = box(f"Pad{i}", (0.72, 0.72, 0.035), (x, H.BAR_Y, 0), mat(f"Pad{i}", (0.03, 0.028, 0.027), 0.3), 0.01)
    m = mat(f"Bar{i}", color, 0.3, emit=color, strength=0.35)
    bar = box(f"Bar{i}", (H.BAR_W, H.BAR_W, 1.0), (x, H.BAR_Y, 0.035), m)
    bars.append((bar, m, p_out * H.M_PER_DOLLAR))
    text(label, 0.105, (x, H.BAR_Y - 0.4, 0.04), mat(f"Name{i}", (0.8, 0.8, 0.8), 0.4, emit=(1, 1, 1), strength=0.4),
         extrude=0.012)
    price = f"${p_out:.2f}" if p_out < 1 else f"${p_out:.0f}"
    price_labels.append(text(price, 0.2, (x, H.BAR_Y, 0), mat(f"Price{i}", color, 0.4, emit=color, strength=1.6),
                             extrude=0.025))
text(H.CAPTION, 0.1, (2.45, H.BAR_Y + 0.45, 2.02), mat("Caption", (0.7, 0.7, 0.7), 0.5, emit=(1, 0.95, 0.9), strength=0.5),
     extrude=0.01)

grow_at = H.T_BARS + [H.T_HAIKU_BAR]
for (bar, m, height), label, t0 in zip(bars, price_labels, grow_at):
    for f, t in zip(range(1, N + 1), TIMES):
        g = ease_out_back((t - t0) / 0.55, 1.4) if t >= t0 else 0.0
        h = max(0.0005, height * g)
        key(bar, f, scale=(1, 1, h))
        pop = ease_out_back((t - t0 - 0.25) / 0.3) if t >= t0 + 0.25 else 0.0
        key(label, f, loc=(bar.location.x, H.BAR_Y, 0.035 + h + 0.07), scale=max(pop, 0.001))
    key_hide(bar, F(t0))
    key_hide(label, F(t0 + 0.25))

# ------------------------------------------------------------------ the HAIKU 5.5 button
GREEN = H.PRICES[2][3]
key_mat = mat("Key", (0.04, 0.045, 0.045), 0.3, emit=GREEN, strength=0.0)
keycap = box("HaikuKey", (0.72, 0.4, H.BUTTON_TOP), (H.BUTTON[0], H.BUTTON[1], 0), key_mat, 0.02)
key_label_mat = mat("KeyLabel", GREEN, 0.4, emit=GREEN, strength=1.5)
key_label = text("HAIKU 5.5", 0.11, (0, -0.035, H.BUTTON_TOP + 0.002), key_label_mat, extrude=0.004, standing=False)
key_label.parent = keycap


def press(t, tl=H.T_PRESS):
    d = t - tl
    if d < 0:
        return 0.0
    return d / 0.05 if d < 0.05 else max(0.0, 1 - (d - 0.05) / 0.3)


for f, t in zip(range(1, N + 1), TIMES):
    key(keycap, f, scale=(1, 1, 1 - 0.4 * press(t)))
for t, v in [(H.T_PRESS - 0.04, 0.0), (H.T_PRESS, 3.0), (H.T_PRESS + 0.4, 0.6)]:
    key_value(emission_socket(key_mat), F(t), v)

# ------------------------------------------------------------------ 40x CHEAPER, SAVED 97.5%
POP_MAT = mat("Cheaper", (0.9, 0.4, 0.2), 0.3, emit=(1.0, 0.5, 0.22), strength=2.5)
cheaper = text(f"{H.CHEAPER}× CHEAPER", 0.26, (H.BAR_X[2], H.BAR_Y + 0.35, 1.05), POP_MAT, extrude=0.04)
saved = text(f"SAVED {H.SAVED_PCT:g}%", 0.15, (H.BAR_X[2], H.BAR_Y + 0.35, 0.78),
             mat("Saved", GREEN, 0.3, emit=GREEN, strength=1.8), extrude=0.025)
for ob, t0 in ((cheaper, H.T_CHEAPER), (saved, H.T_SAVED)):
    base = ob.location.copy()
    for f, t in zip(range(1, N + 1), TIMES):
        s = ease_out_back((t - t0) / 0.35, 2.4) if t >= t0 else 0.001
        key(ob, f, loc=base + Vector((0, 0, 0.02 * math.sin((t - t0) * 4))), scale=max(s, 0.001))
    key_hide(ob, F(t0))

# ------------------------------------------------------------------ coins
GOLD = mat("Gold", (1.0, 0.72, 0.25), 0.35, emit=(1.0, 0.7, 0.25), strength=0.35, metal=1.0)
rnd = random.Random(4)
for i, (t0, tl, x, y, zl) in enumerate(H.COINS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.07, depth=0.016)
    c = bpy.context.active_object
    c.name = f"Coin{i}"
    c.data.materials.append(GOLD)
    spin = Vector((rnd.uniform(-12, 12), rnd.uniform(-12, 12), rnd.uniform(-4, 4)))
    rest = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), rnd.uniform(0, 6.28)))
    for f, t in zip(range(1, N + 1), TIMES):
        if t < t0 - 0.05:
            continue
        if t < tl:
            d = max(0.0, t - t0)
            p = Vector((x, y, 3.2 - 4.905 * d * d))
            r = spin * d
        else:
            d = t - tl
            p = Vector((x, y, zl + 0.08 * abs(math.sin(d * 18)) * math.exp(-d * 9)))
            r = rest
        key(c, f, loc=p, rot=r)
    key_hide(c, F(t0))

# ------------------------------------------------------------------ tagline and footnote
TAG = mat("Tag", (0.85, 0.85, 0.85), 0.4, emit=(1, 0.95, 0.9), strength=0.8)
tagline = text(H.TAGLINE, 0.115, (H.TITLE_X, H.TITLE_Y, 0.2), TAG, extrude=0.012)
foot = text(H.FOOTNOTE, 0.06, (H.TITLE_X, H.TITLE_Y, 0.06), mat("Foot", (0.5, 0.5, 0.5), 0.5, emit=(1, 1, 1), strength=0.3),
            extrude=0.006)
for ob in (tagline, foot):
    base = ob.location.copy()
    for f, t in zip(range(1, N + 1), TIMES):
        u = smooth((t - H.T_TAGLINE) / 0.5)
        key(ob, f, loc=base + Vector((0, 0, -0.15 * (1 - u))), scale=(1, 1, max(u, 0.001)))
    key_hide(ob, F(H.T_TAGLINE))

# ------------------------------------------------------------------ Clawd
clawd = rig.build(col)
clawd.root.scale = (H.CLAWD_SCALE,) * 3
S = H.CLAWD_SCALE
stations = [(-1.0, *H.START)] + [(tl, x, y, z) for (ti, tl, x, y, z, apex) in H.HOPS]


def station_pos(i, t):
    tl, x, y, z = stations[i]
    if (x, y) == H.BUTTON:
        z -= 0.4 * H.BUTTON_TOP * press(t)
    return Vector((x, y, z))


def state(t):
    for i, (ti, tl, x, y, z, apex) in enumerate(H.HOPS):
        if ti <= t < tl:
            a, b = station_pos(i, ti), station_pos(i + 1, tl)
            u = (t - ti) / (tl - ti)
            p = a.lerp(b, u)
            p.z = a.z + (b.z - a.z) * u + 4 * apex * u * (1 - u)
            d = b - a
            heading = math.atan2(d.x, -d.y) if d.xy.length > 0.05 else None
            return p, heading, -0.16 * (1 - u) ** 2
    i = max(k for k, s in enumerate(stations) if s[0] <= t)
    sq = 0.0
    if i > 0:
        d = t - stations[i][0]
        sq = 0.3 * math.exp(-13 * d) * math.cos(26 * d)
    if i < len(H.HOPS):
        dt = H.HOPS[i][0] - t
        if 0 <= dt < 0.1:
            sq = max(sq, 0.2 * (1 - dt / 0.1))
    return station_pos(i, t), None, sq


def waving(t):
    return any(a <= t < b for a, b in (H.T_WAVE1, (H.T_WAVE2, 99)))


yaw, yaw_v = 0.0, 0.0
clawd_pos = []
for f, t in zip(range(1, N + 1), TIMES):
    p, heading, sq = state(t)
    tgt = 0.0
    if heading is not None:
        h = (heading + math.pi) % (2 * math.pi) - math.pi
        tgt = clamp(h, -1.4, 1.4) * 0.85
    for _ in range(4):
        dt = 1 / FPS / 4
        yaw_v += (160 * (tgt - yaw) - 2 * math.sqrt(160) * yaw_v) * dt
        yaw += yaw_v * dt
    key(clawd.root, f, loc=p, rot=(0, 0, yaw))
    sx = 1 + 0.55 * sq
    key(clawd.squash, f, scale=(sx, sx, 1 - sq))
    w = 0.0
    for a, b in (H.T_WAVE1, (H.T_WAVE2, 99)):
        w = max(w, smooth((t - a) / 0.2) * (1 - smooth((t - b + 0.2) / 0.2)))
    key(clawd.nub_pivot, f, rot=(0, -w * (1.0 + 0.45 * math.sin(t * 2 * math.pi * 2.5)), 0))
    clawd_pos.append(p + Vector((0, 0, rig.CENTER_Z * S)))

for e in clawd.eyes:
    e.hide_render = False
    e.keyframe_insert("hide_render", frame=1)
for e in clawd.happy:
    e.hide_render = True
    e.keyframe_insert("hide_render", frame=1)
prev = False
for f, t in zip(range(1, N + 1), TIMES):
    w = waving(t)
    if w != prev:
        for e in clawd.eyes:
            e.hide_render = w
            e.keyframe_insert("hide_render", frame=f)
        for e in clawd.happy:
            e.hide_render = not w
            e.keyframe_insert("hide_render", frame=f)
        prev = w

# ------------------------------------------------------------------ lights
def area(name, loc, energy, size, color, target=(0.5, 0.5, 0.6)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size, ld.color = energy, size, color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    ob.visible_glossy = False
    return ob


area("Key", (-3.0, -5.0, 5.0), 1400, 4.0, (1.0, 0.9, 0.82))
area("Rim", (3.0, 5.5, 3.0), 1100, 4.0, (1.0, 0.6, 0.35))
area("Fill", (5.5, -3.0, 2.5), 400, 3.0, (0.75, 0.85, 1.0))

# ------------------------------------------------------------------ camera
SHOTS = [  # (t, position, target)
    (0.0, (-1.45, -4.7, 1.35), (-1.5, 0.6, 0.78)),
    (2.3, (-1.3, -4.2, 1.25), (-1.45, 0.6, 0.75)),
    (3.3, (1.9, -4.4, 1.75), (2.35, 0.6, 1.0)),
    (3.9, (2.0, -4.2, 1.65), (2.4, 0.6, 0.95)),
    (4.6, (2.65, -2.35, 0.75), (3.2, 0.35, 0.55)),
    (5.4, (2.6, -2.25, 0.8), (3.2, 0.35, 0.6)),
    (6.2, (2.35, -2.8, 1.35), (3.35, 0.45, 0.65)),
    (8.2, (2.95, -2.7, 1.3), (3.35, 0.45, 0.65)),
    (9.4, (0.45, -6.4, 2.25), (0.55, 0.6, 0.85)),
    (12.0, (0.4, -5.9, 2.05), (0.55, 0.6, 0.8)),
]
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 30
cam_data.dof.use_dof = True
cam = link(bpy.data.objects.new("Cam", cam_data))
sc.camera = cam
prev_rot = None
for f, t in zip(range(1, N + 1), TIMES):
    k = max(i for i, s in enumerate(SHOTS) if s[0] <= t)
    if k + 1 < len(SHOTS):
        (t0, p0, g0), (t1, p1, g1) = SHOTS[k], SHOTS[k + 1]
        u = smooth((t - t0) / (t1 - t0))
    else:
        (t0, p0, g0), (p1, g1), u = SHOTS[k], SHOTS[k][1:], 0.0
    pos, tgt = Vector(p0).lerp(Vector(p1), u), Vector(g0).lerp(Vector(g1), u)
    rot = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    if prev_rot is not None:
        rot.make_compatible(prev_rot)
    prev_rot = rot
    key(cam, f, loc=pos, rot=rot)
    cam_data.dof.focus_distance = (clawd_pos[f - 1] - pos).length
    cam_data.dof.keyframe_insert("focus_distance", frame=f)
    cam_data.dof.aperture_fstop = 4.0 if 4.0 < t < 8.6 else 8.0
    cam_data.dof.keyframe_insert("aperture_fstop", frame=f)

os.makedirs(os.path.join(OUT, "frames"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "haiku.blend"))
print("saved haiku.blend")
