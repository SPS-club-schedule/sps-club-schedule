'use strict';
const validRelease=value=>!!value&&/^[a-f0-9]{16,64}$/.test(value.version)&&/^\.\/assets\/app-[A-Z0-9]+\.js$/i.test(value.script)&&/^\.\/assets\/app-[a-f0-9]+\.css$/.test(value.style);
function createReleaseUpdater({current,read,canReload,reload,notify=()=>{},attempted=()=>false,remember=()=>{},now=Date.now}) {
  let pending=null,inFlight=false,lastCheck=-Infinity,reloading=false;
  function apply(){
    if(!pending||reloading)return;
    if(!canReload()){notify(true);return;}
    if(attempted(pending.version)){notify(true);return;}
    reloading=true;remember(pending.version);notify(false);reload(pending.version);
  }
  async function check(){
    if(inFlight||reloading||now()-lastCheck<10000)return;
    inFlight=true;lastCheck=now();
    try {
      const release=await read();
      if(!validRelease(release))return;
      pending=release.version===current?null:release;
      if(!pending)notify(false);else apply();
    }catch{/* Offline, partial deploys and edge errors keep the working page. */}
    finally{inFlight=false;}
  }
  return {check,apply};
}
module.exports={validRelease,createReleaseUpdater};
