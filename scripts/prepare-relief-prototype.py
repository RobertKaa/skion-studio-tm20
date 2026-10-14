"""Prepare fixed-topology, browser-patchable native Stadium relief experiments.

Developer preparation only. The shipped browser assets need neither Python nor
Blender. Preserve every native geometry, weight, LOD and palette; embed the exact
75-joint skeleton and copy animation from the user-confirmed steel-ball V3 rig.
This particular export and experimental normal shader still need a game test.
"""
from __future__ import annotations

import argparse
from array import array
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'work/witch-hat-diagnostics/Skins_StadiumPrestige-lz4-991135232-090bb000.gbx'
NATIVE_SHA = 'fd38647ecd4eec16dd425a862a54902b1be5b2d11a7ddbbec86ff2fc5495b020'
RIG = ROOT / 'work/steel-ball-native-v3'
PARSER = ROOT / 'work/witch-hat-diagnostics/gbx-py'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def setup_parser(parser_root):
    sys.path.insert(0, str(ROOT / 'work/player-display-deps'))
    sys.path.insert(0, str(parser_root))
    # The parser also ships a pure Python minilzo implementation. Register it
    # locally when the optional native gbx.lzo extension is absent; no installs.
    try:
        import gbx.lzo
    except ImportError:
        import gbx
        spec = importlib.util.spec_from_file_location('relief_minilzo', parser_root / 'src/mini_lzo.py')
        mini = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mini)
        module = types.ModuleType('gbx.lzo')
        module.decompress = lambda data, _header, size: mini.decompress(data, size)
        module.compress = lambda data, _level, _header: mini.compress(data)
        gbx.lzo = module
        sys.modules['gbx.lzo'] = module
    from src.parser import parse_file, parse_bytes
    from src.gbx_structs import GbxStruct, NodeRef, GbxDec3N
    spec = importlib.util.spec_from_file_location('relief_native_helpers', ROOT / 'scripts/append-native-car-accessory.py')
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    return parse_file, parse_bytes, GbxStruct, NodeRef, GbxDec3N, helpers


def flat(rows, axes):
    return [float(point[axis]) for point in rows for axis in axes]


def packed_floats(values):
    return array('f', values).tobytes()


def unique_offset(raw, block):
    offset = raw.find(block)
    if offset < 0 or raw.find(block, offset + 1) >= 0:
        raise ValueError('Attribute block must occur exactly once in the prepared GBX')
    return offset


def smoothstep(lo, hi, value):
    t = max(0., min(1., (value - lo) / (hi - lo)))
    return t * t * (3. - 2. * t)


def hood_weight(position, normal, bone):
    # Native game coordinates: +Z toward the nose; the central forward upper
    # shell between cockpit and nose is Body-bound. Fade at all boundaries so
    # shared panel vertices do not tear or modify glass, guards or moving parts.
    if bone != 'Body':
        return 0.
    x, y, z = position.x, position.y, position.z
    return (1. - smoothstep(.28, .46, abs(x))) * smoothstep(.35, .43, y) * \
        smoothstep(.65, .90, z) * (1. - smoothstep(1.80, 2.10, z)) * \
        smoothstep(.35, .75, normal.y)


