"""Builds build/scene.blend: the workspace as floating slabs, Clawd, camera and every move.

blender -b --factory-startup -P scene.py
Env: CLAWD_RES (resolution %, default 100), CLAWD_SAMPLES (default 64)
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as T  # noqa: E402

BUILD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build"))
FPS, N = T.FPS, T.FRAMES
TIMES = [(f - 1) / FPS for f in range(1, N + 1)]


def F(t):
    return T.frame(t)


def clamp(x, a=0.0, b=1.0):
    return min(max(x, a), b)


def ease_out_back(x, c=1.9):
    x = clamp(x)
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


def bump(t, a, b, ramp=0.15):
    return T.smooth((t - a) / ramp) * (1 - T.smooth((t - b) / ramp))


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
cy.transmission_bounces, cy.transparent_max_bounces = 2, 8
cy.caustics_reflective = cy.caustics_refractive = False
cy.blur_glossy = 1.0
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.render.use_persistent_data = True
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = 0.15
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.join(BUILD, "frames", "f_")

world = bpy.data.worlds.new("Studio")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.016, 0.008, 0.005, 1)
bg.inputs[1].default_value = 1.0

# bloom in the compositor
comp = bpy.data.node_groups.new("Bloom", "CompositorNodeTree")
sc.compositing_node_group = comp
rl = comp.nodes.new("CompositorNodeRLayers")
glare = comp.nodes.new("CompositorNodeGlare")
glare.inputs["Type"].default_value = "Bloom"
glare.inputs["Threshold"].default_value = 0.8
glare.inputs["Strength"].default_value = 0.35
glare.inputs["Size"].default_value = 0.6
out = comp.nodes.new("NodeGroupOutput")
comp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
comp.links.new(rl.outputs["Image"], glare.inputs["Image"])
comp.links.new(glare.outputs["Image"], out.inputs[0])


def load(name):
    return bpy.data.images.load(os.path.join(BUILD, name), check_existing=True)


UI_IMG = load("ui.png")


# ------------------------------------------------------------------ materials
def glass_screen(name, image, strength=1.0, seq=False, alpha=False):
    """UI as emission under black glossy glass; low specular so lights cannot blow it out."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.004, 0.004, 0.005, 1)
    p.inputs["Roughness"].default_value = 0.32
    p.inputs["Specular IOR Level"].default_value = 0.1
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Cubic"
    if seq:
        tex.image_user.frame_duration = N
        tex.image_user.frame_start = 1
        tex.image_user.use_auto_refresh = True
    nt.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], p.inputs["Alpha"])
    p.inputs["Emission Strength"].default_value = strength
    return m


def plain(name, color, rough=0.4, emit=None, strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Specular IOR Level"].default_value = spec
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


def emission_socket(m):
    return m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]


SIDE = plain("SlabSide", (0.012, 0.011, 0.011), 0.3, spec=0.3)


# ------------------------------------------------------------------ slabs
def link(obj):
    sc.collection.objects.link(obj)
    return obj


def slab(name, rect, z_top, thick, top_mat, inset=4, uv_rect=None, parent=None):
    """A floating slab whose top face carries exactly its own piece of the UI texture."""
    x0, y0, x1, y1 = rect[:4]
    ux, uy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = (x1 - x0 - 2 * inset) * T.PX, (y1 - y0 - 2 * inset) * T.PX
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * d, v.co.z * thick - thick / 2))
    uvl = bm.loops.layers.uv.new("UV")
    for f in bm.faces:
        top = f.normal.z > 0.9
        f.material_index = 0 if top else 1
        for lp in f.loops:
            px = ux + lp.vert.co.x / T.PX
            py = uy - lp.vert.co.y / T.PX
            lp[uvl].uv = (px / T.UI_W, 1 - py / T.UI_H) if top else (0, 0)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(top_mat)
    me.materials.append(SIDE)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = T.ui_to_world(ux, uy, z_top)
    bev = ob.modifiers.new("Bevel", "BEVEL")
    bev.width, bev.segments, bev.limit_method = 0.004, 2, "ANGLE"
    if parent:
        ob.parent = parent
        ob.location = ob.location - parent.location
    return ob


