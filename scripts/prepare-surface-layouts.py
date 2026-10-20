"""UV-only recipes for the articulated relief mesh; preserve deformed attributes."""
import copy, gc, hashlib, importlib.util, json
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
p=module('surface_prepare','prepare-relief-prototype.py')
sides=module('surface_sides','prepare-details-sides.py')
panel=module('surface_panel','prepare-underbody-panel.py')
_,parse,Gbx,_,Dec3N,helpers=p.setup_parser(p.PARSER)
from construct import Container
OUT=ROOT/'public/models/surface-layouts';OUT.mkdir(exist_ok=True)
blob=bytearray();dedup={};manifest={'version':1,'sources':[]}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def store(raw):
 key=sha(raw)
 if key not in dedup:dedup[key]={'offset':len(blob),'length':len(raw),'sha256':key};blob.extend(raw)
 return dedup[key]
def attributes(st):
 blocks=[];strides=[]
 for decl,rows in zip(st.DataDecl,st.Data):
  typ=str(decl.header.Type)
  if typ=='Float3' and str(decl.header.Space)=='Local3D' and st.compressFloat3InLocal3D:typ='Dec3N'
  if typ.startswith('Float'):
   axes='xyzw'[:int(typ[-1])];raw=array('f',[float(r[a])for r in rows for a in axes]).tobytes();stride=len(axes)*4
  elif typ=='Dec3N':raw=b''.join(Dec3N.build(r)for r in rows);stride=4
  elif typ=='UByte4':raw=bytes(v for r in rows for v in r);stride=4
  else:raise ValueError(typ)
  blocks.append(raw);strides.append(stride)
 return b''.join(blocks),strides
def key(st,attrs,i):
 return tuple(tuple(st.Data[a][i][c]for c in 'xyzw'if c in st.Data[a][i]) if isinstance(st.Data[a][i],dict) else tuple(st.Data[a][i])for name,a in attrs.items()if name!='TexCoord0')
for layout,splitter in [('underbody-panel-v1',panel.split_panel),('independent-v1',sides.split_visual)]:
 for variant in ['standard','normal']:
  raw=(ROOT/'public/models/relief/full'/(variant+'.Mesh.gbx')).read_bytes();original=parse(raw);changed=copy.deepcopy(original)
  before=original.body[0x090bb000];after=changed.body[0x090bb000]
  visuals=sorted({g.visualIndex for g in after.shadedGeoms if str(after.materialsNames[g.materialIndex]).endswith('_Details')})
  for vi in visuals:splitter(after.visuals[vi],helpers,Container)
  packed=Gbx.build(changed,gbx_data={},nodes=changed.get('nodes'),reindex_nodes=True);verified=parse(packed);assert not verified._errors
  records=[]
  for vi in visuals:
   oldv,newv=before.visuals[vi],verified.body[0x090bb000].visuals[vi]
   old,attrs=helpers.visual_stream(oldv);new,_=helpers.visual_stream(newv)
   if not any(g.visualIndex==vi and str(before.materialsNames[g.materialIndex])=='_DetailsDmgNormal_Details'for g in before.shadedGeoms):
    # Decals never receive volume. Their centre-plane intersections remain an
    # authenticated static replacement, separate from deformed opaque surfaces.
    start,end=oldv._iopos;ns,ne=newv._iopos
    preview={}
    for native,name,axes in [('Position','POSITION','xyz'),('Normal','NORMAL','xyz'),('TexCoord0','TEXCOORD_0','xy'),('TexCoord1','TEXCOORD_1','xy')]:
     if native in attrs:preview[name]={'asset':store(array('f',[float(r[a])for r in new.Data[attrs[native]]for a in axes]).tobytes()),'componentType':5126,'type':'VEC'+str(len(axes))}
    records.append({'visualIndex':vi,'family':'details','oldCount':old.numVertices,'newCount':new.numVertices,'offset':start,'length':end-start,'resultLength':ne-ns,'structureSha256':sha(raw[start:end]),'mapping':store(array('H',[0]*new.numVertices).tobytes()),'indices':store(array('I',helpers.triangle_indices(newv)).tobytes()),'uv':preview['TEXCOORD_0']['asset'],'copies':[],'fragments':[{'offset':0,'asset':store(packed[ns:ne])}],'staticPreview':preview})
    continue
   lookup={};mapping=list(range(old.numVertices))
   for i in range(old.numVertices):lookup.setdefault(key(old,attrs,i),i)
   mapping.extend(lookup[key(new,attrs,i)]for i in range(old.numVertices,new.numVertices))
   assert new.numVertices<65536
   start,end=oldv._iopos;ns,ne=newv._iopos;oldblock=raw[start:end];newblock=packed[ns:ne]
   oldbytes,strides=attributes(old);newbytes,_=attributes(new);oa=oldblock.find(oldbytes);na=newblock.find(newbytes);assert min(oa,na)>=0
   structure=bytearray(oldblock);copies=[];fragments=[];cursor=0;record={}
   for name,idx in sorted(attrs.items(),key=lambda a:a[1]):
    stride=strides[idx];a=oa+sum(strides[k]*old.numVertices for k in range(idx));b=na+sum(strides[k]*new.numVertices for k in range(idx));size=stride*new.numVertices
    if name=='TexCoord0':record['uv']=store(newblock[b:b+size]);continue
    if cursor<b:fragments.append({'offset':cursor,'asset':store(newblock[cursor:b])})
    copies.append({'source':a,'target':b,'stride':stride,'name':name});cursor=b+size
    if name in ['Position','Normal','TangentU']:structure[a:a+stride*old.numVertices]=b'\0'*(stride*old.numVertices)
   if cursor<len(newblock):fragments.append({'offset':cursor,'asset':store(newblock[cursor:])})
   records.append({**record,'visualIndex':vi,'family':'details','oldCount':old.numVertices,'newCount':new.numVertices,'offset':start,'length':end-start,'resultLength':ne-ns,'structureSha256':sha(structure),'mapping':store(array('H',mapping).tobytes()),'indices':store(array('I',helpers.triangle_indices(newv)).tobytes()),'copies':copies,'fragments':fragments})
   reconstructed=bytearray(ne-ns)
   for f in fragments:a=f['asset'];reconstructed[f['offset']:f['offset']+a['length']]=blob[a['offset']:a['offset']+a['length']]
   for c in copies:
    for i,oldi in enumerate(mapping):reconstructed[c['target']+i*c['stride']:c['target']+(i+1)*c['stride']]=oldblock[c['source']+oldi*c['stride']:c['source']+(oldi+1)*c['stride']]
   assert reconstructed==newblock
  manifest['sources'].append({'id':f'{layout}-full-{variant}','layout':layout,'byteLength':len(raw),'resultByteLength':len(packed),'visuals':records})
  (ROOT/'work/full-surface-volume'/(layout+'-'+variant+'.Mesh.gbx')).write_bytes(packed)
  print('Built',layout,variant,len(packed),flush=True)
  # Parser Containers retain their binary backing streams. Release all native
  # graphs between variants so preparation stays bounded on desktop machines.
  del original,changed,before,after,verified,old,new,oldv,newv,lookup
  gc.collect()
(OUT/'recipes.bin').write_bytes(blob);manifest['asset']={'file':'recipes.bin','byteLength':len(blob),'sha256':sha(blob)}
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf8')
