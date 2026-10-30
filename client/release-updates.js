import {createReleaseUpdater} from '../shared/release-updates';
export function startReleaseUpdates({safe}) {
  const current=__RELEASE_ID__,base=new URL('./',location.href);
  let lastInteraction=Date.now();
  const notice=document.getElementById('release-notice');
  const updater=createReleaseUpdater({current,
    read:async()=>{
      const url=new URL('version.json',base);url.searchParams.set('_',Date.now());
      const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Release unavailable');
      return response.json();
    },
    canReload:()=>!document.hidden&&navigator.onLine&&Date.now()-lastInteraction>3000&&safe(),
    notify:pending=>{notice.hidden=!pending;},
    attempted:version=>{try{return sessionStorage.getItem('sps-release-attempt')===version;}catch{return false;}},
    remember:version=>{try{sessionStorage.setItem('sps-release-attempt',version);}catch{}},
    reload:version=>{const url=new URL(location.href);url.searchParams.set('_sps_release',version);location.replace(url.href);}
  });
  // Clear the guard only after this release has actually started successfully.
  try{if(sessionStorage.getItem('sps-release-attempt')===current)sessionStorage.removeItem('sps-release-attempt');}catch{}
  const check=()=>{if(!document.hidden&&navigator.onLine)updater.check();};
  for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>{lastInteraction=Date.now();},{passive:true});
  window.addEventListener('focus',check);window.addEventListener('online',check);
  document.addEventListener('visibilitychange',check);
  setInterval(check,60000);setInterval(()=>updater.apply(),5000);check();
}