def quad(name, rect, mat, z, parent=None):
    """Flat textured quad (UV 0..1) covering a UI rect."""
    x0, y0, x1, y1 = rect
    ux, uy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = (x1 - x0) * T.PX / 2, (y1 - y0) * T.PX / 2
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w, -d, 0), (w, -d, 0), (w, d, 0), (-w, d, 0)], [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new(name="UV")
    for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uvl.data[i].uv = uv
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = T.ui_to_world(ux, uy, z)
    if parent:
        ob.parent = parent
        ob.location = ob.location - parent.location
    return ob


panels, panel_mats = {}, {}
z_offsets = {"menubar": 0.0, "toolbar": 0.0, "project": -0.01, "comp": 0.0, "info": -0.005,
             "preview": 0.0, "effects": 0.0, "timeline": 0.0}
for name, rect in T.PANELS.items():
    m = glass_screen("UI_" + name, UI_IMG)
    panel_mats[name] = m
    panels[name] = slab("Panel_" + name, rect, z_offsets[name], 0.05, m)
# menubar rides with the toolbar
panels["menubar"].parent = panels["toolbar"]
panels["menubar"].location -= panels["toolbar"].location

seq = load("comp/comp_0001.png")
seq.source = "SEQUENCE"
viewer = quad("CompViewer", T.VIEWER[:2] + (T.VIEWER[2], T.VIEWER[3] - 3), glass_screen("CompSeq", seq, seq=True),
              0.0006, parent=panels["comp"])
viewer.location.x += 0  # keep inside comp panel

# hit buttons: their own keycaps so they can press and light up
keycaps = {}
for name, (x0, y0, x1, y1, owner) in T.BUTTONS.items():
    m = glass_screen("Key_" + name, UI_IMG)
    keycaps[name] = (slab("Key_" + name, (x0, y0, x1, y1), T.SURF_KEY, 0.03, m, inset=0,
                          parent=panels[owner]), m)


# ------------------------------------------------------------------ helpers for keying
def key_loc(ob, f, loc):
    ob.location = loc
    ob.keyframe_insert("location", frame=f)


def key_rot(ob, f, rot):
    ob.rotation_euler = rot
    ob.keyframe_insert("rotation_euler", frame=f)


def key_scale(ob, f, s):
    ob.scale = s
    ob.keyframe_insert("scale", frame=f)


def key_hide(ob, frames_visible):
    """frames_visible: (first, last) inclusive."""
    a, b = frames_visible
    for f, h in ((1, a > 1), (a, False), (b + 1, True)):
        if f <= N + 1:
            ob.hide_render = h
            ob.keyframe_insert("hide_render", frame=f)


def key_value(sock, f, v):
    sock.default_value = v
    sock.keyframe_insert("default_value", frame=f)


# ------------------------------------------------------------------ Clawd
BODY = plain("ClawdBody", (0.52, 0.13, 0.07), 0.42, spec=0.45)
EYE = plain("ClawdEye", (0.005, 0.005, 0.005), 0.25)
U = 0.02  # one body unit in metres: body 12x8x6 units


def rbox(name, size, loc, mat, bevel, parent):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    ob.parent = parent
    if bevel:
        b = ob.modifiers.new("Bevel", "BEVEL")
        b.width, b.segments = bevel, 5
        b.harden_normals = False
        for p in me.polygons:
            p.use_smooth = True
    return ob


root = link(bpy.data.objects.new("ClawdRoot", None))
flip = link(bpy.data.objects.new("ClawdFlip", None))
flip.parent = root
CENTER_Z = 2 * U + 4 * U
flip.location = (0, 0, CENTER_Z)
squash = link(bpy.data.objects.new("ClawdSquash", None))
squash.parent = flip
squash.location = (0, 0, -CENTER_Z)
body = rbox("ClawdBodyMesh", (12 * U, 6 * U, 8 * U), (0, 0, CENTER_Z), BODY, 0.022, squash)
for i, lx in enumerate([-4.25, -1.75, 1.75, 4.25]):
    rbox(f"ClawdLeg{i}", (1.5 * U, 2.2 * U, 2.6 * U), (lx * U, 0, 1.3 * U), BODY, 0.006, squash)
nub_l = rbox("ClawdNubL", (2.4 * U, 2.4 * U, 2.0 * U), (-7.0 * U, 0, CENTER_Z), BODY, 0.008, squash)
nub_pivot = link(bpy.data.objects.new("ClawdNubPivot", None))
nub_pivot.parent = squash
nub_pivot.location = (6 * U, 0, CENTER_Z)
nub_r = rbox("ClawdNubR", (2.4 * U, 2.4 * U, 2.0 * U), (1.0 * U, 0, 0), BODY, 0.008, nub_pivot)
eyes = [rbox(f"ClawdEye{i}", (1.1 * U, 0.6 * U, 2.4 * U), (sx * 2.45 * U, -3.0 * U, CENTER_Z + 0.8 * U), EYE, 0.003, squash)
        for i, sx in enumerate((-1, 1))]
happy = []
for i, sx in enumerate((-1, 1)):        # ^^ eyes for the wave
    for j, a in enumerate((1, -1)):
        e = rbox(f"ClawdHappy{i}{j}", (1.5 * U, 0.6 * U, 0.55 * U),
                 (sx * 2.45 * U + a * -0.55 * U, -3.0 * U, CENTER_Z + 1.0 * U), EYE, 0.002, squash)
        e.rotation_euler = (0, a * math.radians(-40), 0)
        happy.append(e)

# flat card that peels off the comp
flat_img = load("clawd_flat.png")
card_mat = glass_screen("ClawdCard", flat_img, strength=1.2, alpha=True)
card_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.085, 0.03, 1)
CARD_UI = (930.0, 339.3)
card_w, card_h = 85.3 * T.PX, 64.0 * T.PX
cme = bpy.data.meshes.new("Card")
cme.from_pydata([(-card_w / 2, 0, 0), (card_w / 2, 0, 0), (card_w / 2, card_h, 0), (-card_w / 2, card_h, 0)], [], [(0, 1, 2, 3)])
cuv = cme.uv_layers.new(name="UV")
for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
    cuv.data[i].uv = uv
