// New HTML includes its release; old cached HTML can still discover the latest one.
const base=new URL('./',location.href),root=document.getElementById('app');
function valid(release){
  return release&&/^[a-f0-9]{16,64}$/.test(release.version)&&/^\.\/assets\/app-[A-Z0-9]+\.js$/i.test(release.script)&&/^\.\/assets\/app-[a-f0-9]+\.css$/.test(release.style);
}
async function currentRelease(){
  const url=new URL('version.json',base);url.searchParams.set('_',Date.now());
  const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('版本读取失败');
  const release=await response.json();
  if(!valid(release))throw new Error('版本信息无效');
  return release;
}
async function load(release){
  const style=new URL(release.style,base).href,script=new URL(release.script,base).href;
  // Also warm the script for cached HTML that has no preload hints.
  if(!Array.from(document.querySelectorAll('link[rel="modulepreload"]')).some(link=>link.href===script)){
    const preload=document.createElement('link');preload.rel='modulepreload';preload.href=script;document.head.append(preload);
  }
  let css=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link=>link.href===style);
  if(!css?.sheet){
    // The parser's stylesheet may have failed before bootstrap started. Retry it
    // with listeners already attached so cached failures cannot hang startup.
    const previous=css;
    css=document.createElement('link');css.rel='stylesheet';css.href=style;css.dataset.spsStyle='';
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(new Error('样式读取超时')),15000);
      function done(error){clearTimeout(timer);css.onload=css.onerror=null;if(error){css.remove();reject(error);}else{previous?.remove();resolve();}}
      css.onload=()=>done();css.onerror=()=>done(new Error('样式读取失败'));document.head.append(css);
    });
  }
  for(const previous of document.querySelectorAll('link[data-sps-style]'))if(previous.href!==style)previous.remove();
  await import(script);
}
async function boot(){
  const meta=document.querySelector('meta[name="sps-release"]');
  const initial=meta&&{version:meta.content,script:meta.dataset.script,style:meta.dataset.style};
  if(valid(initial)){
    try{await load(initial);return;}catch{/* Cached HTML may reference a removed release. */}
  }
  await load(await currentRelease());
}
function failed(){root.replaceChildren();const title=document.createElement('h1');title.textContent='暂时无法加载网站';const text=document.createElement('p');text.textContent='请检查网络，然后重试。';const button=document.createElement('button');button.textContent='重新连接';button.onclick=()=>location.reload();root.append(title,text,button);}
boot().catch(failed);
