"""Prepare dense, independently budgeted native tyre surfaces offline.

Only the authenticated bundled full template and code-owned tread patterns are
read. Four rigid LOD0 wheels receive their own 16-bit visual. A constrained 2D
mould mesh follows both profiles' outer and 2 mm inset contours, with separate
normal indices for crown, bevel and groove floor. Other visuals, lower LODs and
rig data remain unchanged. No third-party runtime is shipped to the browser.

Offline developer dependencies (Python 3.13, official PyPI wheels):
python -m pip install --target audit-evidence/tyre-tools shapely==2.2.0 triangle==20250106 numpy==2.5.4
The generated mesh, rather than those tools, is the distributable app asset.
"""
from __future__ import annotations

import argparse
import base64
import copy
import importlib.util
import json
import math
import os
import struct
import subprocess
import sys
from array import array
from pathlib import Path

from dense_heightfield_core import f32, normalized, refine

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/models/relief/full'
OUTPUT = ROOT / 'public/models/relief/tyres'
U_MIN, U_MAX = .200728, .811564
ACROSS_METRES = .283 / (U_MAX - U_MIN)
CIRCUMFERENCE_METRES = 2.289
EDGE_METRES = .004
MAX_MANIFEST_BYTES = 48 * 1024 * 1024
WHEEL_VISUAL = 3
MOULD_BEVEL_METRES = .002
MOULD_EDGE_METRES = .008
MOULD_BULK_METRES = .010


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load_module('prepare_wheel_native', ROOT / 'scripts/prepare-relief-prototype.py')


def packed(values, code):
    return base64.b64encode(array(code, values).tobytes()).decode('ascii')


def unpacked(value, code):
    if not isinstance(value, str):
        return list(value)
    result = array(code)
    result.frombytes(base64.b64decode(value, validate=True))
    return result.tolist()


def align_preview(path, entries):
    """Keep the exact manifest reference in GLB, including old source normals.

    The source full manifest contains pre-DEC3N normals. Native GBX bytes remain
    unchanged, while the strict preview guard requires its float reference.
    """
    raw = bytearray(path.read_bytes())
    json_length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    binary = 28 + json_length
    for entry in entries:
        for field, key in (('positions', 'positionAccessor'), ('normals', 'normalAccessor')):
            if key not in entry:
                continue
            accessor = document['accessors'][entry[key]]
            view = document['bufferViews'][accessor['bufferView']]
            block = base64.b64decode(entry[field], validate=True)
            assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
            assert len(block) == accessor['count'] * 12 and view.get('byteStride', 12) == 12
            offset = binary + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            assert offset + len(block) <= len(raw)
            raw[offset:offset + len(block)] = block
    path.write_bytes(raw)


def xyz(point):
    return tuple(point[axis] for axis in 'xyz')


def set_indices(visual, indices):
    previous, deltas = 0, []
    for index in indices:
        assert 0 <= index <= 65535
        deltas.append((index - previous + 32768) % 65536 - 32768)
        previous = index
    visual.body[0x0906a001].indexBuffer[0x09057001].indices = deltas


def wheel_profile(positions, uv):
    """Recover the upper native radial envelope, ignoring chord subdivisions."""
    tread = [i for i, point in enumerate(uv) if U_MIN - 1e-6 <= point[0] <= U_MAX + 1e-6]
    assert len(tread) >= 100
    cy = (min(positions[i][1] for i in tread) + max(positions[i][1] for i in tread)) / 2
    cz = (min(positions[i][2] for i in tread) + max(positions[i][2] for i in tread)) / 2
    axial = (min(positions[i][0] for i in tread), max(positions[i][0] for i in tread))
    samples = {}
    for i in tread:
        u = round(uv[i][0], 5)
        radius = math.hypot(positions[i][1] - cy, positions[i][2] - cz)
        samples[u] = max(samples.get(u, 0), radius)
    # The upper concave envelope retains the native crown/shoulders without
    # adopting the artificial inward sag of previously subdivided flat chords.
    envelope = []
    for point in sorted(samples.items()):
        while len(envelope) >= 2:
            a, b = envelope[-2:]
            cross = (b[0] - a[0]) * (point[1] - b[1]) - (b[1] - a[1]) * (point[0] - b[0])
            if cross < -1e-12:
                break
            envelope.pop()
        envelope.append(point)
    maximum = max(samples.values())

    def radius_at(u):
        if u <= envelope[0][0]:
            return envelope[0][1]
        for a, b in zip(envelope, envelope[1:]):
            if u <= b[0]:
                t = (u - a[0]) / (b[0] - a[0])
                return a[1] + (b[1] - a[1]) * t
        return envelope[-1][1]

    def weight(point):
        return float(axial[0] - .00002 <= point[0] <= axial[1] + .00002
                     and math.hypot(point[1] - cy, point[2] - cz) >= maximum * .92)

    return {'center': (cy, cz), 'axial': axial, 'radius': maximum,
            'envelope': envelope, 'radius_at': radius_at, 'weight': weight}


def partition_visual(source, bone, helpers, Container):
    stream, attrs = helpers.visual_stream(source)
    primary = [value[0] for value in stream.Data[attrs['BlendIndices']]]
    # Preserve all helper bindings on the first visual. No helper is duplicated.
    selected = [i for i, value in enumerate(primary) if value == bone or bone == 1 and value not in (1, 2, 3, 4)]
    lookup = {old: new for new, old in enumerate(selected)}
    triangles = []
    indices = helpers.triangle_indices(source)
    for at in range(0, len(indices), 3):
        face = indices[at:at + 3]
        present = [i in lookup for i in face]
        assert all(present) or not any(present), 'A native face crosses wheel bindings'
        if all(present):
            triangles.extend(lookup[i] for i in face)
    result = copy.deepcopy(source)
    target, _ = helpers.visual_stream(result)
    # Copy the selected tables together: Construct point containers share an
    # input stream; a separate deepcopy per point duplicates the whole GBX.
    target.Data = copy.deepcopy([[values[i] for i in selected] for values in stream.Data])
    target.numVertices = result.body[0x0900600f].VertexCount = len(selected)
    set_indices(result, triangles)
    for name, attribute in attrs.items():
        assert target.Data[attribute] == [stream.Data[attribute][i] for i in selected], name
    return result, selected