cme.materials.append(card_mat)
card = link(bpy.data.objects.new("ClawdCard", cme))

# ------------------------------------------------------------------ Clawd path
POP_UI = T.COMP_CENTER_UI
BUTTON_AT = {T.T_TYPE: "type", T.T_RECT: "rectangle", T.T_PEN: "pen", T.T_GLOW_LAND: "glow", T.T_PLAY: "play"}
stations = [(T.T_POP, POP_UI[0], POP_UI[1], 0.0, None)]
for (ti, tl, x, y, zs, apex, fl) in T.HOPS:
    stations.append((tl, x, y, zs, BUTTON_AT.get(tl)))


def press(t, tl):
    d = t - tl
    if d < 0:
        return 0.0
    return d / 0.05 if d < 0.05 else max(0.0, 1 - (d - 0.05) / 0.22)


def station_pos(i, t):
    tl, x, y, zs, btn = stations[i]
    if tl == T.T_PLAYHEAD_ON:
        x = T.comp_time_x(T.playhead(t))
    z = zs - (0.01 * press(t, tl) if btn else 0.0)
    return Vector(T.ui_to_world(x, y, z))


def clawd_state(t):
    """-> position, heading hint, flip angle, squash amount (+ squash, - stretch)."""
    if t < T.T_POP:
        return station_pos(0, t), None, 0.0, 0.0
    for i, (ti, tl, x, y, zs, apex, fl) in enumerate(T.HOPS):
        if ti <= t < tl:
            a, b = station_pos(i, ti), station_pos(i + 1, tl)
            u = (t - ti) / (tl - ti)
            p = a.lerp(b, u)
            p.z = a.z + (b.z - a.z) * u + 4 * apex * u * (1 - u)
            d = b - a
            heading = math.atan2(d.x, -d.y) if d.xy.length > 0.05 else None
            ang = 2 * math.pi * T.smooth(u) if fl else 0.0
            return p, heading, ang, -0.16 * (1 - u) ** 2
    # resting on a station
    i = max(k for k, s in enumerate(stations) if s[0] <= t)
    p = station_pos(i, t)
    sq = 0.0
    d = t - stations[i][0]
    if i > 0:
        sq = 0.3 * math.exp(-13 * d) * math.cos(26 * d)
    if i < len(T.HOPS):
        dt = T.HOPS[i][0] - t
        if 0 <= dt < 0.1:
            sq = max(sq, 0.2 * (1 - dt / 0.1))
    return p, None, 0.0, sq


