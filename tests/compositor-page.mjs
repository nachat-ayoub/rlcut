import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
const cpu=process.argv[2]==='cpu';
const fixtures=JSON.parse(await readFile('.checks/compositor-reference.json','utf8'));
const data=path=>readFile(path.replace('/workspace/',''),'base64').then(image=>'data:image/png;base64,'+image);
fixtures.source=await data(fixtures.source);
for(const item of fixtures.cases)item.reference=await data(item.reference);
const gpu=ts.transpileModule(await readFile('src/lib/gpu-compositor.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('export ','');
const module=ts.transpileModule(await readFile('src/lib/compositor.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import \{ GPUCompositor \} from [^;]+;/,'').replaceAll('export ','');
const script=`${gpu}
${module}
const fixtures=${JSON.stringify(fixtures)};
const done=value=>window.webkit.messageHandlers.test.postMessage(value);
const load=source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=source;});
(async()=>{
 const source=await load(fixtures.source);const output=document.createElement('canvas');output.style.width='480px';document.documentElement.append(output);const compositor=new Compositor(output,${cpu},${!cpu});const result=[];
 for(const item of fixtures.cases){
  compositor.draw(source,source.width,source.height,fixtures.video,item.preset,480);
  const reference=await load(item.reference);const native=document.createElement('canvas');native.width=480;native.height=854;native.getContext('2d').drawImage(reference,0,0);
  const ctx=output.getContext('2d');let a;if(ctx)a=ctx.getImageData(0,0,480,854).data;else{const gl=output.getContext('webgl'),data=new Uint8Array(480*854*4);gl.readPixels(0,0,480,854,gl.RGBA,gl.UNSIGNED_BYTE,data);a=new Uint8Array(data.length);for(let y=0;y<854;y++)a.set(data.subarray(y*480*4,(y+1)*480*4),(853-y)*480*4);}const b=native.getContext('2d').getImageData(0,0,480,854).data;
  let sum=0;for(let i=0;i<a.length;i++){if(i%4!==3)sum+=Math.abs(a[i]-b[i]);}const mean=sum/(480*854*3);result.push(mean.toFixed(2));if(mean>12)throw Error('Preview differs from export: mean RGB error '+mean);
  if(item.preset.boost.enabled){const rect=scene(fixtures.video,item.preset,480,854).boost;let sum=0,count=0;for(let y=Math.max(0,rect.y);y<Math.min(854,rect.y+rect.height);y++)for(let x=Math.max(0,rect.x);x<Math.min(480,rect.x+rect.width);x++)for(let c=0;c<3;c++){const i=(y*480+x)*4+c;sum+=Math.abs(a[i]-b[i]);count++;}if(sum/count>14)throw Error('Boost mask differs from export: '+sum/count);}

 }
 done('PASS ${cpu?'software':'GPU'} compositor/export pixel comparisons; mean RGB errors '+result.join(', '));
})().catch(error=>done('FAIL '+error.message));
`;
await writeFile('.checks/compositor-page.html',`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src data:; script-src 'nonce-test'; style-src 'unsafe-inline'"><script nonce="test">window.addEventListener('error',e=>window.webkit.messageHandlers.test.postMessage('FAIL script '+e.message));</script><script nonce="test">${script.replaceAll('</script','<\\/script')}</script>`);
