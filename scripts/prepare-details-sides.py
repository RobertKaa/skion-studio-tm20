"""Prepare bounded native patches for genuinely independent Details sides.

Developer-only preparation: the browser needs no Blender, Python or GBX parser.
Only the native Details visuals change. All five LODs, bindings, materials,
secondary decal UVs, other visuals, skeleton and animation are retained.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
from array import array
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/models/details-sides'
WORK = ROOT / 'work/underbody'
EPS = 1e-7


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def normalize(vector):
    length = math.sqrt(sum(x*x for x in vector))
    if length < 1e-12:
        raise ValueError('Degenerate native direction')
    return [x/length for x in vector]


def split_visual(visual, helpers, Container, provenance=None):
    stream, attrs = helpers.visual_stream(visual)
    if set(attrs) - {'Position', 'Normal', 'BlendIndices', 'TexCoord0', 'TexCoord1', 'TangentU'}:
        raise ValueError('Unexpected native attribute')
    original = [list(rows) for rows in stream.Data]
    positions = original[attrs['Position']]
    bones = original[attrs['BlendIndices']]
    indices = helpers.triangle_indices(visual)
    result = [list(rows) for rows in original]
    assignments = {}
    allocated = {}
    intersections = {}
    output = []
    clipped = 0

    def vertex(index, side):
        key = (index, side)
        if key in assignments:
            return assignments[key]
        if index not in allocated:
            target = index
            allocated[index] = side
        else:
            target = len(result[attrs['Position']])
            if provenance is not None:provenance.append((index,index,0.))
            for a in range(len(result)):
                row=original[a][index]
                result[a].append(Container((k,row[k])for k in 'xyzw'if k in row)if isinstance(row,dict)else list(row))
        uv = original[attrs['TexCoord0']][index]
        result[attrs['TexCoord0']][target] = Container(x=uv.x*.5+(.5 if side else 0), y=uv.y)
        assignments[key] = target
        return target

    def intersection(a, b, side):
        if abs(positions[a].x) <= EPS:
            return vertex(a, side)
        if abs(positions[b].x) <= EPS:
            return vertex(b, side)
        if a > b:
            a, b = b, a
        key = (a, b, side)
        if key in intersections:
            return intersections[key]
        # SkinIndexCount is one: remaining UByte4 padding is authored garbage
        # on some native vertices and is not an additional active influence.
        if bones[a][0] != bones[b][0]:
            raise ValueError('Clipping cannot change an animated binding')
        t = -positions[a].x/(positions[b].x-positions[a].x)
        target = len(result[attrs['Position']])
        if provenance is not None:provenance.append((a,b,t))
        for name, attribute in attrs.items():
            if name == 'BlendIndices':
                value = copy.deepcopy(bones[a])
            else:
                axes = 'xy' if name.startswith('TexCoord') else 'xyz'
                values = [original[attribute][a][axis]*(1-t)+original[attribute][b][axis]*t for axis in axes]
                if name == 'Position':
                    values[0] = 0.
                elif name in ('Normal', 'TangentU'):
                    values = normalize(values)
                elif name == 'TexCoord0':
                    values[0] = values[0]*.5+(.5 if side else 0)
                value = Container(zip(axes, values))
            result[attribute].append(value)
        intersections[key] = target
        return target

    for at in range(0, len(indices), 3):
        face = indices[at:at+3]
        xs = [positions[i].x for i in face]
        if min(xs) < -EPS and max(xs) > EPS:
            clipped += 1
            for side in (False, True):
                polygon = []
                for c, b in enumerate(face):
                    a = face[(c-1) % 3]
                    before = positions[a].x >= -EPS if side else positions[a].x <= EPS
                    after = positions[b].x >= -EPS if side else positions[b].x <= EPS
                    if before != after:
                        polygon.append(intersection(a, b, side))
                    if after:
                        polygon.append(vertex(b, side))
                # Remove duplicates where the original triangle touched X=0.
                polygon = [p for i, p in enumerate(polygon) if p != polygon[i-1]]
                for c in range(1, len(polygon)-1):
                    output.extend([polygon[0], polygon[c], polygon[c+1]])
        else:
            side = sum(xs) >= 0
            output.extend(vertex(i, side) for i in face)
    if len(result[attrs['Position']]) >= 65536:
        raise ValueError('Native 16-bit vertex budget exceeded')
    stream.Data = result
    stream.numVertices = visual.body[0x0900600f].VertexCount = len(result[attrs['Position']])
    previous = 0
    deltas = []
    for i in output:
        deltas.append((i-previous+32768) % 65536-32768)
        previous = i
    visual.body[0x0906a001].indexBuffer[0x09057001].indices = deltas
    # Every rendered face lies in one physical side and its matching UV half.
    for at in range(0, len(output), 3):
        face = output[at:at+3]
        x = [result[attrs['Position']][i].x for i in face]
        u = [result[attrs['TexCoord0']][i].x for i in face]
        assert not (min(x) < -EPS and max(x) > EPS)
        assert max(u) <= .500001 or min(u) >= .499999
        if min(x) < -EPS:
            assert max(u) <= .500001
        if max(x) > EPS:
            assert min(u) >= .499999
    return {'vertices': stream.numVertices, 'triangles': len(output)//3, 'clippedTriangles': clipped}


def details_preview(solid, helpers, path):
    document = {'asset': {'version': '2.0', 'generator': 'Skion Studio independent Details v1'},
                'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                'materials': [{'name': str(n)} for n in solid.materialsNames],
                'accessors': [], 'bufferViews': [], 'buffers': []}
    binary = bytearray()

    def accessor(values, axes, component=5126):
        binary.extend(b'\0'*(-len(binary) % 4))
        raw = array('f' if component == 5126 else 'I', values).tobytes()
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
        binary.extend(raw)
        count = len(values)//axes
        entry = {'bufferView': view, 'componentType': component, 'count': count,
                 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[axes]}
        if axes == 3:
            entry['min'] = [min(values[a::3]) for a in range(3)]
            entry['max'] = [max(values[a::3]) for a in range(3)]
        document['accessors'].append(entry)
        return len(document['accessors'])-1

    for geom in solid.shadedGeoms:
        if geom.lod != 1 or not str(solid.materialsNames[geom.materialIndex]).endswith('_Details'):
            continue
        stream, attrs = helpers.visual_stream(solid.visuals[geom.visualIndex])
        attributes = {}
        for native, gltf, axes in [('Position', 'POSITION', 'xyz'), ('Normal', 'NORMAL', 'xyz'),
                                   ('TexCoord0', 'TEXCOORD_0', 'xy'), ('TexCoord1', 'TEXCOORD_1', 'xy')]:
            if native in attrs:
                attributes[gltf] = accessor([p[a] for p in stream.Data[attrs[native]] for a in axes], len(axes))
        indices = accessor(helpers.triangle_indices(solid.visuals[geom.visualIndex]), 1, 5125)
        document['scenes'][0]['nodes'].append(len(document['nodes']))
        document['nodes'].append({'mesh': len(document['meshes']), 'extras': {'nativeVisualIndex': geom.visualIndex}})
        document['meshes'].append({'primitives': [{'attributes': attributes, 'indices': indices, 'material': geom.materialIndex}]})
    document['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' '*(-len(encoded) % 4)
    raw = struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(binary))
    raw += struct.pack('<I4s', len(encoded), b'JSON')+encoded
    raw += struct.pack('<I4s', len(binary), b'BIN\0')+binary
    path.write_bytes(raw)


def main(splitter=split_visual, layout='independent-v1'):
    prepare = module('prepare_details_native', ROOT/'scripts/prepare-relief-prototype.py')
    parse_file, parse_bytes, GbxStruct, _, _, helpers = prepare.setup_parser(prepare.PARSER)
    from construct import Container
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    packed = bytearray()
    blocks = {}
    manifest = {'version': 1, 'layout': layout, 'sources': [], 'gameValidation': 'pending'}
    for dense in (False, True):
        for variant in ('standard', 'normal'):
            path = ROOT/'public/models/relief'/('dense' if dense else '')/(variant+'.Mesh.gbx')
            original = path.read_bytes()
            source = parse_bytes(original)
            assert not source._errors
            assert GbxStruct.build(source, gbx_data={}, nodes=source.get('nodes'), reindex_nodes=True) == original
            changed = copy.deepcopy(source)
            solid = changed.body[0x090bb000]
            visuals = sorted({g.visualIndex for g in solid.shadedGeoms if str(solid.materialsNames[g.materialIndex]).endswith('_Details')})
            reports = {i: splitter(solid.visuals[i], helpers, Container) for i in visuals}
            raw = GbxStruct.build(changed, gbx_data={}, nodes=changed.get('nodes'), reindex_nodes=True)
            restored = parse_bytes(raw)
            assert not restored._errors
            after = restored.body[0x090bb000]
            helpers.same_fields(source.body[0x090bb000], after, ('visuals',))
            patches = []
            reproduced = bytearray()
            cursor = 0
            for i in visuals:
                start, end = source.body[0x090bb000].visuals[i]._iopos
                new_start, new_end = after.visuals[i]._iopos
                replacement = raw[new_start:new_end]
                key = digest(replacement)
                if key not in blocks:
                    blocks[key] = len(packed)
                    packed.extend(replacement)
                patches.append({'offset': start, 'length': end-start, 'sha256': digest(original[start:end]),
                                'dataOffset': blocks[key], 'dataLength': len(replacement), 'dataSha256': key})
                reproduced.extend(original[cursor:start])
                reproduced.extend(replacement)
                cursor = end
            reproduced.extend(original[cursor:])
            assert reproduced == raw, 'The patch must only replace native Details nodes; no other bytes may change'
            for i, visual in enumerate(source.body[0x090bb000].visuals):
                if i not in visuals:
                    assert visual.body == after.visuals[i].body
            name = ('dense-' if dense else '')+variant
            manifest['sources'].append({'id': name, 'byteLength': len(original), 'sha256': digest(original),
                                        'resultByteLength': len(raw), 'resultSha256': digest(raw), 'patches': patches})
            if not dense and variant == 'standard':
                details_preview(after, helpers, OUTPUT/'details.glb')
            (WORK/(name+'-independent.Mesh.gbx')).write_bytes(raw)
            print(name, json.dumps(reports), flush=True)
    (OUTPUT/'patches.bin').write_bytes(packed)
    manifest['patchAsset'] = {'file': 'patches.bin', 'byteLength': len(packed), 'sha256': digest(packed)}
    preview = (OUTPUT/'details.glb').read_bytes()
    manifest['previewAsset'] = {'file': 'details.glb', 'byteLength': len(preview), 'sha256': digest(preview)}
    (OUTPUT/'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    print('PASS native side separation, five LODs, other geometry/rig/materials byte-identical', len(packed), flush=True)


if __name__ == '__main__':
    main()