def target_yaw(t, heading):
    if T.T_GLOW_LAND + 0.1 <= t < T.T_KICK + 0.35:
        return math.radians(-75)
    if T.T_PLAYHEAD_ON <= t < T.HOPS[9][0]:
        return math.radians(80)
    if heading is not None:
        h = (heading + math.pi) % (2 * math.pi) - math.pi
        return clamp(h, -1.4, 1.4) * 0.85
    return 0.0


yaw, yaw_v = 0.0, 0.0
clawd_world = []
for f, t in zip(range(1, N + 1), TIMES):
    p, heading, ang, sq = clawd_state(t)
    # critically damped yaw
    tgt = target_yaw(t, heading)
    for _ in range(4):
        h = 1 / FPS / 4
        acc = 160 * (tgt - yaw) - 2 * math.sqrt(160) * yaw_v
        yaw_v += acc * h
        yaw += yaw_v * h
    lean = 0.0
    if T.T_KICK - 0.15 <= t < T.T_KICK + 0.3:      # wind-up and kick
        k = (t - (T.T_KICK - 0.15)) / 0.45
        lean = -0.35 * math.sin(k * math.pi * 1.0) if k < 0.33 else 0.45 * math.sin((k - 0.33) / 0.67 * math.pi)
    if T.T_REWIND[0] <= t < T.T_REWIND[1] + 0.1:
        lean = -0.25 * bump(t, T.T_REWIND[0], T.T_REWIND[1], 0.08)
    if T.T_SURF[0] <= t < T.T_SURF[1] + 0.06:
        lean = 0.22 * bump(t, T.T_SURF[0], T.T_SURF[1], 0.12) + 0.05 * math.sin(t * 19)
    key_loc(root, f, p)
    key_rot(root, f, (0, 0, yaw))
    key_rot(flip, f, (ang + lean, 0, 0))
    pop = 1.0
    if t < T.T_POP + 0.25:
        pop = max(0.001, 0.25 + 0.75 * ease_out_back((t - T.T_POP) / 0.2, 2.6))
    sx = 1 + 0.55 * sq
    key_scale(squash, f, (sx * pop, sx * pop, (1 - sq) * pop))
    # wave with the right nub at the end
    w = T.smooth((t - T.T_WAVE) / 0.2)
    key_rot(nub_pivot, f, (0, -w * (1.0 + 0.45 * math.sin((t - T.T_WAVE) * 2 * math.pi * 2.5)), 0))
    blink = 1.0
    for tb in (2.6, 5.2, 7.9, 9.9):
        if tb <= t < tb + 0.12:
            blink = 0.15
    for e in eyes:
        key_scale(e, f, (1, 1, blink))
    clawd_world.append(p + Vector((0, 0, CENTER_Z)))

for ob in [body, nub_l, nub_r] + eyes + [o for o in squash.children if o.name.startswith("ClawdLeg")]:
    key_hide(ob, (F(T.T_POP), F(T.T_WAVE) - 1 if ob in eyes else N))
for e in happy:
    key_hide(e, (F(T.T_WAVE), N))

# card: lies flat in the comp, hinges up from its near edge, then pops
hinge = Vector(T.ui_to_world(CARD_UI[0], CARD_UI[1] + 32.0, 0.0007))
for f, t in zip(range(1, N + 1), TIMES):
    u = T.ease_io((t - T.T_PEEL[0]) / (T.T_PEEL[1] - T.T_PEEL[0]))
    wob = 0.06 * math.sin(max(0.0, t - T.T_PEEL[1]) * 40)
    key_loc(card, f, hinge + Vector((0, 0, 0.06 * u)))
    key_rot(card, f, (u * math.radians(88) + wob, 0, 0))
    s = 1 + 0.25 * T.smooth((t - 1.9) / 0.1)
    key_scale(card, f, (s, s, s))