def refine_wheel(visual, bone, max_vertices, helpers, Container):
    stream, attrs = helpers.visual_stream(visual)
    original = copy.deepcopy(stream.Data)
    positions = [xyz(p) for p in original[attrs['Position']]]
    normals = [xyz(p) for p in original[attrs['Normal']]]
    uv = [(p.x, p.y) for p in original[attrs['TexCoord0']]]
    bones = [tuple(p) for p in original[attrs['BlendIndices']]]
    profile = wheel_profile([p for p, b in zip(positions, bones) if b[0] == bone],
                            [p for p, b in zip(uv, bones) if b[0] == bone])
    metric = [(u * ACROSS_METRES, v * CIRCUMFERENCE_METRES) for u, v in uv]
    # Only the first byte is active (SkinIndexCount=1). Other bytes contain
    # native padding; preserve them in output without treating them as weights.
    rigid_bones = [(b[0], 0, 0, 0) for b in bones]
    result = refine(positions, normals, metric, rigid_bones, helpers.triangle_indices(visual),
                    profile['weight'], EDGE_METRES * 2048, max_vertices, 12, {bone})
    count = len(positions)
    output = [list(values) for values in original]
    cy, cz = profile['center']
    projected = 0
    for a, b in result['parents']:
        index = len(output[attrs['Position']])
        native_uv = tuple(f32((output[attrs['TexCoord0']][a][k] + output[attrs['TexCoord0']][b][k]) / 2) for k in 'xy')
        point = result['positions'][index]
        direction = result['normals'][index]
        # Reproject only appended tread points. Source vertex values stay exact.
        if profile['weight'](point) and U_MIN - 1e-6 <= native_uv[0] <= U_MAX + 1e-6:
            dy, dz = point[1] - cy, point[2] - cz
            radial = math.hypot(dy, dz)
            radius = profile['radius_at'](native_uv[0])
            point = (point[0], f32(cy + dy * radius / radial), f32(cz + dz * radius / radial))
            direction = (0., dy / radial, dz / radial)
            projected += 1
        for name, attribute in attrs.items():
            if name == 'Position':
                value = Container(zip('xyz', point))
            elif name == 'Normal':
                value = Container(zip('xyz', direction))
            elif name == 'TexCoord0':
                value = Container(zip('xy', native_uv))
            elif name == 'BlendIndices':
                value = copy.deepcopy(output[attribute][a])
                assert value[0] == output[attribute][b][0] == bone
            else:
                axes = 'xy' if name.startswith('TexCoord') else 'xyz'
                values = tuple((output[attribute][a][k] + output[attribute][b][k]) / 2 for k in axes)
                if name == 'TangentU':
                    values = normalized(values)
                value = Container(zip(axes, (f32(v) for v in values)))
            output[attribute].append(value)
    stream.Data = output
    stream.numVertices = visual.body[0x0900600f].VertexCount = len(result['positions'])
    set_indices(visual, result['indices'])
    points = output[attrs['Position']]
    lo = [min(p[k] for p in points) - .08 for k in 'xyz']
    hi = [max(p[k] for p in points) + .08 for k in 'xyz']
    visual.body[0x0900600f].BoundingBox = Container(
        **{axis + '1': f32((lo[i] + hi[i]) / 2) for i, axis in enumerate('xyz')},
        **{axis + '2': f32((hi[i] - lo[i]) / 2) for i, axis in enumerate('xyz')})
    for name, attribute in attrs.items():
        assert output[attribute][:count] == original[attribute], ('Original vertex prefix changed', name)
    metric_edges = []
    seen = set()
    final_uv = output[attrs['TexCoord0']]
    for at in range(0, len(result['indices']), 3):
        a, b, c = result['indices'][at:at + 3]
        for a, b in ((a, b), (b, c), (c, a)):
            key = tuple(sorted((a, b)))
            if key in seen or not profile['weight'](xyz(points[a])) or not profile['weight'](xyz(points[b])):
                continue
            seen.add(key)
            metric_edges.append(math.hypot((final_uv[a].x - final_uv[b].x) * ACROSS_METRES,
                                           (final_uv[a].y - final_uv[b].y) * CIRCUMFERENCE_METRES) * 1000)
    metric_edges.sort()
    stats = {'binding': bone, 'originalVertices': count, 'vertices': stream.numVertices,
             'triangles': len(result['indices']) // 3, 'projectedVertices': projected,
             'centerYZ': profile['center'], 'axialRange': profile['axial'], 'radialEnvelope': profile['envelope'],
             'edgeMm': {label: metric_edges[min(len(metric_edges) - 1, int(len(metric_edges) * fraction))]
                        for label, fraction in [('p50', .5), ('p90', .9), ('p95', .95), ('p99', .99), ('max', 1)]},
             'rounds': result['rounds']}
    return stats


