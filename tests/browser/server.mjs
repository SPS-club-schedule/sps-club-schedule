import {execFileSync} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('.guide-test-web');
execFileSync(process.execPath,['scripts/build.mjs'],{env:{...process.env,FRONTEND_OUTPUT_DIR:root,API_BASE_URL:'http://127.0.0.1:4188',BOOKING_API_BASE:'http://127.0.0.1:4188'},stdio:'ignore'});
execFileSync(process.execPath,['scripts/build.mjs','--android'],{env:{...process.env,FRONTEND_OUTPUT_DIR:path.join(root,'app')},stdio:'ignore'});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(4188,'127.0.0.1');
