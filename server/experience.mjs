import {createHash,randomBytes} from 'node:crypto';
import domain from '../shared/domain.js';
import rules from '../shared/experience.js';
const {ClubError}=domain;
const {archivePath,parents,fileName,MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_ENTRIES}=rules;
const fail=(code,message)=>{throw new ClubError(code,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const cleanPath=(value,file=false)=>{try{return archivePath(value,{file});}catch(e){fail('VALIDATION',e.message);}};
const description=value=>{if(value!==undefined&&(typeof value!=='string'||value.length>2000))fail('VALIDATION','资料说明最多 2000 字');return (value||'').trim();};
export function createExperienceService(ctx,env,store) {
  const sql=ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS experience_entries (
    id TEXT PRIMARY KEY,path TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL DEFAULT 0,
    digest TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',creator TEXT NOT NULL,author TEXT NOT NULL,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
    removed INTEGER NOT NULL DEFAULT 0,request_key TEXT UNIQUE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS experience_active_path ON experience_entries(path) WHERE removed=0;
  CREATE TABLE IF NOT EXISTS experience_chunks (file_id TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(file_id,part));`);
  const clubId=()=>env.EXPERIENCE_CLUB_ID || '';
  async function member(account) {
    if(!account || !clubId())return null;
    const m=await store.get('members','m_'+digest(clubId()+':'+account.id).slice(0,32));
    return m&&!m.archived?m:null;
  }
  const manages=m=>m&&['owner','admin','web_admin'].includes(m.role);
  const editable=(m,row)=>!!m&&(row.creator===m._id||manages(m));
  const entry=(row,m)=>({id:row.id,path:row.path,kind:row.kind,size:row.size,sha256:row.digest,description:row.description,author:row.author,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision,removed:!!row.removed,source:'member',canEdit:editable(m,row)});
  const count=()=>sql.exec('SELECT count(*) AS count,COALESCE(sum(size),0) AS bytes FROM experience_entries').one();
  const available=path=>sql.exec('SELECT * FROM experience_entries WHERE path=? AND removed=0',path).toArray()[0];
  function directory(path,m) {
    for(const p of [...parents(path),path]) {
      const row=available(p);
      if(row?.kind==='file')fail('CONFLICT','该路径已被一个文件占用');
      if(!row) {
        if(count().count>=MAX_ENTRIES)fail('VALIDATION','档案条目已达到容量上限，请联系网站维护管理');
        const time=Date.now();sql.exec('INSERT INTO experience_entries(id,path,kind,creator,author,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','x_'+randomBytes(16).toString('hex'),p,'folder',m._id,m.name,time,time);
      }
    }
  }
  return {
    async list(account) {
      const m=await member(account);
      const rows=sql.exec('SELECT * FROM experience_entries ORDER BY path').toArray();
      return {canWrite:!!m,maxFileBytes:MAX_FILE_BYTES,entries:rows.filter(row=>!row.removed||editable(m,row)).map(row=>entry(row,m))};
    },
    async upload(data,account) {
      const m=await member(account);if(!m)fail('FORBIDDEN','仅 SPS 社团成员可以上传经验资料');
      const path=cleanPath(data.path,true),desc=description(data.description);
      if(typeof data.requestId!=='string'||! /^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId))fail('VALIDATION','上传标识无效，请重新选择文件');
      if(typeof data.content!=='string'||data.content.length>Math.ceil(MAX_FILE_BYTES/3)*4||!data.content.length||data.content.length%4)fail('VALIDATION','文件为空、格式无效或超过 10 MB');
      const bytes=Buffer.from(data.content,'base64');if(bytes.length>MAX_FILE_BYTES||bytes.toString('base64')!==data.content)fail('VALIDATION','文件内容无效或超过 10 MB');
      const sha=digest(bytes),requestKey=m._id+':'+data.requestId;
      const previous=sql.exec('SELECT * FROM experience_entries WHERE request_key=?',requestKey).toArray()[0];
      if(previous){if(previous.digest!==sha||previous.path!==path)fail('CONFLICT','上传标识已用于其他文件');return {entry:entry(previous,m)};}
      return ctx.storage.transactionSync(()=>{
        if(available(path))fail('CONFLICT','此文件夹已有同名资料，请更改文件名或选择其他文件夹');
        const usage=count();if(usage.bytes+bytes.length>MAX_TOTAL_BYTES||usage.count>=MAX_ENTRIES)fail('VALIDATION','网页档案容量已满，请联系网站维护管理或通过仓库投稿');
        const p=parents(path);if(p.length)directory(p.at(-1),m);
        if(count().count>=MAX_ENTRIES)fail('VALIDATION','档案条目已达到容量上限，请联系网站维护管理');
        const id='x_'+randomBytes(16).toString('hex'),time=Date.now();
        sql.exec('INSERT INTO experience_entries(id,path,kind,size,digest,description,creator,author,created_at,updated_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,path,'file',bytes.length,sha,desc,m._id,m.name,time,time,requestKey);
        // SQLite rows are limited to 2 MB. Keep each blob comfortably below that limit.
        for(let offset=0,part=0;offset<bytes.length;offset+=256*1024,part++)sql.exec('INSERT INTO experience_chunks VALUES(?,?,?)',id,part,bytes.subarray(offset,offset+256*1024));
        return {entry:entry(sql.exec('SELECT * FROM experience_entries WHERE id=?',id).one(),m)};
      });
    },
    async manage(data,account) {
      const m=await member(account);if(!m)fail('FORBIDDEN','仅 SPS 社团成员可以整理经验资料');
      if(data.action==='folder')return ctx.storage.transactionSync(()=>{const path=cleanPath(data.path);directory(path,m);return {path};});
      const row=sql.exec('SELECT * FROM experience_entries WHERE id=?',String(data.id||'')).toArray()[0];
      if(!row)fail('NOT_FOUND','资料不存在');
      if(!editable(m,row))fail('FORBIDDEN','只能整理自己上传的资料；网站维护管理可整理全部档案');
      if(row.revision!==data.revision)fail('CONFLICT','资料已更新，请刷新后再试');
      if(!['edit','hide','restore'].includes(data.action))fail('VALIDATION','操作无效');
      return ctx.storage.transactionSync(()=>{
        let path=row.path,desc=row.description,removed=row.removed;
        if(data.action==='edit'){
          if(row.removed||row.kind!=='file')fail('VALIDATION','请先恢复文件，再编辑资料');
          path=cleanPath(data.path,true);desc=description(data.description);
          if(path.split('.').at(-1).toLowerCase()!==row.path.split('.').at(-1).toLowerCase())fail('VALIDATION','重命名时请保留原文件扩展名');
          const found=available(path);if(found&&found.id!==row.id)fail('CONFLICT','目标位置已有同名资料');
          const p=parents(path);if(p.length)directory(p.at(-1),m);
        }
        if(data.action==='hide'){
          if(row.kind==='folder'&&sql.exec('SELECT path FROM experience_entries WHERE removed=0').toArray().some(r=>r.path.startsWith(row.path+'/')))fail('CONFLICT','请先移走文件夹内的资料');
          removed=1;
        }
        if(data.action==='restore'){
          const found=available(path);if(found&&found.id!==row.id)fail('CONFLICT','原位置已有同名资料，请先整理该资料');
          const p=parents(path);if(p.length)directory(p.at(-1),m);removed=0;
        }
        sql.exec('UPDATE experience_entries SET path=?,description=?,removed=?,revision=revision+1,updated_at=? WHERE id=?',path,desc,removed,Date.now(),row.id);
        return {entry:entry(sql.exec('SELECT * FROM experience_entries WHERE id=?',row.id).one(),m)};
      });
    },
    download(id) {
      const row=sql.exec("SELECT * FROM experience_entries WHERE id=? AND removed=0 AND kind='file'",id).toArray()[0];
      if(!row)fail('NOT_FOUND','资料不存在或已收起');
      const bytes=Buffer.concat(sql.exec('SELECT data FROM experience_chunks WHERE file_id=? ORDER BY part',id).toArray().map(r=>Buffer.from(r.data)));
      return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(row.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName(row.path)), 'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
    }
  };
}