def measure_resumed_wheel(visual, partition, bone, helpers):
    """Recheck a locally prepared standard checkpoint without refining again."""
    stream, attrs = helpers.visual_stream(visual)
    old, old_attrs = helpers.visual_stream(partition)
    count = old.numVertices
    assert count <= stream.numVertices <= 65535
    for name, attribute in old_attrs.items():
        assert stream.Data[attrs[name]][:count] == old.Data[attribute], ('Checkpoint prefix differs', name)
    assert all(b[0] == bone for b in stream.Data[attrs['BlendIndices']][count:])
    original_positions = [xyz(p) for p in old.Data[old_attrs['Position']]]
    original_uv = [(p.x, p.y) for p in old.Data[old_attrs['TexCoord0']]]
    old_bones = old.Data[old_attrs['BlendIndices']]
    profile = wheel_profile([p for p, b in zip(original_positions, old_bones) if b[0] == bone],
                            [p for p, b in zip(original_uv, old_bones) if b[0] == bone])
    positions, uv = stream.Data[attrs['Position']], stream.Data[attrs['TexCoord0']]
    indices = helpers.triangle_indices(visual)
    edges, seen = [], set()
    for at in range(0, len(indices), 3):
        a, b, c = indices[at:at + 3]
        for a, b in ((a, b), (b, c), (c, a)):
            key = tuple(sorted((a, b)))
            if key in seen or not profile['weight'](xyz(positions[a])) or not profile['weight'](xyz(positions[b])):
                continue
            seen.add(key)
            edges.append(math.hypot((uv[a].x - uv[b].x) * ACROSS_METRES,
                                   (uv[a].y - uv[b].y) * CIRCUMFERENCE_METRES) * 1000)
    edges.sort()
    cy, cz = profile['center']
    projected = sum(U_MIN - 1e-6 <= uv[i].x <= U_MAX + 1e-6
                    and abs(math.hypot(positions[i].y - cy, positions[i].z - cz) - profile['radius_at'](uv[i].x)) < 2e-6
                    for i in range(count, stream.numVertices))
    return {'binding': bone, 'originalVertices': count, 'vertices': stream.numVertices,
            'triangles': len(indices) // 3, 'projectedVertices': projected,
            'centerYZ': profile['center'], 'axialRange': profile['axial'], 'radialEnvelope': profile['envelope'],
            'edgeMm': {label: edges[min(len(edges) - 1, int(len(edges) * fraction))]
                       for label, fraction in [('p50', .5), ('p90', .9), ('p95', .95), ('p99', .99), ('max', 1)]},
            'checkpointSha256': prepare.sha((OUTPUT / 'standard.Mesh.gbx').read_bytes())}


def mould_dependencies():
    sys.path.insert(0, str(ROOT / 'audit-evidence/tyre-tools'))
    try:
        import numpy as np
        import shapely
        import triangle
    except ImportError as error:
        raise RuntimeError('Install the pinned OFFLINE developer tools documented in this script; none are browser dependencies') from error
    return np, shapely, triangle


def export_mould_patterns():
    """Export current product source directly; no hidden audit JSON input."""
    javascript = "import {createWheelTreadPattern} from './src/wheelTreadPatterns.ts';process.stdout.write(JSON.stringify(Object.fromEntries(['gravel','mud'].map(mode=>[mode,createWheelTreadPattern(mode)]))));"
    result = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', javascript],
                            cwd=ROOT, text=True, capture_output=True, check=True, timeout=60)
    patterns = json.loads(result.stdout)
    assert set(patterns) == {'gravel', 'mud'}
    assert all(0 < value['depth'] < .025 and 1 <= len(value['blocks']) <= 1000 for value in patterns.values())
    return patterns


def build_mould_mesh(patterns, original_wheel):
    """Node the periodic mould PSLG and triangulate without crossing its edges."""
    np, shapely, triangle = mould_dependencies()
    from shapely.geometry import Polygon, LineString, Point, box
    from shapely.ops import unary_union
    from collections import defaultdict
    width, circumference = .283, CIRCUMFERENCE_METRES
    domain = box(0., 0., width, circumference)
    source_uv = unpacked(original_wheel['uv'], 'f')
    angles = sorted({round((1 - source_uv[i + 1]) * circumference, 7)
                     for i in range(0, len(source_uv), 2) if abs(source_uv[i] - U_MIN) < 1e-5})
    # Existing flank rings are sampled at their real, slightly irregular UV
    # stations. New boundary points interpolate those original straight edges.
    lines = [LineString([(0., y) for y in angles]), LineString([(width, y) for y in angles]),
             LineString([(0., 0.), (width, 0.)]), LineString([(0., circumference), (width, circumference)])]
    profile_polygons = {}
    for mode, pattern in patterns.items():
        polygon_copies = []
        for block in pattern['blocks']:
            assert 3 <= len(block['points']) <= 32
            for shift in (-circumference, 0., circumference):
                polygon = Polygon([(float(x), float(y) + shift) for x, y in block['points']])
                assert polygon.is_valid
                if not polygon.intersects(domain):
                    continue
                polygon_copies.append(polygon)
                # Offset BEFORE clipping: the periodic seam is not a block wall.
                inset = polygon.buffer(-MOULD_BEVEL_METRES, join_style='mitre')
                for contour in (polygon, inset):
                    clipped = contour.intersection(domain)
                    if not clipped.is_empty:
                        lines.append(clipped.boundary)
        profile_polygons[mode] = unary_union(polygon_copies)
    for x in (.00175, .0035, width - .0035, width - .00175):
        lines.append(LineString([(x, 0.), (x, circumference)]))
    network = unary_union(lines)
    points, segments, lookup = [], [], {}

    def index(point):
        key = tuple(round(float(value), 10) for value in point)
        if key not in lookup:
            lookup[key] = len(points)
            points.append(key)
        return lookup[key]

    for line in network.geoms:
        coordinates = list(line.coords)
        for a, b in zip(coordinates, coordinates[1:]):
            pieces = max(1, math.ceil(math.dist(a, b) / MOULD_EDGE_METRES))
            ids = [index((a[0] + (b[0] - a[0]) * i / pieces,
                          a[1] + (b[1] - a[1]) * i / pieces)) for i in range(pieces + 1)]
            segments.extend((a, b) for a, b in zip(ids, ids[1:]) if a != b)
    across, around = math.ceil(width / MOULD_BULK_METRES), math.ceil(circumference / MOULD_BULK_METRES)
    for x in range(1, across):
        for y in range(1, around):
            point = (width * x / across, circumference * y / around)
            if network.distance(Point(point)) > .001:
                index(point)
    mesh = triangle.triangulate({'vertices': np.asarray(points, dtype=np.float64),
                                 'segments': np.asarray(segments, dtype=np.int32)}, 'pQ')
    assert np.isfinite(mesh['vertices']).all()
    constraints = {tuple(sorted(map(int, edge))) for edge in mesh['segments']}
    faces = mesh['triangles'].tolist()
    incidence = defaultdict(list)
    for face_index, face in enumerate(faces):
        for a, b in zip(face, face[1:] + face[:1]):
            incidence[tuple(sorted((a, b)))].append(face_index)
    parents = list(range(len(faces)))

    def find(value):
        while parents[value] != value:
            parents[value] = parents[parents[value]]
            value = parents[value]
        return value

    for edge, incident in incidence.items():
        if edge not in constraints and len(incident) == 2:
            parents[find(incident[0])] = find(incident[1])
    # A contour may share its position, UV and displacement with a neighbour,
    # but never its normal accumulation index. Inactive contours stay smooth
    # because both sides have identical authored radial normals and heights.
    positions, output, duplicated, regions = [], [], {}, []
    for face_index, face in enumerate(faces):
        region = find(face_index)
        for vertex in face:
            key = (vertex, region)
            if key not in duplicated:
                duplicated[key] = len(positions)
                positions.append(mesh['vertices'][vertex].tolist())
                regions.append(region)
            output.append(duplicated[key])
    result = {'points': positions, 'indices': output, 'regions': regions,
              'rawVertices': len(mesh['vertices']), 'constraintSegments': len(constraints),
              'patchCount': len({find(i) for i in range(len(faces))}),
              'profiles': profile_polygons, 'patterns': patterns}
    print(json.dumps({'method': 'constrained-mould', 'sharedVertices': result['rawVertices'],
                      'normalSplitVertices': len(positions), 'triangles': len(output) // 3,
                      'constraintSegments': len(constraints), 'patches': result['patchCount']}), flush=True)
    return result


