"""Build authenticated relief assets for each paint family, retaining every rig binding.

The previous dense vertex streams stay as prefixes for migration of saved volumes.
Only the trusted bundled Stadium is read. No user GBX or Blender file is executed.
"""
import base64
import copy
import importlib.util
import json
from array import array
from pathlib import Path
from dense_heightfield_core import refine, f32, normalized, position_key

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/models/relief/dense'
OUTPUT = ROOT / 'public/models/relief/full'
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'scripts/prepare-relief-prototype.py')
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)
spec = importlib.util.spec_from_file_location('surface_sides', ROOT / 'scripts/prepare-details-sides.py')
sides = importlib.util.module_from_spec(spec); spec.loader.exec_module(sides)
_, parse_bytes, GbxStruct, _, GbxDec3N, helpers = prepare.setup_parser(prepare.PARSER)
from construct import Container

FAMILIES = {'_SkinDmg_Skin': 'skin', '_DetailsDmgNormal_Details': 'details', '_DetailsDmgNormal_Wheels': 'wheels'}
LIMITS = {
    # Leave room for UV-chart duplicates in the native 16-bit index buffer.
    'skin': {1: 65000, 2: 42000, 4: 24000, 8: 8000, 16: 2500},
    'details': {1: 62000, 2: 48000, 4: 24000, 8: 5000, 16: 1400},
    'wheels': {1: 14000, 2: 10000, 4: 6000, 8: 2000, 16: 800},
}
SPACING = {1: 8, 2: 12, 4: 20, 8: 36, 16: 72}

def vec(values): return Container(zip('xyz'[:len(values)], [f32(v) for v in values]))
def packed(values, code): return base64.b64encode(array(code, values).tobytes()).decode('ascii')

