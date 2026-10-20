"""Bounded conforming refinement for rigid native surfaces; no game parser here."""
import math
import struct

def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]

def position_key(point):
    return tuple(math.floor(value*1_000_000+.5) for value in point)

def normalized(vector):
    length=math.sqrt(sum(value*value for value in vector))
    if length<1e-10 or not math.isfinite(length):
        raise ValueError('Invalid surface direction')
    return tuple(value/length for value in vector)

def refine(positions, normals, uv, bones, indices, weight, spacing_px=8, max_vertices=62000, max_rounds=10, allowed_bones=None):
    count=len(positions)
    if not (3<=count<=max_vertices<=65535 and len(normals)==len(uv)==len(bones)==count
            and len(indices)%3==0 and len(indices)<=1_200_000 and 2<=spacing_px<=128 and 1<=max_rounds<=12):
        raise ValueError('Invalid refinement limits')
    if any(not all(math.isfinite(v) for v in row) for row in positions+normals+uv):
        raise ValueError('Non-finite surface attributes')
    if any(not isinstance(i,int) or not 0<=i<count for i in indices):
        raise ValueError('Invalid triangle index')
    allowed={0} if allowed_bones is None else set(allowed_bones)
    if any(not isinstance(b,int) or b<0 or b>255 for b in allowed):raise ValueError('Invalid rigid bindings')
    positions=list(positions);normals=list(normals);uv=list(uv);bones=list(bones)
    triangles=[tuple(indices[i:i+3]) for i in range(0,len(indices),3)]
    parents=[];rounds=[]
    for _ in range(max_rounds):
        incidence={}
        for tri in triangles:
            a,b,c=tri
            u=[positions[b][k]-positions[a][k]for k in range(3)];v=[positions[c][k]-positions[a][k]for k in range(3)]
            cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
            rigid=all(bones[i][0] in allowed and bones[i][0]==bones[a][0] for i in tri) and sum(value*value for value in cross)>1e-20
            for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
                edge=tuple(sorted((a,b)))
                if edge not in incidence:incidence[edge]=[True,0]
                incidence[edge][0]&=rigid;incidence[edge][1]+=1
        # Duplicate UV/hard-normal seams must split their coincident edges together.
        groups={}
        for (a,b),(rigid,_) in incidence.items():
            if bones[a][0] not in allowed or bones[a][0]!=bones[b][0] or position_key(positions[a])==position_key(positions[b]):continue
            key=(bones[a][0],tuple(sorted((position_key(positions[a]),position_key(positions[b])))))
            length=math.hypot(uv[a][0]-uv[b][0],uv[a][1]-uv[b][1])*2048
            blocked=weight(positions[a])<=1e-9 and weight(positions[b])<=1e-9
            entry=groups.setdefault(key,{'edges':[],'length':0,'allowed':True})
            entry['edges'].append((a,b));entry['length']=max(entry['length'],length)
            entry['allowed'] &= rigid and not blocked and bones[a]==bones[b]
        candidates=sorted((g for g in groups.values() if g['allowed'] and g['length']>spacing_px),key=lambda g:g['length'],reverse=True)
        midpoint={};remaining=max_vertices-len(positions)
        for group in candidates:
            if len(group['edges'])>remaining:continue
            for a,b in group['edges']:
                midpoint[(a,b)]=len(positions)
                positions.append(tuple(f32((x+y)/2) for x,y in zip(positions[a],positions[b])))
                normals.append(normalized(tuple(x+y for x,y in zip(normals[a],normals[b]))))
                uv.append(tuple(f32((x+y)/2) for x,y in zip(uv[a],uv[b])))
                bones.append(bones[a]);parents.append((a,b))
            remaining-=len(group['edges'])
        if not midpoint:break
        refined=[]
        for a,b,c in triangles:
            m=midpoint.get(tuple(sorted((a,b))));n=midpoint.get(tuple(sorted((b,c))));p=midpoint.get(tuple(sorted((c,a))))
            bits=(m is not None)+(n is not None)+(p is not None)
            if bits==0:refined.append((a,b,c))
            elif bits==3:refined.extend(((a,m,p),(m,b,n),(p,n,c),(m,n,p)))
            elif bits==1:
                if n is not None:a,b,c,m=b,c,a,n
                elif p is not None:a,b,c,m=c,a,b,p
                refined.extend(((a,m,c),(m,b,c)))
            else:
                if m is None:a,b,c,m,n=b,c,a,n,p
                elif n is None:a,b,c,m,n=c,a,b,p,m
                refined.extend(((b,n,m),(a,m,c),(m,n,c)))
        if len(refined)*3>1_200_000:raise ValueError('Triangle budget exceeded')
        triangles=refined
        rounds.append({'newVertices':len(midpoint),'vertices':len(positions),'triangles':len(triangles)})
        if len(positions)>=max_vertices:break
    return {'positions':positions,'normals':normals,'uv':uv,'bones':bones,'indices':[i for tri in triangles for i in tri],
            'originalCount':count,'parents':parents,'rounds':rounds}

def face_normals(positions, indices):
    result=[[0.,0.,0.]for _ in positions]
    for at in range(0,len(indices),3):
        a,b,c=indices[at:at+3]
        u=[positions[b][k]-positions[a][k]for k in range(3)];v=[positions[c][k]-positions[a][k]for k in range(3)]
        cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
        for vertex in (a,b,c):
            for k in range(3):result[vertex][k]+=cross[k]
    return [normalized(row) if sum(v*v for v in row)>1e-18 else (0.,0.,0.)for row in result]
