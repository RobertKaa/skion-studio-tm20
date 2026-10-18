/** Encode numeric height independently of Canvas2D's 8-bit color conversion. */
export function resizeHeight(values:Float32Array,width:number,height:number,targetWidth:number,targetHeight:number):Float32Array {
  if(!(values instanceof Float32Array)||![width,height,targetWidth,targetHeight].every(v=>Number.isInteger(v)&&v>0)||width>8192||height>8192||targetWidth>4096||targetHeight>4096||width*height>16*1024*1024||values.length!==width*height)throw new Error('Dimensions de hauteur invalides.');
  const result=new Float32Array(targetWidth*targetHeight);
  for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){const u=Math.max(0,Math.min(width-1,(x+.5)*width/targetWidth-.5)),v=Math.max(0,Math.min(height-1,(y+.5)*height/targetHeight-.5)),a=Math.floor(u),b=Math.floor(v),tx=u-a,ty=v-b,sample=(i:number,j:number)=>values[Math.min(height-1,j)*width+Math.min(width-1,i)];result[y*targetWidth+x]=sample(a,b)*(1-tx)*(1-ty)+sample(a+1,b)*tx*(1-ty)+sample(a,b+1)*(1-tx)*ty+sample(a+1,b+1)*tx*ty;}
  return result;
}
export async function heightPng(values:Float32Array,width:number,height:number):Promise<string>{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||values.length!==width*height||values.some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('Champ de hauteur invalide (4K maximum).');
  const rows=new Uint8Array(height*(width*2+1));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=Math.round(values[y*width+x]*65535),at=y*(width*2+1)+1+x*2;rows[at]=v>>>8;rows[at+1]=v&255;}
  const compressed=new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk=(name:string,data:Uint8Array)=>{const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);for(let i=0;i<4;i++)out[i+4]=name.charCodeAt(i);out.set(data,8);let crc=0xffffffff;for(const byte of out.subarray(4,out.length-4)){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;};
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=16;
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',new Uint8Array())];
  let binary='';for(const bytes of chunks)for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return`data:image/png;base64,${btoa(binary)}`;
}
