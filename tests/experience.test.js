const test=require('node:test'),assert=require('node:assert/strict');
const {archivePath,archiveTree,visibleEntries}=require('../shared/experience');
test('archive directories merge repository and member material while excluding hidden files and keeping nested navigation exact',()=>{
  const entries=[{id:'r1',path:'2026届/学术部/经验.md',kind:'file',source:'github'},{id:'m1',path:'2026届/学术部/活动.pdf',kind:'file',description:'讲座复盘',source:'member'},{id:'m2',path:'2025届/秘密.pdf',kind:'file',removed:true},{path:'2024届/空文件夹',kind:'folder'}];
  assert.deepEqual(archiveTree(entries).map(e=>e.path),['2024届','2024届/空文件夹','2026届','2026届/学术部']);
  assert.equal(visibleEntries(entries,'2026届/学术部').length,2);
  assert.equal(visibleEntries(entries,'','复盘')[0].id,'m1');assert.equal(visibleEntries(entries,'','秘密').length,0);
  assert.equal(archivePath('2026届/学术部/文件.PDF',{file:true}),'2026届/学术部/文件.PDF');
  for(const p of ['../x.pdf','/x.pdf','a//x.pdf','a/../x.pdf','a\\x.pdf','a\nx.pdf','foo.html','x.svg'])assert.throws(()=>archivePath(p,{file:true}));
});
