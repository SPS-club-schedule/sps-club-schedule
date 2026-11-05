const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {buildSync}=require('esbuild');

test('Android build includes every static dependency and data snapshot, without remote bootstrap or nested APKs',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sps-bundled-')),output=path.join(temp,'web');
  try{
    execFileSync(process.execPath,['scripts/build.mjs','--android'],{env:{...process.env,FRONTEND_OUTPUT_DIR:output,API_BASE_URL:'http://localhost:9999',BOOKING_API_BASE:'http://localhost:9998'},stdio:'pipe'});
    const manifest=JSON.parse(fs.readFileSync(path.join(temp,'frontend-manifest.json'))),html=fs.readFileSync(path.join(output,'index.html'),'utf8');
    const names=new Set(manifest.files.map(f=>f.path));
    for(const file of manifest.files){const bytes=fs.readFileSync(path.join(output,file.path));assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
    assert.ok(names.has('experience-index.json'));assert.ok([...names].some(n=>n.startsWith('assets/fonts/')));
    assert.ok([...names].some(n=>n.includes('document-renderer')&&n.endsWith('.js')));
    assert.ok([...names].some(n=>n.startsWith('experience/')));
    assert.ok(![...names].some(n=>/\.apk$|downloads\/|session-bridge|signing|bootstrap\.js/.test(n)));
    for(const [,url] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))assert.ok(names.has(url.slice(2)),url);
    assert.match(html,/<script type="module" src="\.\/assets\/app-/);assert.match(html,/<link rel="stylesheet" href="\.\/assets\/app-/);
    assert.doesNotMatch(html,/bootstrap\.js/);
    const config=JSON.parse(fs.readFileSync(path.join(output,'config.json')));
    assert.equal(config.apiBase,'https://sps-schedule.folderrewind.top');assert.equal(config.bookingApiBase,'https://sysu-phy-club-book.folderrewind.top');
    for(const name of names){
      if(name.endsWith('.js')){
        const text=fs.readFileSync(path.join(output,name),'utf8');
        for(const [,relative] of text.matchAll(/(?:from|import\()\s*["'](\.\/[^"']+)["']/g))assert.ok(names.has(path.posix.join(path.posix.dirname(name),relative)),relative);
      }
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('bundled full-mode navigation and download components omit app-only redundancies while website keeps them',async()=>{
  for(const bundled of [true,false]){
    const bundle=buildSync({entryPoints:['client/ui.js','client/downloads.js'],bundle:true,format:'esm',outdir:'out',write:false,define:{__BUNDLED_APP__:String(bundled)}});
    const load=name=>import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles.find(f=>f.path.endsWith(name)).text).toString('base64'));
    const ui=await load('ui.js'),downloads=await load('downloads.js');
    const nav=ui.nav('mine',{me:{role:'owner'}});assert.match(nav,/任务看板/);
    assert.equal(nav.includes('simpleEnter'),!bundled);assert.equal(downloads.androidDownloads.includes('下载安卓 App'),!bundled);
  }
});