key_hide(card, (F(T.T_PEEL[0]), F(T.T_POP) - 1))

# ------------------------------------------------------------------ shards from the cracked viewer
SHARD = plain("Shard", (0.6, 0.65, 0.75), 0.08, emit=(0.8, 0.85, 1.0), strength=0.6, spec=0.8)
rnd = random.Random(5)
pop_w = Vector(T.ui_to_world(*POP_UI, 0.01))
for i in range(34):
    me = bpy.data.meshes.new(f"Shard{i}")
    pts = [(rnd.uniform(-1, 1) * 0.016, rnd.uniform(-1, 1) * 0.016, 0) for _ in range(3)]
    me.from_pydata(pts, [], [(0, 1, 2)])
    me.materials.append(SHARD)
    sh = link(bpy.data.objects.new(f"Shard{i}", me))
    ang = rnd.uniform(0, 2 * math.pi)
    sp = rnd.uniform(0.4, 1.1)
    vel = Vector((math.cos(ang) * sp, math.sin(ang) * sp * 0.7, rnd.uniform(0.9, 1.9)))
    spin = Vector((rnd.uniform(-14, 14), rnd.uniform(-14, 14), rnd.uniform(-8, 8)))
    life = rnd.uniform(0.6, 1.0)
    for f, t in zip(range(1, N + 1), TIMES):
        d = max(0.0, t - T.T_POP)
        if d > life + 0.1 or t < T.T_POP - 0.1:
            continue
        pos = pop_w + vel * d + Vector((0, 0, -4.9 * d * d))
        key_loc(sh, f, pos)
        key_rot(sh, f, spin * d)
        s = 1 - T.smooth((d - life * 0.6) / (life * 0.4))
        key_scale(sh, f, (s, s, s) if t >= T.T_POP else (0.001,) * 3)
    key_hide(sh, (F(T.T_POP), F(T.T_POP + life) + 1))

# ------------------------------------------------------------------ keycaps press and light up
for name, (cap, m) in keycaps.items():
    tl = next(s[0] for s in stations if s[4] == name)
    base = cap.location.copy()
    sock = emission_socket(m)
    for f, t in zip(range(1, N + 1), TIMES):
        key_loc(cap, f, base + Vector((0, 0, -0.01 * press(t, tl))))
    for t, v in [(tl - 0.04, 1.0), (tl, 3.2), (tl + 0.3, 1.5)]:
        key_value(sock, F(t), v)

# ------------------------------------------------------------------ timeline: keyframe diamonds + playhead
tl_panel = panels["timeline"]
DIA = plain("Diamond", (0.2, 0.3, 0.5), 0.3, emit=(0.35, 0.6, 1.0), strength=4.0)
for i, (ft, ct) in enumerate(T.KEYS):
    me = bpy.data.meshes.new(f"Key{i}")
    s = 11 * T.PX
    me.from_pydata([(0, -s, 0), (s, 0, 0), (0, s, 0), (-s, 0, 0), (0, 0, 0.012)], [],
                   [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)])
    me.materials.append(DIA)
    d = link(bpy.data.objects.new(f"KeyDiamond{i}", me))
    d.parent = tl_panel
    loc = Vector(T.ui_to_world(T.comp_time_x(ct), T.tl_row_center(T.KEY_ROW) + 0, 0.0005)) - tl_panel.location
    for f, t in zip(range(1, N + 1), TIMES):
        s = ease_out_back((t - ft) / 0.18, 3.0) if t >= ft else 0.001
        key_loc(d, f, loc)
        key_scale(d, f, (max(s, 0.001),) * 3)
    # offset in front of his feet so the stamp is visible
    d.location.y -= 0.0

