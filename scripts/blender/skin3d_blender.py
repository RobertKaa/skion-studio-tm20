"""Prépare le blend Stadium Car et exporte FBX + GLB pour un skin 3D TM2020.

Usage (Blender en arrière-plan) :

  blender --background --python scripts/blender/skin3d_blender.py -- prepare
  blender --background --python scripts/blender/skin3d_blender.py -- export <blend> <dossier>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
FBX_SOURCE = ROOT / "public" / "models" / "car" / "StadiumCAR2020_OffsetFix.fbx"
TEMPLATE_BLEND = ROOT / "templates" / "stadium-skin.blend"

MATS = {
    "s": "SkinDmg_Skin",
    "d": "DetailsDmgNormal_Details",
    "w": "DetailsDmgNormal_Wheels",
    "g": "GlassDmgCrack_Glass",
}

# Hiérarchie d'os attendue par un skin voiture TM2020 (corps + roues + échappements).
CAR_SKEL = [
    "Body",
    [
        "FLHub",
        ["FLGuard", "FLWheel"],
        "FLReactor",
        "FLArmBot",
        "FLArmTop",
        "FLSusp",
    ],
    [
        "FRHub",
        ["FRGuard", "FRWheel"],
        "FRReactor",
        "FRArmBot",
        "FRArmTop",
        "FRSusp",
    ],
    [
        "RLHub",
        ["RLGuard", ["RLCardan", "RLWheel"]],
        "RLReactor",
        "RLSusp",
        "RLCardan",
        "RLArmBot",
        "RLArmTop",
    ],
    [
        "RRHub",
        ["RRGuard", ["RRCardan", "RRWheel"]],
        "RRReactor",
        "RRSusp",
        "RRCardanB",
        "RRArmBot",
        "RRArmTop",
    ],
]
SOCKETS = ["Exhaust1", "Exhaust2", "LightFProj"]
WHEEL_BONES = ("FLWheel", "FRWheel", "RLWheel", "RRWheel")


def argv_after_dd() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def slot_of(obj: bpy.types.Object) -> str:
    mat = obj.active_material.name if obj.active_material else ""
    blob = f"{obj.name} {mat}".lower()
    if "wheel" in blob or "jante" in blob or "tyre" in blob or "tire" in blob:
        return "w"
    if "glass" in blob or "vitre" in blob or "windshield" in blob:
        return "g"
    if "detail" in blob:
        return "d"
    return "s"


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path: Path) -> None:
    bpy.ops.import_scene.fbx(filepath=str(path))


def mesh_objects() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def ensure_material(name: str) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


def assign_material(obj: bpy.types.Object, name: str) -> None:
    mat = ensure_material(name)
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def rename_uv(obj: bpy.types.Object) -> None:
    layers = obj.data.uv_layers
    if not layers:
        print(f"[skin3d] pas d'UV sur {obj.name}")
        return
    layers[0].name = "BaseMaterial"


def add_bones(arm: bpy.types.Armature, bones: list, parent=None) -> None:
    items = iter(bones)
    name = next(items)
    bone = arm.edit_bones.new(name)
    bone.head = Vector((0.0, 0.0, 0.0))
    bone.tail = Vector((0.0, 0.15, 0.0))
    bone.parent = parent
    for child in items:
        if isinstance(child, list):
            add_bones(arm, child, bone)
        else:
            sub = arm.edit_bones.new(child)
            sub.head = Vector((0.0, 0.0, 0.0))
            sub.tail = Vector((0.0, 0.15, 0.0))
            sub.parent = bone


def build_armature() -> bpy.types.Object:
    arm = bpy.data.armatures.new("Hips")
    arm_obj = bpy.data.objects.new("Hips", arm)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    add_bones(arm, CAR_SKEL)
    for sock in SOCKETS:
        bone = arm.edit_bones.new(sock)
        bone.head = Vector((0.0, 0.0, 0.0))
        bone.tail = Vector((0.0, 0.1, 0.0))
        bone.parent = arm.edit_bones["Body"]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def place_wheel_bones(arm_obj: bpy.types.Object, wheels: list[bpy.types.Object]) -> None:
    if not wheels:
        return
    centers = [(obj, obj.matrix_world.translation.copy()) for obj in wheels]
    spreads = []
    for axis in range(3):
        vals = [c[axis] for _, c in centers]
        spreads.append(max(vals) - min(vals))
    up = spreads.index(min(spreads))
    horiz = [i for i in range(3) if i != up]
    lat, lon = horiz
    mid_lat = sorted(c[lat] for _, c in centers)[len(centers) // 2]
    mid_lon = sorted(c[lon] for _, c in centers)[len(centers) // 2]

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    bones = arm_obj.data.edit_bones
    for obj, center in centers:
        left = center[lat] >= mid_lat
        front = center[lon] >= mid_lon
        key = ("F" if front else "R") + ("L" if left else "R")
        bone = bones.get(key + "Wheel")
        if bone is None:
            continue
        head = arm_obj.matrix_world.inverted() @ center
        bone.head = head
        bone.tail = head + Vector((0.0, 0.15, 0.0))
    bpy.ops.object.mode_set(mode="OBJECT")


def bind(obj: bpy.types.Object, arm_obj: bpy.types.Object, bone_name: str) -> None:
    # Parent objet + modificateur Armature : le FBX de Blender n'écrit pas
    # le parentage de type ARMATURE, seulement le modificateur (skinning).
    obj.parent = arm_obj
    obj.parent_type = "OBJECT"
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    group = obj.vertex_groups.new(name=bone_name)
    count = len(obj.data.vertices)
    if count:
        group.add(list(range(count)), 1.0, "REPLACE")


def classify_and_bind(arm_obj: bpy.types.Object) -> None:
    meshes = mesh_objects()
    wheels = [o for o in meshes if slot_of(o) == "w"]
    place_wheel_bones(arm_obj, wheels)
    counts = {"s": 0, "d": 0, "w": 0, "g": 0}
    wheel_i = 0
    for obj in meshes:
        kind = slot_of(obj)
        counts[kind] += 1
        suffix = "" if counts[kind] == 1 else str(counts[kind])
        if kind == "w" and wheels:
            # Nom d'os : réparti plus haut ; le mesh reste générique si un seul bloc.
            wheel_i += 1
            obj.name = f"wWheel{suffix}_Lod1"
            bone = "Body"
        elif kind == "d":
            obj.name = f"dDetails{suffix}_Lod1"
            bone = "Body"
        elif kind == "g":
            obj.name = f"gGlass{suffix}_Lod1"
            bone = "Body"
        else:
            obj.name = f"sBody{suffix}_Lod1"
            bone = "Body"
        assign_material(obj, MATS[kind])
        rename_uv(obj)
        bind(obj, arm_obj, bone)


def bake_import_transform() -> None:
    """Pose les sommets en mètres, Z vers le haut, nez vers +Y.

    L'importeur FBX laisse l'échelle 0.01 et la rotation 90° sur un empty
    parent. Reparenter sans les appliquer écrit une voiture en centimètres,
    couchée sur Y : dans le jeu elle est verticale et environ 100× trop grande.
    """
    meshes = mesh_objects()
    if not meshes:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def prepare() -> None:
    if not FBX_SOURCE.is_file():
        raise SystemExit(f"FBX introuvable : {FBX_SOURCE}")
    reset_scene()
    import_fbx(FBX_SOURCE)
    bake_import_transform()
    drop_helpers()
    arm = build_armature()
    classify_and_bind(arm)
    TEMPLATE_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(TEMPLATE_BLEND))
    print(f"[skin3d] blend écrit : {TEMPLATE_BLEND}")
    export_open_scene(ROOT / "work" / "stadium-base")


def material_names() -> list[str]:
    names = []
    for mat in bpy.data.materials:
        if mat.users and mat.name != "Dots Stroke":
            names.append(mat.name)
    return names


def drop_helpers() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type not in {"MESH", "ARMATURE"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def ensure_export_skinning() -> None:
    """Garantit un modificateur Armature + poids pour NadeoImporter (mémoire seule)."""
    hips = bpy.data.objects.get("Hips")
    if hips is None or hips.type != "ARMATURE":
        return
    for obj in mesh_objects():
        obj.parent = hips
        obj.parent_type = "OBJECT"
        am = next((m for m in obj.modifiers if m.type == "ARMATURE"), None)
        if am is None:
            am = obj.modifiers.new("Armature", "ARMATURE")
        am.object = hips
        if obj.name.startswith("w"):
            continue
        if "Body" not in obj.vertex_groups:
            obj.vertex_groups.new(name="Body")
        n = len(obj.data.vertices)
        if n:
            obj.vertex_groups["Body"].add(list(range(n)), 1.0, "REPLACE")


def flip_uv_v_for_app_preview() -> None:
    """Retourne v (1-v) pour aligner le GLB sur l'atlas de l'app (row 0 = v=1).

    À appeler APRÈS l'export FBX : Nadeo garde les UV Blender d'origine.
    """
    for obj in mesh_objects():
        for uv_layer in obj.data.uv_layers:
            for loop in uv_layer.data:
                u, v = loop.uv
                loop.uv = (u, 1.0 - v)


def export_open_scene(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    drop_helpers()
    for obj in mesh_objects():
        rename_uv(obj)
    ensure_export_skinning()
    fbx = out_dir / "MainBody.fbx"
    glb = out_dir / "preview.glb"
    bpy.ops.export_scene.fbx(
        filepath=str(fbx),
        use_selection=False,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="AUTO",
        object_types={"MESH", "ARMATURE"},
        apply_unit_scale=True,
        axis_forward="-Z",
        axis_up="Y",
        global_scale=1.0,
    )
    # UV v retournés uniquement pour le preview.glb (peinture app). Le .blend
    # n'est pas sauvegardé : le fichier sur disque reste inchangé.
    flip_uv_v_for_app_preview()
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        export_apply=False,
        export_animations=False,
        export_skins=True,
        use_selection=False,
    )
    mats = material_names()
    (out_dir / "materials.json").write_text(json.dumps(mats, indent=2), encoding="utf-8")
    print(f"[skin3d] export : {fbx}")
    print(f"[skin3d] export : {glb} (UV v retournés pour l'app)")
    print(f"[skin3d] matériaux : {', '.join(mats)}")


def export_blend(blend: Path, out_dir: Path) -> None:
    if not blend.is_file():
        raise SystemExit(f"Blend introuvable : {blend}")
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    export_open_scene(out_dir)


def main() -> None:
    args = argv_after_dd()
    cmd = args[0] if args else "prepare"
    if cmd == "prepare":
        prepare()
        return
    if cmd == "export":
        if len(args) < 3:
            raise SystemExit("usage: export <blend> <dossier>")
        export_blend(Path(args[1]), Path(args[2]))
        return
    raise SystemExit(f"commande inconnue : {cmd}")


if __name__ == "__main__":
    main()