def wheel_mould_arrays(positions, normals, uv, bones, indices, bone, mould):
    """Replace the tread faces; original flank vertices and faces remain exact."""
    import bisect
    profile = wheel_profile([p for p, b in zip(positions, bones) if b[0] == bone],
                            [p for p, b in zip(uv, bones) if b[0] == bone])
    cy, cz = profile['center']
    rings = []
    for side in (U_MIN, U_MAX):
        candidates = sorted((uv[i][1], i) for i in range(len(positions))
                            if bones[i][0] == bone and abs(uv[i][0] - side) < 1e-5)
        ring = []
        for v, i in candidates:
            if not ring or abs(v - ring[-1][0]) > 1e-7:
                ring.append((v, positions[i], normals[i]))
        assert len(ring) >= 48
        rings.append(ring)

    def sample_ring(ring, v):
        station = bisect.bisect_left([row[0] for row in ring], v)
        for near in (station, station - 1):
            if 0 <= near < len(ring) and abs(v - ring[near][0]) < 1e-7:
                return ring[near][1], ring[near][0]
        lo, hi = ring[max(0, station - 1)], ring[min(len(ring) - 1, station)]
        t = 0 if hi[0] == lo[0] else (v - lo[0]) / (hi[0] - lo[0])
        return tuple(a + (b - a) * t for a, b in zip(lo[1], hi[1])), v

    kept = []
    removed = 0
    for at in range(0, len(indices), 3):
        face = indices[at:at + 3]
        tread = all(bones[i][0] == bone and U_MIN - 1e-6 <= uv[i][0] <= U_MAX + 1e-6
                    and profile['weight'](positions[i]) for i in face)
        if tread:
            removed += 1
        else:
            kept.extend(face)
    assert removed > 100
    result_positions, result_normals, result_uv = list(positions), list(normals), list(uv)
    result_bones = list(bones)
    source_count = len(positions)
    sign = 1 if rings[1][0][1][0] > rings[0][0][1][0] else -1
    for x, y in mould['points']:
        across = x / .283
        v = max(0., min(1., 1 - y / CIRCUMFERENCE_METRES))
        left, left_v = sample_ring(rings[0], v)
        right, right_v = sample_ring(rings[1], v)
        dy, dz = left[1] - cy, left[2] - cz
        radial = math.hypot(dy, dz)
        direction = (0., dy / radial, dz / radial)
        native_u = U_MIN + across * (U_MAX - U_MIN)
        radius = profile['radius_at'](native_u)
        point = (left[0] + (right[0] - left[0]) * across,
                 cy + direction[1] * radius, cz + direction[2] * radius)
        if x < 1e-9:
            point, v = left, left_v
        elif x > .283 - 1e-9:
            point, v = right, right_v
        result_positions.append(tuple(f32(value) for value in point))
        result_normals.append(direction)
        result_uv.append((f32(native_u), f32(v)))
        result_bones.append((bone, 0, 0, 0))
    for at in range(0, len(mould['indices']), 3):
        a, b, c = mould['indices'][at:at + 3]
        if sign > 0:
            b, c = c, b
        kept.extend(source_count + i for i in (a, b, c))
    assert len(result_positions) <= 65535, 'Native 16-bit visual limit exceeded by the mould'
    return {'positions': result_positions, 'normals': result_normals, 'uv': result_uv,
            'bones': result_bones, 'indices': kept, 'sourceCount': source_count,
            'removedTreadTriangles': removed, 'profile': profile, 'axisSign': sign}


