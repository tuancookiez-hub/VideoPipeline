"""Clawd as one smooth toy: body 12x8x6 units, side nubs, four legs, eye slits, ^^ eyes.

Hierarchy: root (feet, yaw) -> flip (body centre, pitch) -> squash (feet, scale) -> meshes.
Scale the whole toy with root.scale.
"""
import math
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Vector

U = 0.02  # one body unit in metres
CENTER_Z = 2 * U + 4 * U


def material(name, color, rough, spec):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Specular IOR Level"].default_value = spec
    return m


def rbox(name, size, loc, mat, bevel, parent, collection):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    ob.location = loc
    ob.parent = parent
    if bevel:
        b = ob.modifiers.new("Bevel", "BEVEL")
        b.width, b.segments = bevel, 5
        b.harden_normals = False
        for p in me.polygons:
            p.use_smooth = True
    return ob


def build(collection):
    body_mat = material("ClawdBody", (0.52, 0.13, 0.07), 0.42, 0.45)
    eye_mat = material("ClawdEye", (0.005, 0.005, 0.005), 0.25, 0.5)

    def empty(name, parent, loc):
        ob = bpy.data.objects.new(name, None)
        collection.objects.link(ob)
        ob.parent = parent
        ob.location = loc
        return ob

    root = empty("ClawdRoot", None, (0, 0, 0))
    flip = empty("ClawdFlip", root, (0, 0, CENTER_Z))
    squash = empty("ClawdSquash", flip, (0, 0, -CENTER_Z))
    body = rbox("ClawdBodyMesh", (12 * U, 6 * U, 8 * U), (0, 0, CENTER_Z), body_mat, 0.022, squash, collection)
    legs = [rbox(f"ClawdLeg{i}", (1.5 * U, 2.2 * U, 2.6 * U), (lx * U, 0, 1.3 * U), body_mat, 0.006, squash, collection)
            for i, lx in enumerate([-4.25, -1.75, 1.75, 4.25])]
    nub_l = rbox("ClawdNubL", (2.4 * U, 2.4 * U, 2.0 * U), (-7.0 * U, 0, CENTER_Z), body_mat, 0.008, squash, collection)
    nub_pivot = empty("ClawdNubPivot", squash, (6 * U, 0, CENTER_Z))
    nub_r = rbox("ClawdNubR", (2.4 * U, 2.4 * U, 2.0 * U), (1.0 * U, 0, 0), body_mat, 0.008, nub_pivot, collection)
    eyes = [rbox(f"ClawdEye{i}", (1.1 * U, 0.6 * U, 2.4 * U), (sx * 2.45 * U, -3.0 * U, CENTER_Z + 0.8 * U),
                 eye_mat, 0.003, squash, collection)
            for i, sx in enumerate((-1, 1))]
    happy = []
    for i, sx in enumerate((-1, 1)):        # ^^ eyes for the wave
        for j, a in enumerate((1, -1)):
            e = rbox(f"ClawdHappy{i}{j}", (1.5 * U, 0.6 * U, 0.55 * U),
                     (sx * 2.45 * U + a * -0.55 * U, -3.0 * U, CENTER_Z + 1.0 * U), eye_mat, 0.002, squash, collection)
            e.rotation_euler = (0, a * math.radians(-40), 0)
            happy.append(e)
    return SimpleNamespace(root=root, flip=flip, squash=squash, body=body, legs=legs, nub_l=nub_l,
                           nub_pivot=nub_pivot, nub_r=nub_r, eyes=eyes, happy=happy)