def uv_tangents(positions, normals, uv, indices):
    result = [[0., 0., 0.] for _ in positions]
    for at in range(0, len(indices), 3):
        a, b, c = indices[at:at + 3]
        e1 = [positions[b][axis] - positions[a][axis] for axis in 'xyz']
        e2 = [positions[c][axis] - positions[a][axis] for axis in 'xyz']
        u1, v1 = uv[b].x - uv[a].x, uv[b].y - uv[a].y
        u2, v2 = uv[c].x - uv[a].x, uv[c].y - uv[a].y
        determinant = u1 * v2 - u2 * v1
        if abs(determinant) < 1e-14:
            continue
        tangent = [(e1[axis] * v2 - e2[axis] * v1) / determinant for axis in range(3)]
        if not all(math.isfinite(value) for value in tangent):
            raise ValueError('Non-finite tangent derived from native UV')
        for index in (a, b, c):
            for axis in range(3):
                result[index][axis] += tangent[axis]
    from construct import Container
    encoded = []
    for tangent, authored_normal in zip(result, normals):
        normal = [authored_normal[a] for a in 'xyz']
        length = math.sqrt(sum(value * value for value in normal))
        normal = [value / length for value in normal] if length > 1e-12 else [0., 1., 0.]
        dot = sum(value * n for value, n in zip(tangent, normal))
        tangent = [value - dot * n for value, n in zip(tangent, normal)]
        length = math.sqrt(sum(value * value for value in tangent))
        if length < 1e-12:
            reference = [1., 0., 0.] if abs(normal[0]) < .9 else [0., 0., 1.]
            dot = sum(value * n for value, n in zip(reference, normal))
            tangent = [value - dot * n for value, n in zip(reference, normal)]
            length = math.sqrt(sum(value * value for value in tangent))
        encoded.append(Container(**{axis: value / length for axis, value in zip('xyz', tangent)}))
    return encoded


def add_normal_tangents(solid, helpers):
    # Skin normally has no tangent channel. Copy the native Details declaration
    # layout, then derive U from the original Skin UV and positions. Fixed
    # topology and all existing attributes remain identical in this variant.
    details = next(g for g in solid.shadedGeoms if solid.materialsNames[g.materialIndex] == '_DetailsDmgNormal_Details')
    details_stream, details_attrs = helpers.visual_stream(solid.visuals[details.visualIndex])
    tangent_decl = details_stream.DataDecl[details_attrs['TangentU']]
    for visual_index in sorted({g.visualIndex for g in solid.shadedGeoms if solid.materialsNames[g.materialIndex] == '_DetailsDmgNormal_Skin'}):
        stream, attrs = helpers.visual_stream(solid.visuals[visual_index])
        assert 'TangentU' not in attrs
        stride = stream.DataDecl[attrs['Position']].header.Stride
        declaration = copy.deepcopy(tangent_decl)
        declaration.header.PtrOffset = stride
        declaration.header.Stride = stride + 4
        declaration.Offset = stride
        for previous in stream.DataDecl:
            previous.header.Stride = stride + 4
        tangents = uv_tangents(stream.Data[attrs['Position']], stream.Data[attrs['Normal']],
                               stream.Data[attrs['TexCoord0']], helpers.triangle_indices(solid.visuals[visual_index]))
        stream.DataDecl.append(declaration)
        stream.Data.append(tangents)


def assert_visuals_preserved(native, checked, helpers, tangent_variant=False):
    assert len(native.visuals) == len(checked.visuals)
    for old, new in zip(native.visuals, checked.visuals):
        old_stream, old_attrs = helpers.visual_stream(old)
        new_stream, new_attrs = helpers.visual_stream(new)
        for key, value in old.body.items():
            if key != 0x0900600f:
                assert value == new.body[key], ('Native indices or other visual chunk changed', key)
        helpers.same_fields(old.body[0x0900600f], new.body[0x0900600f], ('vertexStreams',))
        helpers.same_fields(old_stream, new_stream, ('Data', 'DataDecl'))
        assert set(new_attrs) == set(old_attrs) or tangent_variant and set(new_attrs) == {*old_attrs, 'TangentU'}
        for name, index in old_attrs.items():
            assert old_stream.Data[index] == new_stream.Data[new_attrs[name]], ('Native attribute changed', name)
            old_decl, new_decl = copy.deepcopy(old_stream.DataDecl[index]), copy.deepcopy(new_stream.DataDecl[new_attrs[name]])
            if 'TangentU' not in old_attrs and 'TangentU' in new_attrs:
                old_decl.header.Stride += 4
            assert old_decl == new_decl, ('Unexpected vertex declaration change', name)