def remesh_wheel(visual, bone, mould, helpers, Container):
    stream, attrs = helpers.visual_stream(visual)
    original = copy.deepcopy(stream.Data)
    result = wheel_mould_arrays([xyz(p) for p in original[attrs['Position']]],
                               [xyz(p) for p in original[attrs['Normal']]],
                               [(p.x, p.y) for p in original[attrs['TexCoord0']]],
                               [tuple(p) for p in original[attrs['BlendIndices']]],
                               helpers.triangle_indices(visual), bone, mould)
    rows = list(map(list, original))
    for i in range(result['sourceCount'], len(result['positions'])):
        for name, attribute in attrs.items():
            if name == 'BlendIndices':
                value = list(result['bones'][i])
            else:
                axes = 'xy' if name.startswith('TexCoord') else 'xyz'
                values = (result['positions'][i] if name == 'Position' else result['normals'][i] if name == 'Normal'
                          else result['uv'][i] if name == 'TexCoord0' else (result['axisSign'], 0., 0.))
                value = Container(zip(axes, values))
            rows[attribute].append(value)
    stream.Data = rows
    stream.numVertices = visual.body[0x0900600f].VertexCount = len(result['positions'])
    set_indices(visual, result['indices'])
    for name, attribute in attrs.items():
        assert rows[attribute][:result['sourceCount']] == original[attribute], name
    return {'binding': bone, 'originalVertices': result['sourceCount'], 'vertices': stream.numVertices,
            'triangles': len(result['indices']) // 3, 'removedTreadTriangles': result['removedTreadTriangles'],
            'mouldVertices': len(mould['points']), 'mouldPatches': mould['patchCount'],
            'constraintSegments': mould['constraintSegments'], 'bevelMm': MOULD_BEVEL_METRES * 1000,
            'maxContourEdgeMm': MOULD_EDGE_METRES * 1000}