def main():
    old_manifest = json.loads((SOURCE / 'manifest.json').read_text())
    old_raw = {v: (SOURCE / (v + '.Mesh.gbx')).read_bytes() for v in ('standard', 'normal')}
    for v in old_raw: assert prepare.sha(old_raw[v]) == old_manifest['variants'][v]['sha256']
    baseline = parse_bytes(old_raw['standard']); assert not baseline._errors
    data = copy.deepcopy(baseline); solid = data.body[0x090bb000]
    old_solids = {v: parse_bytes(raw).body[0x090bb000] for v, raw in old_raw.items()}
    entries = []
    contacts = {}
    for geom in solid.shadedGeoms:
        s, a = helpers.visual_stream(solid.visuals[geom.visualIndex])
        owner = str(solid.materialsNames[geom.materialIndex]).rsplit('_',1)[-1].lower()
        for point, bone in zip(s.Data[a['Position']],s.Data[a['BlendIndices']]):
            key=(geom.lod,position_key(tuple(point[k] for k in 'xyz')))
            contacts.setdefault(key,set()).add((owner,bone[0]))
    for geom in solid.shadedGeoms:
        family = FAMILIES.get(str(solid.materialsNames[geom.materialIndex]))
        if not family or any(e['visualIndex'] == geom.visualIndex for e in entries): continue
        vi, lod = geom.visualIndex, geom.lod
        visual = solid.visuals[vi]; stream, attrs = helpers.visual_stream(visual)
        original_count=stream.numVertices; split_parents=[]
        if family=='details':
            # Include the physical centre seam before densification. Subsequent
            # UV separation then only duplicates vertices, including deformed ones.
            original_uv=copy.deepcopy(stream.Data[attrs['TexCoord0']]);provenance=[]
            sides.split_visual(visual,helpers,Container,provenance)
            stream,attrs=helpers.visual_stream(visual)
            stream.Data[attrs['TexCoord0']][:original_count]=original_uv
            for index,(a,b,t)in enumerate(provenance,start=original_count):
                stream.Data[attrs['TexCoord0']][index]=Container(x=f32(original_uv[a].x*(1-t)+original_uv[b].x*t),y=f32(original_uv[a].y*(1-t)+original_uv[b].y*t))
                split_parents.append((a,b))
        positions = [tuple(v[a] for a in 'xyz') for v in stream.Data[attrs['Position']]]
        normals = [tuple(v[a] for a in 'xyz') for v in stream.Data[attrs['Normal']]]
        uv = [tuple(v[a] for a in 'xy') for v in stream.Data[attrs['TexCoord0']]]
        bones = [tuple(v) for v in stream.Data[attrs['BlendIndices']]]
        # Body is already dense. Refine its previously excluded moving panels only.
        allowed = {b[0] for b in bones} - ({0} if family == 'skin' else set())
        limit = max(len(positions), LIMITS[family][lod])
        if family == 'details' and vi == 7: limit = 5000
        result = refine(positions, normals, uv, bones, helpers.triangle_indices(visual), lambda _: 1., SPACING[lod], limit, allowed_bones=allowed)
        stream.numVertices = visual.body[0x0900600f].VertexCount = len(result['positions'])
        stream.Data[attrs['Position']] = list(map(vec, result['positions']))
        stream.Data[attrs['Normal']] = [Container(zip('xyz', n)) for n in result['normals']]
        stream.Data[attrs['TexCoord0']] = list(map(vec, result['uv']))
        stream.Data[attrs['BlendIndices']] = list(map(list, result['bones']))
        if 'TangentU' in attrs:
            tangents = [tuple(v[a] for a in 'xyz') for v in stream.Data[attrs['TangentU']]]
            for a, b in result['parents']:
                value = tuple(x+y for x,y in zip(tangents[a],tangents[b]))
                tangents.append(normalized(value) if sum(v*v for v in value)>1e-12 else tangents[a])
            stream.Data[attrs['TangentU']] = [Container(zip('xyz', t)) for t in tangents]
        previous = 0; deltas = []
        for index in result['indices']: deltas.append((index-previous+32768)%65536-32768); previous=index
        visual.body[0x0906a001].indexBuffer[0x09057001].indices = deltas
        lo = [min(p[k] for p in result['positions'])-.08 for k in range(3)]
        hi = [max(p[k] for p in result['positions'])+.08 for k in range(3)]
        visual.body[0x0900600f].BoundingBox = Container(**{a+'1':f32((lo[k]+hi[k])/2) for k,a in enumerate('xyz')}, **{a+'2':f32((hi[k]-lo[k])/2) for k,a in enumerate('xyz')})
        # The existing vertices and all articulation/damage bindings remain exact.
        prior, oldattrs = helpers.visual_stream(baseline.body[0x090bb000].visuals[vi])
        for attr in attrs:
            assert stream.Data[attrs[attr]][:original_count] == prior.Data[oldattrs[attr]]
        legacy_offsets = {}
        for variant in ('standard', 'normal'):
            s, a = helpers.visual_stream(old_solids[variant].visuals[vi])
            legacy_offsets[variant] = {'positionOffset':prepare.unique_offset(old_raw[variant], prepare.packed_floats(prepare.flat(s.Data[a['Position']], 'xyz'))), 'normalOffset':prepare.unique_offset(old_raw[variant], b''.join(GbxDec3N.build(n) for n in s.Data[a['Normal']])), 'uvOffset':prepare.unique_offset(old_raw[variant], prepare.packed_floats(prepare.flat(s.Data[a['TexCoord0']], 'xy')))}
        entries.append({'visualIndex':vi, 'family':family, 'lods':[lod], 'positions':prepare.flat(stream.Data[attrs['Position']], 'xyz'), 'normals':prepare.flat(stream.Data[attrs['Normal']], 'xyz'), 'uv':prepare.flat(stream.Data[attrs['TexCoord0']], 'xy'), 'indices':result['indices'], 'bodyVertices':[True]*len(result['positions']), 'bindings':[b[0] for b in result['bones']], 'parents':[i for pair in split_parents+result['parents'] for i in pair], 'legacyVertexCount':original_count, 'legacyOffsets':legacy_offsets, 'hoodWeights':[prepare.hood_weight(p,n,str(solid.bonesNames[b[0]])) if family=='skin' else 0 for p,n,b in zip(stream.Data[attrs['Position']],stream.Data[attrs['Normal']],stream.Data[attrs['BlendIndices']])], 'boundaryPoints':[], 'normalEncoding':'dec3n', 'offsets':{}})
        anchors={position_key(point) for point,bone in zip(positions,bones) if any(owner!=(family,bone[0]) for owner in contacts.get((lod,position_key(point)),set()))}
        entries[-1]['boundaryPoints']=[v/1_000_000 for point in sorted(anchors) for v in point]
        print(json.dumps({'family':family, 'lod':lod, 'vertices':len(result['positions']), 'added':len(result['positions'])-len(positions)}), flush=True)
    OUTPUT.mkdir(exist_ok=True)
    lookup = prepare.write_preview(solid, OUTPUT / 'preview.glb', helpers)
    for e in entries:
        if e['visualIndex'] in lookup: e.update(lookup[e['visualIndex']])
    def asset(filename):
        raw=(OUTPUT/filename).read_bytes(); return {'url':'full/'+filename,'sha256':prepare.sha(raw),'byteLength':len(raw)}
    variants={}
    for variant in ('standard','normal'):
        changed=copy.deepcopy(data); target=changed.body[0x090bb000]
        if variant=='normal':
            target.materialsNames[target.materialsNames.index('_SkinDmg_Skin')]='_DetailsDmgNormal_Skin'
            prepare.add_normal_tangents(target,helpers)
        raw=GbxStruct.build(changed,gbx_data={},nodes=changed.get('nodes'),reindex_nodes=True)
        checked=parse_bytes(raw);assert not checked._errors
        helpers.same_fields(solid,checked.body[0x090bb000],('materialsNames','visuals'))
        for e in entries:
            s,a=helpers.visual_stream(checked.body[0x090bb000].visuals[e['visualIndex']])
            e['offsets'][variant]={'positionOffset':prepare.unique_offset(raw,prepare.packed_floats(e['positions'])), 'normalOffset':prepare.unique_offset(raw,b''.join(GbxDec3N.build(n)for n in s.Data[a['Normal']]))}
            if 'TangentU'in a:
                e['tangents']=prepare.flat(s.Data[a['TangentU']],'xyz');e['offsets'][variant]['tangentOffset']=prepare.unique_offset(raw,b''.join(GbxDec3N.build(t)for t in s.Data[a['TangentU']]))
        (OUTPUT/(variant+'.Mesh.gbx')).write_bytes(raw);variants[variant]=asset(variant+'.Mesh.gbx')
    manifest={'schemaVersion':1,'surfaceMethod':'dense-heightfield-v1','encoding':'numeric-base64-v1','releaseVersion':'1.1.0','interfaceProtectionVersion':1,'preview':asset('preview.glb'),'variants':variants,'dependencies':old_manifest['dependencies'],'geometries':entries,'legacyVariantBytes':{v:len(b)for v,b in old_raw.items()},'gameValidation':'pending-new-animated-panels-and-family-scope'}
    for e in entries:
        for key in ('positions','normals','uv','hoodWeights','tangents'):
            if key in e:e[key]=packed(e[key],'f')
        for key in ('indices','bindings','parents'):e[key]=packed(e[key],'I')
        e['bodyVertices']=base64.b64encode(bytes(e['bodyVertices'])).decode('ascii')
    (OUTPUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf8')
    print('PASS: full paint-family relief assets, original vertex prefixes and bindings preserved',flush=True)

if __name__=='__main__':main()
