"""Prepare native UV-only reconstruction recipes. Developer tooling only.

Runtime validates the source structure, duplicates seam vertices by copying all
source attributes, and changes only primary UV / matching triangle indices.
Deformed positions/normals, secondary UV, skin bindings and every LOD survive.
"""
from pathlib import Path
import copy, gc, hashlib, importlib.util, json, struct, sys
from array import array
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'work/uv-atlas'; OUT=ROOT/'public/models/uv-atlas'
spec=importlib.util.spec_from_file_location('native_prepare',ROOT/'scripts/prepare-relief-prototype.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
_,parse,Gbx,_,Dec3N,helpers=p.setup_parser(p.PARSER)
from construct import Container
guides=json.loads((WORK/'guides.json').read_text(encoding='utf8'))
LAYOUTS=['stock','underbody-panel-v1','independent-v1']
FULL=len(sys.argv)>2 and sys.argv[2]=='full'
SERIES=('full',)if FULL else(False,True)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def source(layout,dense,variant):
 if dense=='full':
  path=ROOT/'public/models/relief/full'/(variant+'.Mesh.gbx')if layout=='stock'else ROOT/'work/full-surface-volume'/(layout+'-'+variant+'.Mesh.gbx')
  return path.read_bytes()
 raw=(ROOT/'public/models/relief'/('dense' if dense else '')/(variant+'.Mesh.gbx')).read_bytes()
 if layout!='stock':
  base=ROOT/'public/models'/('underbody-panel' if layout=='underbody-panel-v1' else 'details-sides')
  m=json.loads((base/'manifest.json').read_text());blob=(base/'patches.bin').read_bytes()
  entry=next(s for s in m['sources'] if s['id']==('dense-' if dense else '')+variant)
  chunks=[];at=0
  for patch in entry['patches']:
   chunks.extend([raw[at:patch['offset']],blob[patch['dataOffset']:patch['dataOffset']+patch['dataLength']]]);at=patch['offset']+patch['length']
  raw=b''.join(chunks)+raw[at:]
 return raw
def family(name):return next((f for suffix,f in [('_Skin','skin'),('_Details','details'),('_Wheels','wheels')] if name.endswith(suffix)),None)
def inside(poly,x,y):
 hit=False
 for i,a in enumerate(poly):
  b=poly[i-1]
  if (a['y']>y)!=(b['y']>y) and x<(b['x']-a['x'])*(y-a['y'])/(b['y']-a['y'])+a['x']:hit=not hit
 return hit
def classifier(parts):
 grid=[[] for _ in range(64*64)]
 for k,part in enumerate(parts):
  b=part['bounds'];x0=max(0,int(b['x']*64));x1=min(63,int((b['x']+b['w'])*64));y0=max(0,int(b['y']*64));y1=min(63,int((b['y']+b['h'])*64))
  for y in range(y0,y1+1):
   for x in range(x0,x1+1):grid[y*64+x].append(k)
 def choose(x,y):
  hits=[]
  for k in grid[max(0,min(63,int(y*64)))*64+max(0,min(63,int(x*64)))]:
   part=parts[k];count=sum(inside(poly,x,y) for poly in part['region']['polygons'])
   if count%2 if part['region'].get('fillRule')=='evenodd' else count>0:hits.append((part['area'],k))
  if hits:return min(hits)[1]
  def distance(k):
   b=parts[k]['bounds'];return max(b['x']-x,0,x-b['x']-b['w'])**2+max(b['y']-y,0,y-b['y']-b['h'])**2
  return min(range(len(parts)),key=distance)
 return choose
def visuals(solid):
 result={}
 for g in solid.shadedGeoms:
  f=family(str(solid.materialsNames[g.materialIndex]))
  if f:result[g.visualIndex]=f
 return result
def attrs_bytes(stream):
 blocks=[];sizes=[]
 for decl,rows in zip(stream.DataDecl,stream.Data):
  typ=str(decl.header.Type)
  if typ=='Float3' and str(decl.header.Space)=='Local3D' and stream.compressFloat3InLocal3D:typ='Dec3N'
  if typ in ('Float2','Float3','Float4'):
   axes='xyzw'[:int(typ[-1])];raw=array('f',[float(row[a]) for row in rows for a in axes]).tobytes();stride=len(axes)*4
  elif typ=='Dec3N':raw=b''.join(Dec3N.build(row) for row in rows);stride=4
  elif typ=='UByte4':raw=bytes(c for row in rows for c in row);stride=4
  else:raise ValueError('Unsupported native attribute '+typ)
  blocks.append(raw);sizes.append(stride)
 return b''.join(blocks),sizes
if sys.argv[1]=='scan':
 bounds={layout:{f:{part['id']:dict(part['bounds']) for part in families[f]} for f in families} for layout,families in guides.items()}
 for layout in LAYOUTS:
  for dense in SERIES:
   data=parse(source(layout,dense,'standard'));assert not data._errors
   solid=data.body[0x090bb000];assignments={}
   for vi,f in visuals(solid).items():
    st,attrs=helpers.visual_stream(solid.visuals[vi]);uv=st.Data[attrs['TexCoord0']];indices=helpers.triangle_indices(solid.visuals[vi]);choose=classifier(guides[layout][f]);owners=[]
    for at in range(0,len(indices),3):
     face=indices[at:at+3];k=choose(sum(uv[i].x for i in face)/3,1-sum(uv[i].y for i in face)/3);owners.append(k)
     b=bounds[layout][f][guides[layout][f][k]['id']]
     x0=min(b['x'],*(uv[i].x for i in face));y0=min(b['y'],*(1-uv[i].y for i in face));x1=max(b['x']+b['w'],*(uv[i].x for i in face));y1=max(b['y']+b['h'],*(1-uv[i].y for i in face));b.update(x=x0,y=y0,w=x1-x0,h=y1-y0)
    assignments[str(vi)]={'family':f,'owners':owners}
   (WORK/f'{layout}-{dense}.json').write_text(json.dumps(assignments,separators=(',',':')))
   print('scanned',layout,dense,flush=True)
 if not FULL:(ROOT/'src/assets/uvAtlasBounds.json').write_text(json.dumps(bounds,separators=(',',':')),encoding='utf8')
else:
 plans=json.loads((WORK/'plans.json').read_text());OUT.mkdir(parents=True,exist_ok=True)
 blob=bytearray();dedup={};manifest={'version':1,'sources':[]}
 if FULL:
  manifest=json.loads((OUT/'manifest.json').read_text());assert not any('-full-'in s['id']for s in manifest['sources']),'Full recipes already generated'
  blob=bytearray((OUT/'recipes.bin').read_bytes())
 def store(raw):
  key=sha(raw)
  if key not in dedup:dedup[key]={'offset':len(blob),'length':len(raw),'sha256':key};blob.extend(raw)
  return dedup[key]
 for layout in LAYOUTS:
  for dense in SERIES:
   assignments=json.loads((WORK/f'{layout}-{dense}.json').read_text())
   for variant in ('standard','normal'):
    raw=source(layout,dense,variant);original=parse(raw);assert not original._errors
    changed=copy.deepcopy(original);solid=changed.body[0x090bb000];records=[]
    for vi,f in visuals(solid).items():
     visual=solid.visuals[vi];st,attrs=helpers.visual_stream(visual);old=[list(rows)for rows in st.Data];count=st.numVertices;indices=helpers.triangle_indices(visual);assigned={};used={};out=[];mapping=list(range(count));uv=old[attrs['TexCoord0']]
     placement=plans[layout][f];owners=assignments[str(vi)]['owners'];choose=classifier(guides[layout][f])
     for at in range(0,len(indices),3):
      k=owners[at//3];matrix=placement[guides[layout][f][k]['id']]['matrix']
      for index in indices[at:at+3]:
       key=(index,k)
       if key not in assigned:
        target=index if index not in used else len(mapping)
        if target==len(mapping):
         mapping.append(index)
         for a in range(len(st.Data)):
          row=old[a][index];st.Data[a].append(Container((k,row[k])for k in 'xyzw'if k in row)if isinstance(row,dict)else list(row))
        used[index]=True;assigned[key]=target
        a,b,c,d,e,ff=matrix;u,v=uv[index].x,1-uv[index].y;st.Data[attrs['TexCoord0']][target]=Container(x=a*u+c*v+e,y=1-(b*u+d*v+ff))
       out.append(assigned[key])
     for index in range(count):
      if index in used:continue
      k=choose(uv[index].x,1-uv[index].y);a,b,c,d,e,ff=placement[guides[layout][f][k]['id']]['matrix'];st.Data[attrs['TexCoord0']][index]=Container(x=a*uv[index].x+c*(1-uv[index].y)+e,y=1-(b*uv[index].x+d*(1-uv[index].y)+ff))
     assert len(mapping)<65536
     st.numVertices=visual.body[0x0900600f].VertexCount=len(mapping)
     previous=0;deltas=[]
     for i in out:deltas.append((i-previous+32768)%65536-32768);previous=i
     visual.body[0x0906a001].indexBuffer[0x09057001].indices=deltas
     records.append({'visualIndex':vi,'family':f,'oldCount':count,'newCount':len(mapping),'mapping':store(array('H',mapping).tobytes()),'indices':store(array('I',out).tobytes())})
    packed=Gbx.build(changed,gbx_data={},nodes=changed.get('nodes'),reindex_nodes=True);verified=parse(packed);assert not verified._errors
    before=original.body[0x090bb000];after=verified.body[0x090bb000];helpers.same_fields(before,after,('visuals',))
    for record in records:
     vi=record['visualIndex'];oldv=before.visuals[vi];newv=after.visuals[vi];start,end=oldv._iopos;ns,ne=newv._iopos;oldblock=raw[start:end];newblock=packed[ns:ne]
     oldst,attrs=helpers.visual_stream(oldv);newst,_=helpers.visual_stream(newv);oldbytes,strides=attrs_bytes(oldst);newbytes,_=attrs_bytes(newst)
     oldat=oldblock.find(oldbytes);newat=newblock.find(newbytes);assert oldat>=0 and newat>=0
     source_check=bytearray(oldblock);fragments=[];copies=[];cursor=0
     for name,idx in sorted(attrs.items(),key=lambda pair:pair[1]):
      stride=strides[idx];oldoffset=oldat+sum(strides[a]*record['oldCount'] for a in range(idx));newoffset=newat+sum(strides[a]*record['newCount'] for a in range(idx));length=stride*record['newCount']
      if name=='TexCoord0':record['uv']=store(newblock[newoffset:newoffset+length]);continue
      if cursor<newoffset:fragments.append({'offset':cursor,'asset':store(newblock[cursor:newoffset])})
      copies.append({'source':oldoffset,'target':newoffset,'stride':stride,'name':name});cursor=newoffset+length
      if name in ('Position','Normal','TangentU'):source_check[oldoffset:oldoffset+stride*record['oldCount']]=b'\0'*(stride*record['oldCount'])
     if cursor<len(newblock):fragments.append({'offset':cursor,'asset':store(newblock[cursor:])})
     record.update(offset=start,length=end-start,resultLength=ne-ns,structureSha256=sha(source_check),copies=copies,fragments=fragments)
     # Reconstruction must be byte-identical to the parser-built native visual.
     result=bytearray(ne-ns)
     for fr in fragments:aa=fr['asset'];result[fr['offset']:fr['offset']+aa['length']]=blob[aa['offset']:aa['offset']+aa['length']]
     mapping=array('H');aa=record['mapping'];mapping.frombytes(blob[aa['offset']:aa['offset']+aa['length']])
     for cp in copies:
      for i,oldi in enumerate(mapping):result[cp['target']+i*cp['stride']:cp['target']+(i+1)*cp['stride']]=oldblock[cp['source']+oldi*cp['stride']:cp['source']+(oldi+1)*cp['stride']]
     assert result==newblock
    manifest['sources'].append({'id':f'{layout}-{dense}-{variant}','layout':layout,'byteLength':len(raw),'resultByteLength':len(packed),'visuals':records})
    print('built',layout,dense,variant,len(packed),flush=True)
    del original,changed,verified,solid,before,after,oldv,newv,st,oldst,newst,visual,raw,packed
    gc.collect()
 (OUT/'recipes.bin').write_bytes(blob);manifest['asset']={'file':'recipes.bin','byteLength':len(blob),'sha256':sha(blob)}
 (OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf8');print('bytes',len(blob),flush=True)
