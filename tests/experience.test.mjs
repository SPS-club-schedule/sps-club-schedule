import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildExperience} from '../scripts/experience-files.mjs';

test('public experience files preserve bytes across restart, enforce SPS membership and ownership, and support revision-safe organize/hide/restore',{timeout:60000},async()=>{
  const bundle=await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:*'],write:false});
  const directory=await mkdtemp(join(tmpdir(),'sps-experience-'));let mf;
  const bindings={ALLOWED_ORIGINS:'https://site.test',REGISTRATION_OPEN:'true'};
  const options=()=>{const o=convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],durableObjects:{CLUB_SERVICE:{className:'ClubService',useSQLite:true}},durableObjectsPersist:directory,bindings});o.resourcePersistencePath=directory;return o;};
  const post=async(path,data,token)=>{const r=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const api=async(action,input,token)=>{const r=await post('/api',{action,input},token);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
  const listing=async token=>{const response=await mf.dispatchFetch('http://localhost/experience',{headers:token?{Authorization:'Bearer '+token}:{}});assert.equal(response.status,200);return (await response.json()).data;};
  const manage=async(input,token,status=200)=>{const r=await post('/experience/manage',input,token);assert.equal(r.status,status,JSON.stringify(r));return r.data;};
  try {
    mf=new Miniflare(options());
    const register=async(username,mode,invite)=>{const r=await post('/auth/register',{username,password:'Experience-test-2026!',nickname:username,name:'SPS archive',mode,invite});assert.equal(r.status,200,JSON.stringify(r));return r.data;};
    const owner=await register('archive_owner','create');bindings.EXPERIENCE_CLUB_ID=owner.clubId;await mf.setOptions(options());
    const invite=(await api('getInvite',{clubId:owner.clubId},owner.token)).token;
    const member=await register('archive_member','join',invite),other=await register('archive_other','join',invite),outsider=await register('archive_outsider','create');
    const bytes=Buffer.from(Array.from({length:700000},(_,i)=>i%251));
    const input={requestId:'archive-upload-0001',path:'2026-2027届/学术部/测试.pdf',description:'可公开经验',content:bytes.toString('base64')};
    assert.equal((await post('/experience/upload',input)).status,401);
    assert.equal((await post('/experience/upload',input,outsider.token)).status,403);
    const result=await post('/experience/upload',input,member.token);assert.equal(result.status,200,JSON.stringify(result));let file=result.data.entry;
    assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal((await post('/experience/upload',input,member.token)).data.entry.id,file.id);
    assert.equal((await post('/experience/upload',{...input,path:'其他.pdf'},member.token)).status,409);
    assert.equal((await post('/experience/upload',{...input,requestId:'new-upload-key'},member.token)).status,409);
    for(const path of ['../bad.pdf','a//b.pdf','恶意.html','a/脚本.svg','a\\b.pdf','.hidden/file.pdf'])assert.equal((await post('/experience/upload',{...input,path,requestId:'invalid-path-key'},member.token)).status,400);
    for(const content of ['', '%%%%', 'AAAA===='])assert.equal((await post('/experience/upload',{...input,content,requestId:'invalid-bytes-key'},member.token)).status,400);
    const publicList=await listing();assert.equal(publicList.canWrite,false);assert.ok(publicList.entries.some(x=>x.path==='2026-2027届/学术部'&&x.kind==='folder'));assert.equal(publicList.entries.find(x=>x.id===file.id).canEdit,false);assert.doesNotMatch(JSON.stringify(publicList),/account_id|identity|token|archive_member.*password|creator/);
    assert.equal((await listing(outsider.token)).canWrite,false);
    await manage({action:'hide',id:file.id,revision:file.revision},other.token,403);
    await manage({action:'edit',id:file.id,revision:999,path:'新文件.pdf'},member.token,409);
    file=(await manage({action:'edit',id:file.id,revision:file.revision,path:'2026-2027届/活动复盘/修改.pdf',description:'已整理'},member.token)).entry;
    const response=await mf.dispatchFetch('http://localhost/experience/files/'+file.id);assert.equal(response.headers.get('Content-Type'),'application/octet-stream');assert.match(response.headers.get('Content-Disposition'),/^attachment;/);assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    await mf.dispose();mf=new Miniflare(options());assert.equal((await listing()).entries.find(x=>x.id===file.id).description,'已整理');assert.deepEqual(Buffer.from(await (await mf.dispatchFetch('http://localhost/experience/files/'+file.id)).arrayBuffer()),bytes);
    file=(await manage({action:'hide',id:file.id,revision:file.revision},member.token)).entry;
    assert.equal((await mf.dispatchFetch('http://localhost/experience/files/'+file.id)).status,404);assert.equal((await listing()).entries.some(x=>x.id===file.id),false);assert.equal((await listing(other.token)).entries.some(x=>x.id===file.id),false);assert.equal((await listing(member.token)).entries.find(x=>x.id===file.id).removed,true);
    file=(await manage({action:'restore',id:file.id,revision:file.revision},owner.token)).entry;assert.equal(file.removed,false);
    await manage({action:'folder',path:'2025-2026届/宣传部/海报经验'},member.token);
    await manage({action:'folder',path:file.path+'/子目录'},member.token,409);
    const large=Buffer.alloc(10*1024*1024,31),largeInput={requestId:'ten-megabyte-file',path:'大文件.zip',content:large.toString('base64')};
    assert.equal((await post('/experience/upload',largeInput,owner.token)).status,200);
    assert.equal((await post('/experience/upload',{...largeInput,requestId:'too-large-file',content:Buffer.alloc(10*1024*1024+1).toString('base64')},owner.token)).status,400);
    await post('/auth/logout',{},member.token);assert.equal((await post('/experience/manage',{action:'folder',path:'注销后'},member.token)).status,401);
    assert.equal((await mf.dispatchFetch('http://localhost/experience?secret=1')).status,404);
  }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});

test('repository experience publishing indexes nested and empty folders, preserves file bytes and rejects active content or symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'experience-build-')),dist=join(root,'dist');
  try {
    await mkdir(join(root,'experience/2026-2027届/学术部'),{recursive:true});await writeFile(join(root,'experience/2026-2027届/学术部/.gitkeep'),'');await writeFile(join(root,'experience/AGENTS.md'),'not published');
    await writeFile(join(root,'experience/2026-2027届/复盘.md'),'# 复盘\n真实资料');
    const entries=await buildExperience(root,dist);assert.equal(entries.filter(x=>x.kind==='file').length,1);assert.ok(entries.some(x=>x.path==='2026-2027届/学术部'));assert.equal(await readFile(join(dist,'experience/2026-2027届/复盘.md'),'utf8'),'# 复盘\n真实资料');
    await writeFile(join(root,'experience/unsafe.html'),'<script>bad()</script>');await assert.rejects(buildExperience(root,dist));await rm(join(root,'experience/unsafe.html'));
    await symlink('/etc/hosts',join(root,'experience/link.txt'));await assert.rejects(buildExperience(root,dist),/symlinks/);
  }finally{await rm(root,{recursive:true,force:true});}
});
