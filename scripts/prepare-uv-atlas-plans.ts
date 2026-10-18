/** Developer preparation only. See the real UV section of README.md. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {sourceAtlasGuides,realAtlasLayout,type AtlasSourceLayout} from '../src/realUvAtlas';
import {organizedUvParts} from '../src/uvParts';
mkdirSync('work/uv-atlas',{recursive:true});
const plans=process.argv[2]==='plans',result:Record<string,unknown>={};
for(const source of ['stock','underbody-panel-v1','independent-v1'] as AtlasSourceLayout[])result[source]=Object.fromEntries((['skin','details','wheels'] as const).map(f=>[f,plans?Object.fromEntries(realAtlasLayout(f,source).placements.map(p=>[p.part.id,{matrix:p.matrix,bounds:p.bounds}])):organizedUvParts(sourceAtlasGuides(f,source))]));
writeFileSync(`work/uv-atlas/${plans?'plans':'guides'}.json`,JSON.stringify(result));