def skin_interface_points(solid, helpers):
    """Protect Skin against every unchanged material or articulated binding.

    Texture and geometry scope differ: the browser can colour every atlas, but
    only opaque Body-bound Skin positions are displaced. Pin their shared
    vertices against Details, glass, decals and the untouched moving panels.
    """
    rows = {}
    for geometry in solid.shadedGeoms:
        stream, attrs = helpers.visual_stream(solid.visuals[geometry.visualIndex])
        material = str(solid.materialsNames[geometry.materialIndex])
        points = rows.setdefault(geometry.lod, {})
        for position, indices in zip(stream.Data[attrs['Position']], stream.Data[attrs['BlendIndices']]):
            key = tuple(round(position[a] * 1_000_000) for a in 'xyz')
            bone = str(solid.bonesNames[indices[0]])
            entries = points.setdefault(key, [False, False])
            if material == '_SkinDmg_Skin' and bone == 'Body':
                entries[0] = True
            else:
                entries[1] = True
    return {lod: [axis / 1_000_000 for point, present in sorted(points.items())
                  if all(present) for axis in point] for lod, points in rows.items()}


def write_preview(solid, path, helpers):
    document = {'asset': {'version': '2.0', 'generator': 'Skion Studio relief prototype'},
                'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    binary = bytearray()
    for name in solid.materialsNames:
        document['materials'].append({'name': str(name), 'pbrMetallicRoughness': {
            'baseColorFactor': [.8, .8, .8, 1], 'metallicFactor': 0, 'roughnessFactor': .4}})

    def add(values, component, type_name, count, bounds=None):
        binary.extend(b'\0' * (-len(binary) % 4))
        raw = array('f' if component == 5126 else 'I', values).tobytes()
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
        binary.extend(raw)
        accessor = {'bufferView': view, 'componentType': component, 'count': count, 'type': type_name}
        if bounds:
            accessor['min'], accessor['max'] = bounds
        document['accessors'].append(accessor)
        return len(document['accessors']) - 1

    lookup = {}
    for geom_index, geom in enumerate(solid.shadedGeoms):
        if geom.lod != 1:
            continue
        stream, attrs = helpers.visual_stream(solid.visuals[geom.visualIndex])
        positions, normals, uv = [stream.Data[attrs[name]] for name in ('Position', 'Normal', 'TexCoord0')]
        bounds = ([min(p[a] for p in positions) for a in 'xyz'], [max(p[a] for p in positions) for a in 'xyz'])
        p = add(flat(positions, 'xyz'), 5126, 'VEC3', len(positions), bounds)
        n = add(flat(normals, 'xyz'), 5126, 'VEC3', len(normals))
        t = add(flat(uv, 'xy'), 5126, 'VEC2', len(uv))
        attributes = {'POSITION': p, 'NORMAL': n, 'TEXCOORD_0': t}
        if 'TexCoord1' in attrs:
            attributes['TEXCOORD_1'] = add(flat(stream.Data[attrs['TexCoord1']], 'xy'), 5126, 'VEC2', len(positions))
        indices = helpers.triangle_indices(solid.visuals[geom.visualIndex])
        i = add(indices, 5125, 'SCALAR', len(indices))
        material = str(solid.materialsNames[geom.materialIndex])
        name = f'relief-native-{geom.visualIndex}-{material}'
        mesh = len(document['meshes'])
        document['meshes'].append({'name': name, 'primitives': [
            {'attributes': attributes, 'indices': i, 'material': geom.materialIndex}]})
        document['scenes'][0]['nodes'].append(len(document['nodes']))
        document['nodes'].append({'mesh': mesh, 'name': name, 'extras': {'nativeVisualIndex': geom.visualIndex}})
        lookup[geom.visualIndex] = {'positionAccessor': p, 'normalAccessor': n, 'previewMeshName': name}
    binary.extend(b'\0' * (-len(binary) % 4))
    document['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    raw = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(binary))
    raw += struct.pack('<I4s', len(encoded), b'JSON') + encoded
    raw += struct.pack('<I4s', len(binary), b'BIN\0') + binary
    path.write_bytes(raw)
    return lookup


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--output-dir', type=Path, default=ROOT / 'public/models/relief')
    cli.add_argument('--parser-root', type=Path, default=PARSER)
    args = cli.parse_args()
    if sys.byteorder != 'little':
        raise ValueError('Little endian host required')
    parse_file, parse_bytes, GbxStruct, NodeRef, GbxDec3N, helpers = setup_parser(args.parser_root)
    source_raw = NATIVE.read_bytes()
    assert sha(source_raw) == NATIVE_SHA, 'Native source differs from the audited car'
    base = parse_file(str(NATIVE))
    external = parse_file(str(RIG / 'MainBody.Skel.Gbx'))
    assert not base._errors and not external._errors
    native = base.body[0x090bb000]
    assert native.version == 34 and len(native.bonesNames) == 58
    assert list(native.u17) == [58, 56, 50, 8, 1]
    assert len(external.body[0x090ba000].joints) == 75
    skeleton_raw = (RIG / 'MainBody.Skel.Gbx').read_bytes()
    animation_raw = (RIG / 'MainBody.Anim.Gbx').read_bytes()
    assert sha(skeleton_raw) == '92b0651bf8c648d834f1a016be84f8e1d15efe8645480f7fe73bda13f88f3fc3'
    assert sha(animation_raw) == '63044600a5dba4993c5436ba8f15b29aa39c9b3cec196594c22655268de57627'
    prepared = copy.deepcopy(base)
    solid = prepared.body[0x090bb000]
    solid.skel = NodeRef(classId=external.classId, body=copy.deepcopy(external.body))
    # Explicitly uncompressed: only declared float and normal byte spans are
    # writable in the browser. Unknown chunks and all rig data remain intact.
    prepared.bodyCompression = 'uncompressed'
    prepared.referenceTable.numExternalNodes = 0
    prepared.referenceTable.externalFolders = None
    prepared.referenceTable.externalNodes = []
    output = args.output_dir.resolve()
    if output == NATIVE.parent.resolve() or output == RIG.resolve():
        raise ValueError('Do not overwrite input directories')
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 1, 'interfaceProtectionVersion': 1,
        'coordinateSystem': 'Game X lateral, Y up, Z forward; GLB identical',
        'sourceSha256': NATIVE_SHA, 'gameValidation': 'pending',
        'rigReference': 'User-confirmed steel-ball-native-v3 (2026-10-04), exact 75-joint skeleton and animation',
        'variants': {}, 'preview': {}, 'dependencies': [], 'geometries': [],
        'hood': {'label': 'Capot avant', 'bounds': [[-.46, .35, .65], [.46, .9, 2.10]],
                 'maxDisplacementMm': 8, 'method': 'Existing native Body-bound vertices; no topology change'}}
    preview_lookup = write_preview(solid, output / 'preview.glb', helpers)
    preview_raw = (output / 'preview.glb').read_bytes()
    manifest['preview'] = {'url': 'preview.glb', 'sha256': sha(preview_raw), 'byteLength': len(preview_raw)}
    boundaries = skin_interface_points(solid, helpers)
    for visual_index in sorted({g.visualIndex for g in solid.shadedGeoms if solid.materialsNames[g.materialIndex] == '_SkinDmg_Skin'}):
        stream, attrs = helpers.visual_stream(solid.visuals[visual_index])
        assert str(stream.DataDecl[attrs['Position']].header.Type) == 'Float3'
        assert str(stream.DataDecl[attrs['Normal']].header.Type) == 'Dec3N'
        positions, normals, uv, bones = [stream.Data[attrs[name]] for name in ('Position', 'Normal', 'TexCoord0', 'BlendIndices')]
        hood = [hood_weight(p, n, str(solid.bonesNames[b[0]])) for p, n, b in zip(positions, normals, bones)]
        assert any(weight > 0 for weight in hood), ('No hood vertices in LOD', visual_index)
        entry = {'visualIndex': visual_index, 'lods': [g.lod for g in solid.shadedGeoms if g.visualIndex == visual_index],
            'vertexCount': len(positions), 'positions': flat(positions, 'xyz'), 'normals': flat(normals, 'xyz'),
            'uv': flat(uv, 'xy'), 'indices': helpers.triangle_indices(solid.visuals[visual_index]),
            'hoodWeights': hood, 'bodyVertices': [str(solid.bonesNames[b[0]]) == 'Body' for b in bones],
            'boundaryPoints': boundaries[next(g.lod for g in solid.shadedGeoms if g.visualIndex == visual_index)],
            'positionStride': 12, 'normalStride': 4, 'normalEncoding': 'dec3n', 'offsets': {}}
        if 'TangentU' in attrs:
            assert str(stream.DataDecl[attrs['TangentU']].header.Type) == 'Dec3N'
            entry['tangents'] = flat(stream.Data[attrs['TangentU']], 'xyz')
            entry['tangentStride'] = 4
            entry['tangentEncoding'] = 'dec3n'
        if visual_index in preview_lookup:
            entry.update(preview_lookup[visual_index])
        manifest['geometries'].append(entry)
    for variant in ('standard', 'normal'):
        data = copy.deepcopy(prepared)
        checked_solid = data.body[0x090bb000]
        if variant == 'normal':
            checked_solid.materialsNames[checked_solid.materialsNames.index('_SkinDmg_Skin')] = '_DetailsDmgNormal_Skin'
            add_normal_tangents(checked_solid, helpers)
        raw = GbxStruct.build(data, gbx_data={}, nodes=data.get('nodes'), reindex_nodes=True)
        restored = parse_bytes(raw)
        assert not restored._errors
        checked = restored.body[0x090bb000]
        helpers.same_fields(native, checked, ('skel', 'materialsNames', 'visuals'))
        assert checked.skel.body == external.body
        assert_visuals_preserved(native, checked, helpers, tangent_variant=variant == 'normal')
        assert checked.shadedGeoms == native.shadedGeoms
        assert checked.bonesNames == native.bonesNames
        assert checked.u17 == native.u17
        for chunk, value in base.body.items():
            if chunk != 0x090bb000:
                assert restored.body[chunk] == value, ('Other native mesh chunk changed', chunk)
        for entry in manifest['geometries']:
            stream, attrs = helpers.visual_stream(checked.visuals[entry['visualIndex']])
            positions = packed_floats(entry['positions'])
            normals = b''.join(GbxDec3N.build(n) for n in stream.Data[attrs['Normal']])
            entry['offsets'][variant] = {'positionOffset': unique_offset(raw, positions), 'normalOffset': unique_offset(raw, normals)}
            if 'TangentU' in attrs:
                entry['tangents'] = flat(stream.Data[attrs['TangentU']], 'xyz')
                entry['tangentStride'] = 4
                entry['tangentEncoding'] = 'dec3n'
                tangents = b''.join(GbxDec3N.build(t) for t in stream.Data[attrs['TangentU']])
                entry['offsets'][variant]['tangentOffset'] = unique_offset(raw, tangents)
        filename = f'{variant}.Mesh.gbx'
        (output / filename).write_bytes(raw)
        manifest['variants'][variant] = {'url': filename, 'sha256': sha(raw), 'byteLength': len(raw),
            'material': '_SkinDmg_Skin' if variant == 'standard' else '_DetailsDmgNormal_Skin'}
    for name, raw in [('MainBody.Skel.Gbx', skeleton_raw), ('MainBody.Anim.Gbx', animation_raw)]:
        (output / name).write_bytes(raw)
        manifest['dependencies'].append({'url': name, 'name': name, 'sha256': sha(raw), 'byteLength': len(raw)})
    (output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'status': 'PASS structural preservation', 'gameValidation': 'pending',
        'assets': {p.name: p.stat().st_size for p in output.iterdir() if p.is_file()},
        'hoodVertices': {str(g['visualIndex']): sum(w > 0 for w in g['hoodWeights']) for g in manifest['geometries']}}))


if __name__ == '__main__':
    main()
