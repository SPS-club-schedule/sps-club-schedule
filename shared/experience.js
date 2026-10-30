'use strict';
const MAX_FILE_BYTES=10*1024*1024, MAX_TOTAL_BYTES=256*1024*1024, MAX_ENTRIES=2000;
const EXTENSIONS=['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','md','txt','rtf','odt','ods','odp','png','jpg','jpeg','gif','webp','zip','7z'];
function archivePath(value,{file=false,empty=false}={}) {
  if(typeof value!=='string')throw new Error('请填写文件夹或文件路径');
  const path=value.normalize('NFC');
  if(empty && !path)return '';
  const segments=path.split('/');
  if(!path || path.length>400 || segments.length>8 || segments.some(p=>!p || p.length>120 || p.trim()!==p || p.startsWith('.') || p.endsWith('.') || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(p)))throw new Error('路径最多 8 层；名称不能以点开头或包含特殊路径字符');
  if(file && !EXTENSIONS.includes(path.split('.').at(-1).toLowerCase()))throw new Error('支持文档、表格、演示、图片及 ZIP/7z 文件；不支持网页或可执行文件');
  return path;
}
const parentPath=path=>path.split('/').slice(0,-1).join('/');
const fileName=path=>path.split('/').at(-1);
function parents(path) {const out=[];let p=parentPath(path);while(p){out.unshift(p);p=parentPath(p);}return out;}
function archiveTree(entries) {
  const folders=new Map();
  for(const entry of entries.filter(e=>!e.removed)) {
    for(const path of [...parents(entry.path),...(entry.kind==='folder'?[entry.path]:[])])if(!folders.has(path))folders.set(path,{path,kind:'folder'});
  }
  return [...folders.values()].sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
}
function visibleEntries(entries,path='',search='') {
  const query=search.trim().toLowerCase(), active=entries.filter(e=>!e.removed);
  if(query)return active.filter(e=>e.kind==='file' && [e.path,e.description,e.author].join(' ').toLowerCase().includes(query)).sort((a,b)=>b.createdAt-a.createdAt);
  return [...archiveTree(active).filter(e=>parentPath(e.path)===path),...active.filter(e=>e.kind==='file' && parentPath(e.path)===path).sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}))];
}
function formatBytes(bytes) {return bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':bytes>=1024?Math.ceil(bytes/1024)+' KB':bytes+' B';}
module.exports={MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_ENTRIES,EXTENSIONS,archivePath,parentPath,fileName,parents,archiveTree,visibleEntries,formatBytes};