PH = plain("Playhead", (0.05, 0.2, 0.6), 0.3, emit=(0.18, 0.55, 1.0), strength=5.0)
ph = link(bpy.data.objects.new("Playhead", None))
ph.parent = tl_panel
rx0, ry0, rx1, ry1 = T.TL_RULER
head = rbox("PlayheadHead", (40 * T.PX, (ry1 - ry0 - 6) * T.PX, T.SURF_HEAD), (0, 0, T.SURF_HEAD / 2), PH, 0.004, ph)
line_len = (T.TL_ROW_Y0 + len(T.TL_ROWS) * T.TL_ROW_H - ry1) * T.PX
rbox("PlayheadLine", (2.5 * T.PX, line_len, 0.004), (0, -((ry1 - ry0) * T.PX / 2 + line_len / 2), 0.002), PH, 0, ph)
for f, t in zip(range(1, N + 1), TIMES):
    w = Vector(T.ui_to_world(T.comp_time_x(T.playhead(t)), T.PLAYHEAD_HEAD, 0.0)) - tl_panel.location
    key_loc(ph, f, w)

# ------------------------------------------------------------------ glow chip
chip_img = load("chip.png")
chip_mat = glass_screen("Chip", chip_img, strength=2.2)
cw, ch = 0.20, 0.053
cm = bpy.data.meshes.new("Chip")
bmc = bmesh.new()
bmesh.ops.create_cube(bmc, size=1.0)
for v in bmc.verts:
    v.co = Vector((v.co.x * cw, v.co.y * 0.012, v.co.z * ch))
uvc = bmc.loops.layers.uv.new("UV")
for fc in bmc.faces:
    for lp in fc.loops:
        lp[uvc].uv = (lp.vert.co.x / cw + 0.5, lp.vert.co.z / ch + 0.5)
bmc.to_mesh(cm)
bmc.free()
cm.materials.append(chip_mat)
chip = link(bpy.data.objects.new("GlowChip", cm))
gx, gy = T.button_center("glow")
chip_rest = Vector(T.ui_to_world(gx - 62, gy + 6, 0.13))
chip_start = Vector(T.ui_to_world(gx - 40, gy, 0.0))
chip_end = Vector(T.ui_to_world(*T.COMP_CENTER_UI, 0.05))
for f, t in zip(range(1, N + 1), TIMES):
    if t < T.T_KICK:
        u = ease_out_back((t - T.T_CHIP_UP) / 0.25)
        p = chip_start.lerp(chip_rest, u) + Vector((0, 0, 0.012 * math.sin(t * 9)))
        s = max(0.001, T.smooth((t - T.T_CHIP_UP) / 0.12))
        r = (0, 0, 0.1 * math.sin(t * 5))
    else:
        u = clamp((t - T.T_KICK) / (T.T_CHIP_HIT - T.T_KICK))
        p = chip_rest.lerp(chip_end, u)
        p.z = chip_rest.z + (chip_end.z - chip_rest.z) * u + 0.6 * u * (1 - u)
        s = 1 - 0.6 * u
        r = (0, -u * 4 * math.pi, 0.4 * u)
    key_loc(chip, f, p)
    key_rot(chip, f, r)
    key_scale(chip, f, (s, s, s))
key_hide(chip, (F(T.T_CHIP_UP), F(T.T_CHIP_HIT)))

# ------------------------------------------------------------------ the editor powers down and falls
for i, name in enumerate(T.FALL_ORDER):
    t0 = T.T_FALL0 + i * T.T_FALL_STEP
    ob = panels[name]
    sock = emission_socket(panel_mats[name])
    key_value(sock, F(t0) - 1, 1.0)
    for k, v in enumerate([2.2, 0.3, 1.4, 0.0]):
        key_value(sock, F(t0) + k * 2, v)
    for cap_name, (cap, m) in keycaps.items():
        if T.BUTTONS[cap_name][4] == name:
            key_value(emission_socket(m), F(t0) - 1, 1.5)
            key_value(emission_socket(m), F(t0) + 6, 0.0)
    base = ob.location.copy()
    rr = random.Random(i)
    tilt = Vector((rr.uniform(-0.8, 0.8), rr.uniform(-0.8, 0.8), rr.uniform(-0.3, 0.3)))
    td = t0 + 0.2
    for f, t in zip(range(1, N + 1), TIMES):
        d = max(0.0, t - td)
        key_loc(ob, f, base + Vector((0, 0, -0.5 * 7.0 * d * d)))
        key_rot(ob, f, tilt * d * d * 1.5)
