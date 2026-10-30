// Stable entry point: even cached HTML asks for the current release manifest.
const base=new URL('./',location.href),root=document.getElementById('app');
async function boot(){
  const url=new URL('version.json',base);url.searchParams.set('_',Date.now());
  const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('版本读取失败');
  const release=await response.json();
  if(!/^[a-f0-9]{16,64}$/.test(release.version)||!/^\.\/assets\/app-[A-Z0-9]+\.js$/i.test(release.script)||!/^\.\/assets\/app-[a-f0-9]+\.css$/.test(release.style))throw new Error('版本信息无效');
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL(release.style,base);document.head.append(css);
  await new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=()=>reject(new Error('样式读取失败'));});
  const script=document.createElement('script');script.type='module';script.src=new URL(release.script,base);script.onerror=()=>failed();document.body.append(script);
}
function failed(){root.replaceChildren();const title=document.createElement('h1');title.textContent='暂时无法加载网站';const text=document.createElement('p');text.textContent='请检查网络，然后重试。';const button=document.createElement('button');button.textContent='重新连接';button.onclick=()=>location.reload();root.append(title,text,button);}
boot().catch(failed);
