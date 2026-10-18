"""Separate only the mirrored first Details/Dessous UV panel.

Developer asset preparation. No Blender, Python or parser is required at runtime.
The remaining Details atlas is stored once, with the same relative layout.
All positions, normals, bindings, secondary UVs and triangle counts are unchanged.
"""
from pathlib import Path
import copy
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('panel_native', ROOT/'scripts/prepare-details-sides.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
polygon = json.loads((ROOT/'work/underbody/panel-outline.json').read_text())['polygon']
SCALE = .82
X = .826-min(p['x'] for p in polygon)*SCALE
Y = .006-min(p['y'] for p in polygon)*SCALE


def inside(x, y):
    hit = False
    for i, a in enumerate(polygon):
        b = polygon[i-1]
        if (a['y'] > y) != (b['y'] > y) and x < (b['x']-a['x'])*(y-a['y'])/(b['y']-a['y'])+a['x']:
            hit = not hit
    return hit


def split_panel(visual, helpers, Container):
    stream, attrs = helpers.visual_stream(visual)
    original = copy.deepcopy(stream.Data)
    indices = helpers.triangle_indices(visual)
    result = copy.deepcopy(original)
    assigned, allocated, output = {}, {}, []
    counts = {'left': 0, 'right': 0, 'other': 0}
    for at in range(0, len(indices), 3):
        face = indices[at:at+3]
        u = sum(original[attrs['TexCoord0']][i].x for i in face)/3
        v = 1-sum(original[attrs['TexCoord0']][i].y for i in face)/3
        panel = inside(u, v)
        right = panel and sum(original[attrs['Position']][i].x for i in face) < 0
        counts['right' if right else 'left' if panel else 'other'] += 1
        for index in face:
            key = (index, right)
            if key not in assigned:
                target = index if index not in allocated else len(result[attrs['Position']])
                if index in allocated:
                    for a in range(len(result)):
                        result[a].append(copy.deepcopy(original[a][index]))
                allocated[index] = True
                uv = original[attrs['TexCoord0']][index]
                result[attrs['TexCoord0']][target] = Container(x=uv.x*SCALE+(X if right else 0), y=1-((1-uv.y)*SCALE+(Y if right else 0)))
                assigned[key] = target
            output.append(assigned[key])
    assert len(result[attrs['Position']]) < 65536
    assert len(indices) == len(output)
    for old, new in zip(indices, output):
        for name, a in attrs.items():
            if name != 'TexCoord0':
                assert original[a][old] == result[a][new], name
    stream.Data = result
    stream.numVertices = visual.body[0x0900600f].VertexCount = len(result[attrs['Position']])
    previous, deltas = 0, []
    for i in output:
        deltas.append((i-previous+32768) % 65536-32768)
        previous = i
    visual.body[0x0906a001].indexBuffer[0x09057001].indices = deltas
    return {**counts, 'vertices': stream.numVertices, 'triangles': len(output)//3}


if __name__ == '__main__':
    native.OUTPUT = ROOT/'public/models/underbody-panel'
    native.WORK = ROOT/'work/underbody/panel-native'
    native.main(split_panel, 'underbody-panel-v1')