if "Panel_timeline" in bpy.data.objects:
    pass

# ------------------------------------------------------------------ lights: kept out of glossy rays
def area(name, loc, energy, size, color, target=(0, 0, 0)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size, ld.color = energy, size, color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    ob.visible_glossy = False
    return ob


area("Key", (-2.5, -4.0, 4.5), 900, 3.0, (1.0, 0.9, 0.82))
area("Rim", (1.5, 4.5, 2.2), 700, 3.0, (1.0, 0.62, 0.38))
area("Top", (0.0, 0.0, 6.0), 350, 4.0, (1.0, 0.92, 0.85))

# ------------------------------------------------------------------ camera
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 35
cam_data.dof.use_dof = True
cam = link(bpy.data.objects.new("Cam", cam_data))
sc.camera = cam

POP_W = Vector(T.ui_to_world(*POP_UI, 0.08))
END_TGT = Vector(T.ui_to_world(985, 360, 0.0))
END_POS = END_TGT + Vector((0.3, -3.4, 2.6))
tgt_s, tgt_v = clawd_world[0].copy(), Vector()
prev_rot = None
for f, t in zip(range(1, N + 1), TIMES):
    # follow target: a stiff spring on Clawd, so the camera whips after each hop
    goal = clawd_world[f - 1] if t >= T.T_POP else POP_W
    if t >= T.T_POP and 1 < f < N:   # feed-forward so fast moves do not leave him behind
        goal = goal + (clawd_world[f] - clawd_world[f - 2]) * (FPS / 2) * (2 / math.sqrt(420))
    for _ in range(4):
        h = 1 / FPS / 4
        acc = 420 * (goal - tgt_s) - 2 * math.sqrt(420) * tgt_v
        tgt_v += acc * h
        tgt_s += tgt_v * h
    far = 1 + 0.5 * bump(t, 3.7, 4.55, 0.25) + 0.35 * bump(t, 5.4, 6.05, 0.2) + 0.25 * bump(t, 8.4, 9.7, 0.2)
    follow_t = tgt_s + Vector((0, 0, 0.02))
    follow_p = follow_t + Vector((0.18, -1.35, 0.72)) * far
    wide_u = T.smooth(t / 1.4)
    wide_t = Vector((-0.05, -0.1, 0.0)).lerp(Vector((-0.1, 0.35, 0.0)), wide_u)
    wide_p = Vector((0.0, -6.2, 5.4)).lerp(Vector((-0.08, -5.1, 4.3)), wide_u)
    push_t, push_p = POP_W, POP_W + Vector((0.05, -1.45, 0.85))
    a = T.smooth((t - 1.25) / 0.7)
    tg, ps = wide_t.lerp(push_t, a), wide_p.lerp(push_p, a)
    b = T.smooth((t - T.T_POP - 0.05) / 0.3)
    tg, ps = tg.lerp(follow_t, b), ps.lerp(follow_p, b)
    e = T.smooth((t - 10.55) / 0.85)
    tg, ps = tg.lerp(END_TGT, e), ps.lerp(END_POS, e)
    rot = (tg - ps).to_track_quat("-Z", "Y").to_euler()
    if prev_rot is not None:
        rot.make_compatible(prev_rot)
    prev_rot = rot
    key_loc(cam, f, ps)
    key_rot(cam, f, rot)
    focus = clawd_world[f - 1] if t >= T.T_PEEL[0] else tg
    if t < T.T_PEEL[0]:
        focus = tg
    cam_data.dof.focus_distance = (focus - ps).length
    cam_data.dof.keyframe_insert("focus_distance", frame=f)
    cam_data.dof.aperture_fstop = 2.8 + 5 * (1 - b) + 5 * e
    cam_data.dof.keyframe_insert("aperture_fstop", frame=f)

os.makedirs(os.path.join(BUILD, "frames"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, "scene.blend"))
print("saved scene.blend")
