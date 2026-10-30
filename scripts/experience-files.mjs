import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import rules from '../shared/experience.js';
const {archivePath,MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_ENTRIES}=rules;
export async function buildExperience(root,dist) {
  const source=path.join(root,'experience'),output=path.join(dist,'experience');
  await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
  const entries=[];let total=0;
  async function walk(folder='') {
    for(const item of (await fs.readdir(path.join(source,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(item.name==='.gitkeep'||item.name==='AGENTS.md')continue;
      const relative=folder?folder+'/'+item.name:item.name;
      if(item.isSymbolicLink())throw new Error('Experience archives cannot contain symlinks: '+relative);
      archivePath(relative,{file:!item.isDirectory()});
      if(entries.length>=MAX_ENTRIES)throw new Error('Too many experience entries');
      if(item.isDirectory()){entries.push({id:'repo:'+relative,path:relative,kind:'folder',source:'github'});await walk(relative);continue;}
      if(!item.isFile())throw new Error('Unsupported archive entry: '+relative);
      const bytes=await fs.readFile(path.join(source,relative));total+=bytes.length;
      if(!bytes.length||bytes.length>MAX_FILE_BYTES||total>MAX_TOTAL_BYTES)throw new Error('Experience file exceeds size limit: '+relative);
      const sha256=createHash('sha256').update(bytes).digest('hex');
      const dest=path.join(output,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);
      entries.push({id:'repo:'+relative,path:relative,kind:'file',source:'github',size:bytes.length,sha256,description:'',author:'SPS 共同档案',createdAt:0,updatedAt:0,canEdit:false});
    }
  }
  await walk();
  // A fixed manifest lives outside the content directory, so filenames cannot overwrite it.
  await fs.writeFile(path.join(dist,'experience-index.json'),JSON.stringify({entries}));
  return entries;
}