def write_mould_proofs(mould, original_wheel):
    """Fast private visual proof before serializing either native GBX variant."""
    np, shapely, _ = mould_dependencies()
    positions = unpacked(original_wheel['positions'], 'f')
    normals = unpacked(original_wheel['normals'], 'f')
    uv = unpacked(original_wheel['uv'], 'f')
    bindings = unpacked(original_wheel['bindings'], 'I')
    indices = unpacked(original_wheel['indices'], 'I')
    selected = [i for i, binding in enumerate(bindings) if binding == 1]
    remap = {old: i for i, old in enumerate(selected)}
    faces = [remap[i] for at in range(0, len(indices), 3) for i in indices[at:at + 3]
             if all(v in remap for v in indices[at:at + 3])]
    result = wheel_mould_arrays([tuple(positions[i * 3:i * 3 + 3]) for i in selected],
                               [tuple(normals[i * 3:i * 3 + 3]) for i in selected],
                               [tuple(uv[i * 2:i * 2 + 2]) for i in selected],
                               [(1, 0, 0, 0)] * len(selected), faces, 1, mould)
    base = np.asarray(result['positions'], dtype=np.float64)
    authored = np.asarray(result['normals'], dtype=np.float64)
    faces = np.asarray(result['indices'], dtype=np.uint32).reshape(-1, 3)
    native_uv = np.asarray(result['uv'])
    coordinates = np.column_stack(((native_uv[:, 0] - U_MIN) / (U_MAX - U_MIN) * .283,
                                   (1 - native_uv[:, 1]) * CIRCUMFERENCE_METRES))
    points = shapely.points(coordinates)

    def face_normals(vertices):
        crossed = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]], vertices[faces[:, 2]] - vertices[faces[:, 0]])
        accumulated = np.zeros_like(vertices)
        for corner in range(3):
            np.add.at(accumulated, faces[:, corner], crossed)
        lengths = np.linalg.norm(accumulated, axis=1)
        mask = lengths > 1e-12
        accumulated[mask] /= lengths[mask, None]
        return accumulated

    before = face_normals(base)
    paths = []
    for mode in ('smooth', 'gravel', 'mud'):
        heights = np.zeros(len(base))
        if mode != 'smooth':
            polygon = mould['profiles'][mode]
            distance = np.asarray(shapely.distance(polygon.boundary, points))
            inside = np.asarray(shapely.covers(polygon, points))
            t = np.clip(distance / MOULD_BEVEL_METRES, 0, 1)
            heights = -mould['patterns'][mode]['depth'] * (1 - np.where(inside, t * t * (3 - 2 * t), 0))
            edge = np.clip(np.minimum(coordinates[:, 0], .283 - coordinates[:, 0]) / .0035, 0, 1)
            heights *= edge * edge * (3 - 2 * edge)
            heights[(coordinates[:, 0] <= 0) | (coordinates[:, 0] >= .283)] = 0
        moved = base + authored * heights[:, None]
        directions = authored + face_normals(moved) - before
        lengths = np.linalg.norm(directions, axis=1)
        directions[lengths > 1e-12] /= lengths[lengths > 1e-12, None]
        document = {'asset': {'version': '2.0', 'generator': 'Skion Studio constrained mould proof'},
                    'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'mould-proof-wheel', 'extras': {'nativeVisualIndex': 3}}],
                    'meshes': [], 'materials': [{'name': '_DetailsDmgNormal_Wheels', 'pbrMetallicRoughness': {'baseColorFactor': [.15, .15, .15, 1], 'roughnessFactor': .82, 'metallicFactor': 0}}],
                    'accessors': [], 'bufferViews': [], 'buffers': []}
        binary = bytearray()

        def attribute(values, name, component, axes):
            data = np.asarray(values, dtype=np.float32 if component == 5126 else np.uint32)
            raw = data.tobytes()
            document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
            binary.extend(raw)
            accessor = {'bufferView': len(document['bufferViews']) - 1, 'componentType': component,
                        'count': data.size // axes, 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[axes]}
            if name == 'POSITION':
                accessor.update(min=data.reshape(-1, 3).min(axis=0).tolist(), max=data.reshape(-1, 3).max(axis=0).tolist())
            document['accessors'].append(accessor)
            return len(document['accessors']) - 1

        attributes = {'POSITION': attribute(moved, 'POSITION', 5126, 3), 'NORMAL': attribute(directions, 'NORMAL', 5126, 3),
                      'TEXCOORD_0': attribute(native_uv, 'TEXCOORD_0', 5126, 2)}
        index_accessor = attribute(faces, 'indices', 5125, 1)
        document['meshes'].append({'name': 'relief-native-3-_DetailsDmgNormal_Wheels', 'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}]})
        document['buffers'] = [{'byteLength': len(binary)}]
        encoded = json.dumps(document, separators=(',', ':')).encode()
        encoded += b' ' * (-len(encoded) % 4)
        raw = struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(binary))
        raw += struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary
        path = ROOT / 'audit-evidence' / ('tyre-mould-' + mode + '.glb')
        path.write_bytes(raw)
        paths.append(str(path))
    print(json.dumps({'privateMouldProofs': paths, 'vertices': len(base), 'triangles': len(faces)}), flush=True)


def main():
    global OUTPUT
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--max-wheel-vertices', type=int, default=65535)
    cli.add_argument('--resume-standard', action='store_true', help='Recheck and finish the locally prepared standard checkpoint')
    cli.add_argument('--mould-preview-only', action='store_true', help='Write private smooth/gravel/mud GLB proofs without touching public assets')
    cli.add_argument('--uniform-legacy', action='store_true', help='Diagnostic only: reproduce the rejected uniform refinement')
    args = cli.parse_args()
    assert 14000 <= args.max_wheel_vertices <= 65535
    _, parse_bytes, GbxStruct, _, GbxDec3N, helpers = prepare.setup_parser(prepare.PARSER)
    from construct import Container
    source_manifest_raw = (SOURCE / 'manifest.json').read_bytes()
    source_manifest = json.loads(source_manifest_raw)
    mould = None
    if not args.uniform_legacy:
        patterns = export_mould_patterns()
        original_wheel = next(g for g in source_manifest['geometries'] if g['visualIndex'] == WHEEL_VISUAL)
        mould = build_mould_mesh(patterns, original_wheel)
        write_mould_proofs(mould, original_wheel)
        if args.mould_preview_only:
            return
    published_output = OUTPUT
    # Keep the app's currently authenticated bundle available during the slower
    # native serialization. Publish individual complete files, manifest last.
    OUTPUT = ROOT / 'audit-evidence/tyres-native-build'
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source_raw = {variant: (SOURCE / (variant + '.Mesh.gbx')).read_bytes() for variant in ('standard', 'normal')}
    for variant, raw in source_raw.items():
        assert prepare.sha(raw) == source_manifest['variants'][variant]['sha256']
    source = parse_bytes(source_raw['standard'])
    assert not source._errors
    source_solid = source.body[0x090bb000]
    source_visual = source_solid.visuals[WHEEL_VISUAL]
    source_geometry = next(g for g in source_solid.shadedGeoms if g.visualIndex == WHEEL_VISUAL)
    assert source_geometry.lod == 1 and str(source_solid.materialsNames[source_geometry.materialIndex]) == '_DetailsDmgNormal_Wheels'
    partitions = [partition_visual(source_visual, bone, helpers, Container) for bone in (1, 2, 3, 4)]
    assert sum(len(indices) for _, indices in partitions) == helpers.visual_stream(source_visual)[0].numVertices
    non_tread_counts = []
    for partition, _ in partitions:
        stream, attrs = helpers.visual_stream(partition)
        tread_count = sum(U_MIN - 1e-6 <= point.x <= U_MAX + 1e-6
                          for point in stream.Data[attrs['TexCoord0']])
        non_tread_counts.append(stream.numVertices - tread_count)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    # Retry with a smaller equal per-wheel budget when the bounded manifest
    # would exceed its browser limit. Never modify the source full assets.
    budget = args.max_wheel_vertices
    while True:
        # The old shared visual allocated 10K sidewall vertices to RR and
        # approximately 1K to each other wheel. Equal whole-visual limits would
        # repeat that imbalance. Equalize tread capacity, retaining every old
        # point, while respecting each native visual's independent hard cap.
        tread_capacity = min(args.max_wheel_vertices - count for count in non_tread_counts)
        tread_capacity = min(tread_capacity, (budget * 4 - sum(non_tread_counts)) // 4)
        wheel_budgets = [count + tread_capacity for count in non_tread_counts]
        resumed_raw = (OUTPUT / 'standard.Mesh.gbx').read_bytes() if args.resume_standard else None
        if resumed_raw is not None:
            assert len(resumed_raw) <= 64 * 1024 * 1024
            data = parse_bytes(resumed_raw)
            assert not data._errors
        else:
            data = copy.deepcopy(source)
        solid = data.body[0x090bb000]
        wheel_indices, stats = [], []
        for bone, (partition, source_indices) in enumerate(partitions, 1):
            index = WHEEL_VISUAL if bone == 1 else len(source_solid.visuals) + bone - 2
            if args.resume_standard:
                visual = solid.visuals[index]
                report = measure_resumed_wheel(visual, partition, bone, helpers)
                if mould is not None:
                    checkpoint, declarations = helpers.visual_stream(visual)
                    old_count = helpers.visual_stream(partition)[0].numVertices
                    assert checkpoint.numVertices == old_count + len(mould['points']), 'Checkpoint uses a different mould topology'
                    for point, physical in zip(checkpoint.Data[declarations['TexCoord0']][old_count:], mould['points']):
                        expected_u = U_MIN + physical[0] / .283 * (U_MAX - U_MIN)
                        expected_v = 1 - physical[1] / CIRCUMFERENCE_METRES
                        assert abs(point.x - expected_u) < 2e-7 and abs(point.y - expected_v) < 2e-7, 'Checkpoint mould contours differ from current product source'
            else:
                visual = copy.deepcopy(partition)
                if bone == 1:
                    solid.visuals[index] = visual
                else:
                    assert index == len(solid.visuals)
                    solid.visuals.append(visual)
                    geometry = copy.deepcopy(source_geometry)
                    geometry.visualIndex = index
                    solid.shadedGeoms.append(geometry)
                report = (remesh_wheel(visual, bone, mould, helpers, Container) if mould is not None
                          else refine_wheel(visual, bone, wheel_budgets[bone - 1], helpers, Container))
            wheel_indices.append(index)
            report['visualIndex'] = index
            report['sourceVertexIndices'] = source_indices
            stats.append(report)
            print(json.dumps({k: v for k, v in report.items() if k not in ('sourceVertexIndices', 'rounds', 'radialEnvelope')}), flush=True)
        entries = [copy.deepcopy(e) for e in source_manifest['geometries'] if e['visualIndex'] != WHEEL_VISUAL]
        for e in entries:
            # The immediate migration source is the current full template,
            # including existing user body/detail volumes, rather than dense.
            e['legacyVertexCount'] = len(base64.b64decode(e['positions'])) // 12
            e['parents'] = packed([], 'I')
            e['legacyOffsets'] = {variant: {
                'positionOffset': e['offsets'][variant]['positionOffset'],
                'normalOffset': e['offsets'][variant]['normalOffset'],
                'uvOffset': prepare.unique_offset(source_raw[variant], prepare.packed_floats(unpacked(e['uv'], 'f')))}
                for variant in ('standard', 'normal')}
        for index in wheel_indices:
            stream, attrs = helpers.visual_stream(solid.visuals[index])
            count = stream.numVertices
            entry = {'visualIndex': index, 'family': 'wheels', 'lods': [1],
                     'positions': packed(prepare.flat(stream.Data[attrs['Position']], 'xyz'), 'f'),
                     'normals': packed(prepare.flat(stream.Data[attrs['Normal']], 'xyz'), 'f'),
                     'uv': packed(prepare.flat(stream.Data[attrs['TexCoord0']], 'xy'), 'f'),
                     'indices': packed(helpers.triangle_indices(solid.visuals[index]), 'I'),
                     'bindings': packed([b[0] for b in stream.Data[attrs['BlendIndices']]], 'I'),
                     'bodyVertices': base64.b64encode(bytes(b[0] in (1, 2, 3, 4) for b in stream.Data[attrs['BlendIndices']])).decode('ascii'),
                     'hoodWeights': packed([0.] * count, 'f'), 'boundaryPoints': [],
                     'normalEncoding': 'dec3n', 'offsets': {}}
            entries.append(entry)
        total_vertices = sum(len(base64.b64decode(e['positions'])) // 12 for e in entries)
        total_indices = sum(len(base64.b64decode(e['indices'])) // 4 for e in entries)
        # Account for all tangent arrays before expensive GBX serialization.
        for e in entries:
            stream, attrs = helpers.visual_stream(solid.visuals[e['visualIndex']])
            if 'TangentU' in attrs:
                e['tangents'] = packed(prepare.flat(stream.Data[attrs['TangentU']], 'xyz'), 'f')
        manifest = copy.deepcopy(source_manifest)
        manifest.update({'releaseVersion': '1.3.0-tyres-mould' if mould is not None else '1.2.0-tyres', 'geometries': entries,
                         'legacyVariantBytes': {variant: len(raw) for variant, raw in source_raw.items()},
                         'gameValidation': 'pending-native-constrained-wheel-mould-game-test' if mould is not None else 'pending-wheel-lod0-per-binding-density',
                         'provenance': {'method': 'native-constrained-wheel-mould-v2' if mould is not None else 'native-rigid-wheel-metric-refinement-v1',
                                        'sourceManifestSha256': prepare.sha(source_manifest_raw),
                                        'sourceStandardSha256': prepare.sha(source_raw['standard']),
                                        'targetEdgeMm': (MOULD_EDGE_METRES if mould is not None else EDGE_METRES) * 1000,
                                        'maxVerticesPerWheel': args.max_wheel_vertices,
                                        'wheelVertexBudgets': wheel_budgets,
                                        'treadU': [U_MIN, U_MAX], 'metricAcrossMetres': .283,
                                        'metricCircumferenceMetres': CIRCUMFERENCE_METRES,
                                        'preservedSourceVisuals': len(source_solid.visuals) - 1}})
        if mould is not None:
            manifest['provenance'].update({'mouldBevelMm': MOULD_BEVEL_METRES * 1000,
                                           'maxContourEdgeMm': MOULD_EDGE_METRES * 1000,
                                           'bulkSpacingMm': MOULD_BULK_METRES * 1000,
                                           'patternSha256': prepare.sha(json.dumps(patterns, sort_keys=True).encode()),
                                           'tools': {'shapely': '2.2.0', 'triangle': '20250106', 'numpy': '2.5.4'}})
        predicted_bytes = len(json.dumps(manifest, separators=(',', ':')).encode()) + 40000
        if total_vertices <= 600000 and total_indices <= 3600000 and predicted_bytes <= MAX_MANIFEST_BYTES:
            break
        if mould is not None:
            raise ValueError('Constrained mould exceeds browser budget; preserve contours rather than falling back to uniform refinement')
        if args.resume_standard:
            raise ValueError('Checkpoint exceeds browser budget; regenerate without --resume-standard')
        print(json.dumps({'retry': 'browser-budget', 'budget': budget, 'vertices': total_vertices,
                          'indices': total_indices, 'predictedBytes': predicted_bytes}), flush=True)
        if budget <= 30000:
            raise ValueError('Prepared tyre assets exceed browser limits')
        # Each four-wheel budget increment costs about 410 encoded bytes.
        # Reserve space for authenticated offsets and preview accessor metadata.
        reduction = max(1000, math.ceil((predicted_bytes - MAX_MANIFEST_BYTES + 100000) / 400))
        budget = max(30000, min(38000, budget - reduction))
    # All visuals outside LOD0 Wheels remain exact, including lower wheel LODs.
    helpers.same_fields(source_solid, solid, ('visuals', 'shadedGeoms'))
    assert solid.shadedGeoms[:len(source_solid.shadedGeoms)] == source_solid.shadedGeoms
    for i, original in enumerate(source_solid.visuals):
        if i != WHEEL_VISUAL:
            assert original == solid.visuals[i], ('Other native visual changed', i)
    preview_lookup = prepare.write_preview(solid, OUTPUT / 'preview.glb', helpers)
    for e in entries:
        for key in ('positionAccessor', 'normalAccessor', 'previewMeshName'):
            e.pop(key, None)
        e.update(preview_lookup.get(e['visualIndex'], {}))

    def asset(filename):
        raw = (OUTPUT / filename).read_bytes()
        return {'url': 'tyres/' + filename, 'sha256': prepare.sha(raw), 'byteLength': len(raw)}

    manifest['preview'] = asset('preview.glb')
    for variant in ('standard', 'normal'):
        changed = data if variant == 'standard' and resumed_raw is not None else copy.deepcopy(data)
        target = changed.body[0x090bb000]
        expected_solid = source_solid if variant == 'standard' else parse_bytes(source_raw[variant]).body[0x090bb000]
        if variant == 'normal':
            target.materialsNames = copy.deepcopy(expected_solid.materialsNames)
            # Never regenerate body tangents from already quantized normals:
            # copy the authenticated normal variant's unchanged visuals exactly.
            original_visuals = copy.deepcopy(expected_solid.visuals)
            for i, visual in enumerate(original_visuals):
                if i != WHEEL_VISUAL:
                    target.visuals[i] = visual
        raw = resumed_raw if variant == 'standard' and resumed_raw is not None else GbxStruct.build(changed, gbx_data={}, nodes=changed.get('nodes'), reindex_nodes=True)
        checked = parse_bytes(raw)
        assert not checked._errors
        restored = checked.body[0x090bb000]
        helpers.same_fields(solid, restored, ('materialsNames', 'visuals'))
        assert restored.skel.body == source_solid.skel.body
        for index in wheel_indices:
            before, before_attrs = helpers.visual_stream(solid.visuals[index])
            after, after_attrs = helpers.visual_stream(restored.visuals[index])
            assert helpers.triangle_indices(solid.visuals[index]) == helpers.triangle_indices(restored.visuals[index]), 'Native mould indices changed during serialization'
            for attribute in ('Position', 'TexCoord0', 'BlendIndices'):
                assert before.Data[before_attrs[attribute]] == after.Data[after_attrs[attribute]], ('Native mould attribute changed', attribute)
        for i, original in enumerate(source_solid.visuals):
            if i == WHEEL_VISUAL:
                continue
            expected = expected_solid.visuals[i]
            # Parser IO metadata is excluded by the native helper's comparison.
            helpers.same_fields(expected.body, restored.visuals[i].body)
        for e in entries:
            stream, attrs = helpers.visual_stream(restored.visuals[e['visualIndex']])
            e['offsets'][variant] = {
                'positionOffset': prepare.unique_offset(raw, prepare.packed_floats(unpacked(e['positions'], 'f'))),
                'normalOffset': prepare.unique_offset(raw, b''.join(GbxDec3N.build(n) for n in stream.Data[attrs['Normal']]))}
            if 'TangentU' in attrs:
                e['tangents'] = packed(prepare.flat(stream.Data[attrs['TangentU']], 'xyz'), 'f')
                e['offsets'][variant]['tangentOffset'] = prepare.unique_offset(raw, b''.join(GbxDec3N.build(t) for t in stream.Data[attrs['TangentU']]))
            if e['visualIndex'] not in wheel_indices:
                old = next(g for g in source_manifest['geometries'] if g['visualIndex'] == e['visualIndex'])
                count = e['legacyVertexCount']
                for key, stride in (('positionOffset', 12), ('normalOffset', 4), ('tangentOffset', 4)):
                    if key in old['offsets'][variant]:
                        before = old['offsets'][variant][key]
                        after = e['offsets'][variant][key]
                        assert source_raw[variant][before:before + count * stride] == raw[after:after + count * stride], ('Unchanged native stream differs', variant, e['visualIndex'], key)
        (OUTPUT / (variant + '.Mesh.gbx')).write_bytes(raw)
        manifest['variants'][variant] = asset(variant + '.Mesh.gbx')
    align_preview(OUTPUT / 'preview.glb', entries)
    manifest['preview'] = asset('preview.glb')
    encoded = json.dumps(manifest, separators=(',', ':')).encode()
    assert len(encoded) <= MAX_MANIFEST_BYTES
    (OUTPUT / 'manifest.json').write_bytes(encoded)
    report = {'status': 'PASS native structural preservation', 'gameValidation': manifest['gameValidation'],
              'vertices': total_vertices, 'indices': total_indices, 'manifestBytes': len(encoded),
              'assets': {p.name: p.stat().st_size for p in OUTPUT.iterdir() if p.is_file()},
              'checks': ['Native standard/normal round-trip parse',
                         'Other native visuals and streams byte exact',
                         'New wheel native indices, bindings, UVs and positions exact to manifest',
                         'Original wheel prefixes and helpers retained',
                         'GLB position/normal float references exact to manifest',
                         'Full source asset hashes unchanged'],
              'wheels': stats}
    (OUTPUT / 'preparation-report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    assert (SOURCE / 'manifest.json').read_bytes() == source_manifest_raw
    for variant, raw in source_raw.items():
        assert (SOURCE / (variant + '.Mesh.gbx')).read_bytes() == raw
    published_output.mkdir(parents=True, exist_ok=True)
    for filename in ('standard.Mesh.gbx', 'normal.Mesh.gbx', 'preview.glb', 'preparation-report.json', 'manifest.json'):
        destination = published_output / filename
        assert destination.resolve().is_relative_to(published_output.resolve())
        temporary = destination.with_name(destination.name + '.prepared')
        temporary.write_bytes((OUTPUT / filename).read_bytes())
        os.replace(temporary, destination)
    print(json.dumps({k: v for k, v in report.items() if k != 'wheels'}), flush=True)


if __name__ == '__main__':
    main()
