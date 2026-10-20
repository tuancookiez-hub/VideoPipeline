"""Pass with -P on every render: the compute device is a user preference, not part of the .blend."""
import bpy

prefs = bpy.context.preferences.addons["cycles"].preferences
scene = bpy.context.scene
for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
    try:
        prefs.compute_device_type = backend
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if gpus:
            for d in prefs.devices:
                d.use = d.type != "CPU"
            scene.cycles.device = "GPU"
            print("render device:", backend, [d.name for d in gpus])
            break
    except TypeError:
        continue
else:
    scene.cycles.device = "CPU"
    print("render device: CPU")
