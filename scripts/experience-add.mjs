import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import rules from '../shared/experience.js';
const [source,folder='']=process.argv.slice(2);
if(!source)throw new Error('Usage: npm run experience:add -- /absolute/file.pdf "2026-2027届/学术部"');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../experience');
const relative=rules.archivePath((folder?folder+'/':'')+path.basename(source),{file:true});
const stat=await fs.stat(source);if(!stat.isFile()||!stat.size||stat.size>rules.MAX_FILE_BYTES)throw new Error('File must be nonempty and at most 10 MB');
const dest=path.join(root,relative);
// Never follow a pre-existing repository directory symlink or overwrite a document.
for(const parent of rules.parents(relative)){const dir=path.join(root,parent);try{const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('Unsafe destination');}catch(e){if(e.code!=='ENOENT')throw e;await fs.mkdir(dir);}}
await fs.copyFile(source,dest,1);
console.log('Added experience/'+relative+'; review, commit and push to publish.');
