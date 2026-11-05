import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {buildExperience} from './experience-files.mjs';
import {createHash,randomBytes} from 'node:crypto';
const releaseId=randomBytes(16).toString('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android=process.argv.includes('--android');
const output=path.resolve(process.env.FRONTEND_OUTPUT_DIR || path.join(root,android?'android/app/build/generated/webAssets/web':'dist'));
const apiBase = android?'https://sps-schedule.folderrewind.top':process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const api = new URL(apiBase);
const bookingApi=new URL(android?'https://sysu-phy-club-book.folderrewind.top':process.env.BOOKING_API_BASE || 'https://sysu-phy-club-book.folderrewind.top');
if(bookingApi.username || bookingApi.password || bookingApi.search || bookingApi.hash || bookingApi.pathname!=='/' || (!['127.0.0.1','localhost'].includes(bookingApi.hostname) && bookingApi.protocol!=='https:')) throw new Error('Invalid booking API origin');
if (api.username || api.password || api.search || api.hash || api.pathname !== '/' || (!['127.0.0.1','localhost'].includes(api.hostname) && api.protocol !== 'https:')) throw new Error('API_BASE_URL must be a bare HTTPS origin (HTTP permitted only for localhost)');
if (!android && process.env.CI && !process.env.API_BASE_URL) throw new Error('Set the GitHub repository variable API_BASE_URL before deployment');
if(android)await fs.rm(output,{recursive:true,force:true});
await fs.rm(path.join(output,'assets'), {recursive:true,force:true});
await fs.mkdir(path.join(output,'assets'), { recursive:true });
const bundle=await build({ entryPoints:[path.join(root,'client/app.js')], outdir:path.join(output,'assets'), entryNames:'app-[hash]', chunkNames:'[name]-[hash]', splitting:true, format:'esm', bundle:true, minify:true, platform:'browser', target:'es2020',metafile:true,define:{__RELEASE_ID__:JSON.stringify(releaseId),__BUNDLED_APP__:String(android),__BUNDLED_CONFIG__:JSON.stringify({apiBase:api.origin,bookingApiBase:bookingApi.origin})} });
const script='./assets/'+path.basename(Object.entries(bundle.metafile.outputs).find(([,value])=>value.entryPoint==='client/app.js'||value.entryPoint===path.join(root,'client/app.js'))[0]);
const css = await Promise.all(['style.css','web.css','workspace.css','experience.css','simple.css'].map(name=>fs.readFile(path.join(root,'client',name),'utf8')));
const mathCss=await fs.readFile(path.join(root,'node_modules/katex/dist/katex.min.css'),'utf8');
await fs.cp(path.join(root,'node_modules/katex/dist/fonts'),path.join(output,'assets/fonts'),{recursive:true});
const styles=css.join('\n')+'\n'+mathCss;
const style='./assets/app-'+createHash('sha256').update(styles).digest('hex').slice(0,16)+'.css';
await fs.writeFile(path.join(output,style),styles);
const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${api.origin} ${bookingApi.origin}; img-src 'self' data:; font-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`;
let html=(await fs.readFile(path.join(root,'client/index.html'),'utf8')).replace('__CSP__',csp);
if(android)html=html.replace('</head>',`<link rel="stylesheet" href="${style}">\n</head>`).replace('<script type="module" src="./bootstrap.js"></script>',`<script type="module" src="${script}"></script>`);
else {
  // Discover the initial module graph during HTML parsing; lazy renderers stay lazy.
  const preloads=new Set();
  function preload(name){
    if(preloads.has(name))return;preloads.add(name);
    for(const dependency of bundle.metafile.outputs[name].imports){
      if(!dependency.external&&dependency.kind==='import-statement')preload(dependency.path);
    }
  }
  preload(Object.keys(bundle.metafile.outputs).find(name=>path.basename(name)===path.basename(script)));
  html=html.replace('</head>',`<meta name="sps-release" content="${releaseId}" data-script="${script}" data-style="${style}">\n<link rel="stylesheet" href="${style}" data-sps-style>\n${[...preloads].map(name=>`<link rel="modulepreload" href="./assets/${path.basename(name)}">`).join('\n')}\n</head>`);
}
await fs.writeFile(path.join(output,'index.html'),html);
if(!android){
await fs.cp(path.join(root,'public/downloads'),path.join(output,'downloads'),{recursive:true});
await fs.copyFile(path.join(root,'client/bootstrap.js'),path.join(output,'bootstrap.js'));
// Older cached HTML still references these fixed paths during the transition.
await fs.copyFile(path.join(root,'client/bootstrap.js'),path.join(output,'assets/app.js'));
await fs.writeFile(path.join(output,'assets/app.css'),styles);
}
await fs.writeFile(path.join(output,'config.json'),JSON.stringify({ apiBase:api.origin,bookingApiBase:bookingApi.origin }));
if(!android)await fs.writeFile(path.join(output,'.nojekyll'),'');
await buildExperience(root,output);
await fs.writeFile(path.join(output,'favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#245540"/><text x="32" y="47" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="48" fill="#fff">S</text></svg>');
await fs.writeFile(path.join(output,'version.json'),JSON.stringify({version:releaseId,script,style}));
if(android){
  const files=[];
  async function collect(dir=''){
    for(const item of await fs.readdir(path.join(output,dir),{withFileTypes:true})){
      const name=dir?dir+'/'+item.name:item.name;
      if(item.isDirectory())await collect(name);
      else {const bytes=await fs.readFile(path.join(output,name));files.push({path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
    }
  }
  await collect();files.sort((a,b)=>a.path.localeCompare(b.path));
  await fs.writeFile(path.join(output,'../frontend-manifest.json'),JSON.stringify({version:releaseId,files}));
}
console.log('Built '+(android?'bundled Android':'GitHub Pages')+' frontend → '+output+'; API: '+api.origin);
